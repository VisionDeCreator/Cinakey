import { applyUsageMarkup } from "@dirrio/shared";
import type { BuildRequestInput, GenerationAdapter } from "@dirrio/shared";
import {
  chargeForUnits,
  validateVideoInput,
  validateVideoReference,
  validateRemixInput,
} from "@dirrio/shared";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type {
  Doc,
  Id,
} from "../../../../packages/backend/convex/_generated/dataModel";
import {
  getFileUrl,
  loadJson,
  saveFile,
} from "../../../../packages/backend/convex/storage";
import { providerConfig, serverEnv, useMockProviders } from "../config/env";
import { api, internal } from "../operations";
import { getAdapter } from "../providers";
import { isDefaultTransientError } from "../providers/cost";
import {
  ProviderError,
  safeErrorMessage,
  SubmissionUncertainError,
  workerCancellationError,
} from "../providers/errors";
import { retiredImageAdapter } from "../providers/retiredImage";
import { fetchMedia } from "../providers/transport";
import {
  action,
  httpAction,
  internalAction,
  type ActionCtx,
} from "../runtime/operation";
import { currentProviderSignal } from "../runtime/provider-scope";
import { readVideoMetadata } from "./mediaMetadata";
import { saveJson } from "./storage";

const MAX_SUBMIT_ATTEMPTS = 3;

const POLL_BACKOFF_MS = [2000, 5000, 10000, 30000, 60000] as const;

function pollDelay(pollAttempt: number): number {
  const idx = Math.min(pollAttempt, POLL_BACKOFF_MS.length - 1);
  return POLL_BACKOFF_MS[idx]!;
}

// ---------------------------------------------------------------------------
// Public action: startGeneration
// ---------------------------------------------------------------------------

export const startGeneration = action({
  args: {
    projectId: v.id("projects"),
    segmentId: v.optional(v.id("scriptSegments")),
    scriptVersionId: v.optional(v.id("workspaceScripts")),
    quoteId: v.optional(v.id("usageQuotes")),
    maxCostUsdMicros: v.optional(v.number()),
    adapterId: v.string(),
    kind: v.string(),
    prompt: v.string(),
    seed: v.optional(v.number()),

    entityId: v.optional(v.id("entities")),
    promptSheetId: v.optional(v.id("promptSheets")),
    referenceAssetIds: v.optional(v.array(v.id("assets"))),
    referenceVideoAssetId: v.optional(v.id("assets")),
    parentAssetIds: v.optional(v.array(v.id("assets"))),
    maskAssetId: v.optional(v.id("assets")),
    startFrameAssetId: v.optional(v.id("assets")),
    endFrameAssetId: v.optional(v.id("assets")),

    imageCount: v.optional(v.number()),
    input: v.optional(v.any()),
    requestId: v.optional(v.string()),
    omitProjectStyle: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    jobId: Id<"generationJobs">;
    estimatedCostUsdMicros: number;
  }> => {
    if (
      !["text-to-video", "image-to-video", "upscale", "extend"].includes(
        args.kind,
      ) ||
      !["seedance-2.5", "sume-remix-lite"].includes(args.adapterId)
    ) {
      throw new Error("Only video generation is supported");
    }
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }

    const startCtx: { user: Doc<"users">; project: Doc<"projects"> } =
      await ctx.runQuery(internal.generation.loadStartContext, {
        projectId: args.projectId,
        userId,
      });
    const { user, project } = startCtx;

    if (args.entityId !== undefined) {
      const entity = await ctx.runQuery(internal.entities.getEntityInternal, {
        entityId: args.entityId,
      });
      if (entity === null || entity.projectId !== args.projectId) {
        throw new Error("Entity not found in this project");
      }
    }

    const adapter = getAdapter(args.adapterId);
    if (!adapter) {
      throw new Error(`Unknown adapter: ${args.adapterId}`);
    }
    if (!adapter.capabilities.operations.includes(args.kind as never)) {
      throw new Error(
        `Adapter ${args.adapterId} does not support operation ${args.kind}`,
      );
    }

    const styleRefId =
      args.omitProjectStyle || args.startFrameAssetId || args.kind === "extend"
        ? undefined
        : project.styleReferenceAssetId;
    const referenceAssetIds = [
      ...new Set([
        ...(args.referenceAssetIds ?? []),
        ...(styleRefId !== undefined ? [styleRefId] : []),
      ]),
    ];
    const parentAssetIds = args.parentAssetIds ?? [];

    const allRefIds = [
      ...new Set([
        ...referenceAssetIds,
        ...(args.referenceVideoAssetId ? [args.referenceVideoAssetId] : []),
        ...parentAssetIds,
        ...(args.maskAssetId !== undefined ? [args.maskAssetId] : []),
        ...(args.startFrameAssetId !== undefined
          ? [args.startFrameAssetId]
          : []),
        ...(args.endFrameAssetId !== undefined ? [args.endFrameAssetId] : []),
      ]),
    ];

    await ctx.runMutation(internal.generation.assertStartAllowed, {
      userId: user._id,
      projectId: args.projectId,
      prompt: args.prompt,
      referenceAssetIds: allRefIds,
    });

    async function urlFor(assetId: Id<"assets">): Promise<string> {
      const asset = await ctx.runQuery(internal.storage.getAssetInternal, {
        assetId,
      });
      if (
        asset === null ||
        !(await ctx.runQuery(internal.storage.canProjectUseAsset, {
          projectId: args.projectId,
          assetId: asset._id,
        }))
      ) {
        throw new Error(`Asset ${assetId} not found in this project`);
      }
      const url = await getFileUrl(ctx, asset.storageId);
      if (!url) {
        throw new Error(`Could not resolve URL for asset ${assetId}`);
      }
      return url;
    }

    // Preserve caller reference order when assembling video inputs.
    const referenceImageUrls: string[] = [];
    let parentVideoUrl: string | undefined;
    for (const assetId of parentAssetIds) {
      const asset = await ctx.runQuery(internal.storage.getAssetInternal, {
        assetId,
      });
      if (
        !asset ||
        !(await ctx.runQuery(internal.storage.canProjectUseAsset, {
          projectId: args.projectId,
          assetId: asset._id,
        }))
      )
        throw new Error("Parent media is not in this project");
      validateVideoReference(asset, args.adapterId === "sume-remix-lite");
      if (asset.type === "video") parentVideoUrl = await urlFor(assetId);
      else throw new Error("Video operations require a video parent");
    }
    for (const assetId of referenceAssetIds) {
      const asset = await ctx.runQuery(internal.storage.getAssetInternal, {
        assetId,
      });
      if (asset?.type !== "image")
        throw new Error("Image references must be image assets");
      validateVideoReference(asset, args.adapterId === "sume-remix-lite");
      referenceImageUrls.push(await urlFor(assetId));
    }
    const maskUrl = args.maskAssetId
      ? await urlFor(args.maskAssetId)
      : undefined;

    const startFrameUrl = args.startFrameAssetId
      ? await urlFor(args.startFrameAssetId)
      : (args.input as BuildRequestInput | undefined)?.startFrameUrl;
    const endFrameUrl = args.endFrameAssetId
      ? await urlFor(args.endFrameAssetId)
      : (args.input as BuildRequestInput | undefined)?.endFrameUrl;

    if (args.referenceVideoAssetId) {
      const video = await ctx.runQuery(internal.storage.getAssetInternal, {
        assetId: args.referenceVideoAssetId,
      });
      if (video?.type !== "video")
        throw new Error("Video references must be video assets");
      validateVideoReference(video, args.adapterId === "sume-remix-lite");
    }
    const buildInput: BuildRequestInput = {
      ...(args.input as BuildRequestInput | undefined),
      prompt: args.prompt,
      kind: args.kind,
      seed: args.seed,
      imageCount: args.imageCount,
      referenceVideoAssetId: args.referenceVideoAssetId,
      referenceVideoUrl:
        (args.referenceVideoAssetId
          ? await urlFor(args.referenceVideoAssetId)
          : undefined) ??
        parentVideoUrl ??
        (args.input as BuildRequestInput | undefined)?.referenceVideoUrl,
      referenceImageUrls:
        referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
      maskUrl,
      startFrameUrl,
      endFrameUrl,
      referenceAssetIds,
      parentAssetIds,
      maskAssetId: args.maskAssetId,
      startFrameAssetId: args.startFrameAssetId,
      endFrameAssetId: args.endFrameAssetId,

      entityId: args.entityId,
    };
    validateVideoInput(buildInput);
    if (args.adapterId === "sume-remix-lite") validateRemixInput(buildInput);
    await adapter.buildRequest(buildInput);
    if (
      args.requestId !== undefined &&
      (!args.requestId || args.requestId.length > 128)
    )
      throw new Error("Invalid generation request ID");
    const pricedDuration = Number(buildInput.durationSec ?? 5);
    const pricedResolution = buildInput.resolution ?? "720p";
    const pricedQuote = args.quoteId
      ? await ctx.runQuery(internal.generation.getQuoteInternal, {
          quoteId: args.quoteId,
        })
      : await ctx.runMutation(api.generation.quote, {
          projectId: args.projectId,
          adapterId: args.adapterId,
          kind: args.kind,
          durationSec: pricedDuration,
          resolution: pricedResolution,
          maxCostUsdMicros: args.maxCostUsdMicros,
        });
    if (!pricedQuote) throw new Error("Quote not found");
    const quoteId =
      args.quoteId ?? (pricedQuote as { quoteId: Id<"usageQuotes"> }).quoteId;
    const estimated = pricedQuote.maximumUsdMicros;
    if (
      args.maxCostUsdMicros !== undefined &&
      (!Number.isSafeInteger(args.maxCostUsdMicros) ||
        args.maxCostUsdMicros < estimated)
    )
      throw new ConvexError({
        code: "PRICE_CHANGED",
        message: "The quote exceeds the accepted maximum",
      });
    if (estimated <= 0) {
      throw new Error("Estimated cost must be positive");
    }

    if (args.scriptVersionId) {
      const script = await ctx.runQuery(api.workspace.scriptRecord, {
        id: args.scriptVersionId,
      });
      if (
        !script ||
        script.projectId !== args.projectId ||
        script.segmentId !== args.segmentId
      )
        throw new Error("Script version does not belong to this segment");
    } else if (args.segmentId)
      throw new Error("A segment generation requires a script version");
    const { storageId: inputsFileId } = await saveJson(ctx, buildInput);

    let jobId: Id<"generationJobs">;
    try {
      jobId = await ctx.runMutation(internal.generation.createQueuedJob, {
        projectId: args.projectId,
        workspaceId: project.workspaceId,

        entityId: args.entityId,
        promptSheetId: args.promptSheetId,
        model: adapter.capabilities.id,
        modelVersion: useMockProviders()
          ? adapter.capabilities.id
          : args.adapterId === "sume-remix-lite"
            ? "sume/remix-lite/object-swap/v1.0"
            : providerConfig().seedanceModel,
        kind: args.kind,
        prompt: args.prompt,
        seed: args.seed,
        inputsFileId,
        segmentId: args.segmentId,
        scriptVersionId: args.scriptVersionId,
        estimatedCostUsdMicros: estimated,
        quoteId,
        durationSec: pricedDuration,
        resolution: pricedResolution,
        createdBy: user._id,
        referenceAssetIds: allRefIds,
        requestKey: args.requestId
          ? `${user._id}:${args.requestId}`
          : undefined,
        requestFingerprint: args.requestId
          ? JSON.stringify({
              adapterId: args.adapterId,
              segmentId: args.segmentId,
              scriptVersionId: args.scriptVersionId,
              entityId: args.entityId,
              kind: args.kind,
              prompt: args.prompt,
              seed: args.seed,
              referenceAssetIds,
              parentAssetIds,
              referenceVideoUrl: buildInput.referenceVideoUrl,
              startFrameAssetId: args.startFrameAssetId,
              endFrameAssetId: args.endFrameAssetId,
              durationSec: buildInput.durationSec,
              resolution: buildInput.resolution,
              aspectRatio: buildInput.aspectRatio,
            })
          : undefined,
      });
    } catch (error) {
      // Transport failure can follow a committed reservation. Never remove its inputs.
      if (error instanceof ConvexError) await ctx.storage.delete(inputsFileId);
      throw error;
    }
    const stored = await ctx.runQuery(internal.generation.getJobInternal, {
      jobId,
    });
    if (stored && stored.inputsFileId !== inputsFileId)
      await ctx.storage.delete(inputsFileId);
    return {
      jobId,
      estimatedCostUsdMicros: stored?.estimatedCostUsdMicros ?? estimated,
    };
  },
});

/** Resume video work or reconcile retired image jobs without resubmitting them. */
export const submitAndTrack = internalAction({
  args: { jobId: v.id("generationJobs"), retry: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.runQuery(internal.generation.getJobInternal, {
      jobId: args.jobId,
    });
    if (job === null) {
      return;
    }
    if (
      job.status === "succeeded" ||
      job.status === "refunded" ||
      job.status === "failed"
    ) {
      return;
    }

    if (
      job.submissionState === "in_flight" ||
      job.submissionState === "uncertain"
    ) {
      await ctx.runMutation(internal.generation.markSubmissionUncertain, {
        jobId: job._id,
      });
      throw new SubmissionUncertainError();
    }

    if (args.retry && job.preventAutomaticResubmission)
      throw new SubmissionUncertainError();

    // A reclaimed worker task resumes the persisted provider job instead of submitting again.
    if (job.providerJobId && !args.retry) {
      await ctx.runAction(internal.generation.pollJob, {
        jobId: job._id,
        pollAttempt: 0,
      });
      return;
    }

    if (
      job.model === "gpt-image-2" ||
      job.kind === "text-to-image" ||
      job.kind === "image-edit"
    ) {
      if (
        job.submissionState === "accepted" ||
        job.status !== "queued" ||
        (job.attempts > 0 && job.submissionState !== "rejected")
      ) {
        await ctx.runMutation(internal.generation.markSubmissionUncertain, {
          jobId: job._id,
        });
        throw new SubmissionUncertainError();
      }
      await failAndRefund(ctx, job, "Image generation has been retired");
      return;
    }

    if (
      !useMockProviders() &&
      job.model === "seedance-2.5" &&
      !job.modelVersion?.startsWith("sume/")
    ) {
      await ctx.runMutation(internal.generation.markSubmissionUncertain, {
        jobId: job._id,
      });
      throw new SubmissionUncertainError();
    }

    const adapter =
      job.model === "gpt-image-2" ? retiredImageAdapter : getAdapter(job.model);
    if (!adapter) {
      await failAndRefund(ctx, job, `Unknown adapter: ${job.model}`);
      return;
    }

    const attempt = job.attempts + 1;
    if (useMockProviders()) {
      await ctx.runMutation(internal.generation.bumpAttempts, {
        jobId: job._id,
        attempts: attempt,
      });
    } else {
      const gate = await ctx.runMutation(internal.generation.beginSubmission, {
        jobId: job._id,
        attempt,
      });
      if (gate === "terminal") return;
      if (gate === "review") {
        await ctx.runMutation(internal.generation.markSubmissionUncertain, {
          jobId: job._id,
        });
        throw new SubmissionUncertainError();
      }
      if (gate === "resume") {
        await ctx.runAction(internal.generation.pollJob, {
          jobId: job._id,
          pollAttempt: 0,
        });
        return;
      }
    }

    let buildInput: BuildRequestInput = {
      prompt: job.prompt,
      kind: job.kind,
      seed: job.seed,
    };
    if (job.inputsFileId) {
      try {
        const loaded = await loadJson<BuildRequestInput>(ctx, job.inputsFileId);
        buildInput = { ...loaded, ...buildInput };
      } catch {
        // proceed with minimal input
      }
    }

    try {
      const request = await adapter.buildRequest(buildInput);
      // Pass attempt for mock transient-retry tests.
      if (useMockProviders())
        (request as Record<string, unknown>)._attempt = attempt;
      const result = await adapter.submit({
        ...request,
        _idempotencyKey: `dirrio:${job._id}:${attempt}`,
        _maximumRetailUsdMicros: job.estimatedCostUsdMicros,
        _usageMarkupBps: job.usageMarkupBps,
      });

      let providerResultFileId: Id<"_storage"> | undefined;
      let providerActualUnits: number | undefined;
      if (result.completedInline && !useMockProviders()) {
        const poll = await adapter.poll(result.providerJobId);
        providerActualUnits = poll.actualUnits;
        const collected = await adapter.collect(result.providerJobId);
        providerResultFileId = (await saveJson(ctx, collected)).storageId;
      }
      await ctx.runMutation(internal.generation.markSubmitted, {
        jobId: job._id,
        providerJobId: result.providerJobId,
        supplierCostUpperBoundUsdMicros: result.supplierCostUpperBoundUsdMicros,
        providerResultFileId,
        providerActualUnits,
        attempts: attempt,
      });

      if (result.completedInline) {
        // Synchronous providers keep outputs in-process.
        // Poll/collect must run in THIS action — a scheduled pollJob runs in a
        // fresh isolate where the in-memory result map is empty.
        const poll = await adapter.poll(result.providerJobId);
        if (poll.status === "failed") {
          await failAndRefund(
            ctx,
            { ...job, attempts: attempt, providerJobId: result.providerJobId },
            poll.error ?? "Provider failed",
          );
          return;
        }
        await finishSuccess(
          ctx,
          {
            ...job,
            attempts: attempt,
            providerJobId: result.providerJobId,
            providerResultFileId,
            providerActualUnits,
            status: "submitted",
          },
          adapter,
          poll.actualUnits,
        );
      } else {
        await ctx.scheduler.runAfter(
          pollDelay(0),
          internal.generation.pollJob,
          { jobId: job._id, pollAttempt: 0 },
        );
      }
    } catch (err) {
      if (
        !useMockProviders() &&
        (!(err instanceof ProviderError) || err.uncertain)
      ) {
        await ctx.runMutation(internal.generation.markSubmissionUncertain, {
          jobId: job._id,
        });
        throw new SubmissionUncertainError();
      }
      if (!useMockProviders())
        await ctx.runMutation(internal.generation.markSubmissionRejected, {
          jobId: job._id,
        });
      if (currentProviderSignal()?.aborted) throw workerCancellationError(err);
      const transient =
        adapter.isTransientError?.(err) ?? isDefaultTransientError(err);
      if (transient && attempt < MAX_SUBMIT_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          Math.max(
            pollDelay(attempt - 1),
            err instanceof ProviderError ? err.retryAfterMs : 0,
          ),
          internal.generation.submitAndTrack,
          { jobId: job._id, retry: true },
        );
        return;
      }
      await failAndRefund(
        ctx,
        { ...job, attempts: attempt },
        safeErrorMessage(err),
      );
    }
  },
});

export const pollJob = internalAction({
  args: {
    jobId: v.id("generationJobs"),
    pollAttempt: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.generation.getJobInternal, {
      jobId: args.jobId,
    });
    if (job === null) return;
    if (
      job.status === "succeeded" ||
      job.status === "refunded" ||
      job.status === "failed"
    ) {
      return;
    }
    if (
      job.submissionState === "uncertain" ||
      job.submissionState === "in_flight" ||
      (job.model === "gpt-image-2" && !job.providerJobId)
    ) {
      await ctx.runMutation(internal.generation.markSubmissionUncertain, {
        jobId: job._id,
      });
      throw new SubmissionUncertainError();
    }
    if (!job.providerJobId) {
      await failAndRefund(ctx, job, "Missing providerJobId");
      return;
    }

    if (
      !useMockProviders() &&
      job.model === "seedance-2.5" &&
      !job.modelVersion?.startsWith("sume/")
    ) {
      await ctx.runMutation(internal.generation.markSubmissionUncertain, {
        jobId: job._id,
      });
      throw new SubmissionUncertainError();
    }

    const adapter =
      job.model === "gpt-image-2" ? retiredImageAdapter : getAdapter(job.model);
    if (!adapter) {
      await failAndRefund(ctx, job, `Unknown adapter: ${job.model}`);
      return;
    }

    try {
      if (job.providerResultFileId) {
        await finishSuccess(ctx, job, adapter, job.providerActualUnits);
        return;
      }
      if (job.model === "gpt-image-2") {
        await ctx.runMutation(internal.generation.markSubmissionUncertain, {
          jobId: job._id,
        });
        throw new SubmissionUncertainError();
      }
      const poll = await adapter.poll(job.providerJobId);

      if (poll.status === "queued" || poll.status === "running") {
        if (poll.status === "running" && job.status !== "running") {
          await ctx.runMutation(internal.generation.markRunning, {
            jobId: job._id,
          });
        }
        await ctx.scheduler.runAfter(
          pollDelay(args.pollAttempt),
          internal.generation.pollJob,
          { jobId: job._id, pollAttempt: args.pollAttempt + 1 },
        );
        return;
      }

      if (poll.status === "failed") {
        if (job.preventAutomaticResubmission) {
          await ctx.runMutation(internal.generation.markSubmissionUncertain, {
            jobId: job._id,
          });
          throw new SubmissionUncertainError();
        }
        const transient =
          poll.error !== undefined &&
          (adapter.isTransientError?.(new Error(poll.error)) ??
            isDefaultTransientError(new Error(poll.error)));
        if (transient && job.attempts < MAX_SUBMIT_ATTEMPTS) {
          await ctx.scheduler.runAfter(
            pollDelay(job.attempts),
            internal.generation.submitAndTrack,
            { jobId: job._id, retry: true },
          );
          return;
        }
        await failAndRefund(ctx, job, poll.error ?? "Provider failed");
        return;
      }

      // succeeded
      await finishSuccess(
        ctx,
        job,
        adapter,
        poll.actualUnits,
        poll.supplierActualCostUsdMicros,
      );
    } catch (err) {
      if (err instanceof SubmissionUncertainError) throw err;
      if (job.preventAutomaticResubmission) {
        await ctx.runMutation(internal.generation.markSubmissionUncertain, {
          jobId: job._id,
        });
        throw new SubmissionUncertainError();
      }
      if (currentProviderSignal()?.aborted) throw workerCancellationError(err);
      if (!useMockProviders()) {
        if (
          err instanceof ProviderError &&
          err.retryable &&
          args.pollAttempt < 6
        ) {
          await ctx.scheduler.runAfter(
            pollDelay(args.pollAttempt),
            internal.generation.pollJob,
            { jobId: job._id, pollAttempt: args.pollAttempt + 1 },
          );
          return;
        }
        await ctx.runMutation(internal.generation.markSubmissionUncertain, {
          jobId: job._id,
        });
        throw new SubmissionUncertainError();
      }
      const transient =
        adapter.isTransientError?.(err) ?? isDefaultTransientError(err);
      if (transient && job.attempts < MAX_SUBMIT_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          pollDelay(job.attempts),
          internal.generation.submitAndTrack,
          { jobId: job._id, retry: true },
        );
        return;
      }
      await failAndRefund(ctx, job, safeErrorMessage(err));
    }
  },
});

async function finishSuccess(
  ctx: ActionCtx,
  job: Doc<"generationJobs">,
  adapter: GenerationAdapter,
  actualUnits?: number,
  supplierActualCostUsdMicros?: number,
) {
  supplierActualCostUsdMicros ??= job.supplierActualCostUsdMicros;
  if (!useMockProviders() && adapter.capabilities.kind === "video") {
    if (supplierActualCostUsdMicros === undefined)
      throw new Error(
        "Final supplier billing is missing; reconcile before settlement",
      );
    await ctx.runMutation(internal.generation.recordSupplierCharge, {
      jobId: job._id,
      amount: supplierActualCostUsdMicros,
    });
    job = { ...job, supplierActualCostUsdMicros };
  }

  if (!job.providerJobId) {
    throw new Error("Missing providerJobId");
  }
  const collected = job.providerResultFileId
    ? await loadJson<import("@dirrio/shared").CollectResult>(
        ctx,
        job.providerResultFileId,
      )
    : await adapter.collect(job.providerJobId);
  const outputAssetIds: Id<"assets">[] = [];

  for (const [outputIndex, out] of collected.outputs.entries()) {
    let blob: Blob | null = null;
    let format = out.contentType ?? "application/octet-stream";

    if (out.base64) {
      const binary = atob(out.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: format });
    } else if (out.url) {
      const res = await fetchMedia(out.url);
      if (!res.ok) {
        throw new Error(`Failed to download output: ${res.status}`);
      }
      const buf = await res.arrayBuffer();
      format = res.headers.get("content-type") ?? format;
      blob = new Blob([buf], { type: format });
    } else if (out.type === "text") {
      const text = JSON.stringify(out.metadata ?? {});
      blob = new Blob([text], { type: "application/json" });
      format = "application/json";
    }

    if (blob === null) continue;

    const mediaMetadata =
      out.type === "video" ? await readVideoMetadata(blob) : undefined;
    const storageId = await saveFile(ctx, blob);
    const assetType =
      out.type === "image" ||
      out.type === "video" ||
      out.type === "audio" ||
      out.type === "json"
        ? out.type
        : out.type === "text"
          ? ("json" as const)
          : ("other" as const);

    let transformedName: string | undefined;
    let parentAssetIds: Id<"assets">[] | undefined;
    let referenceAssetIds: Id<"assets">[] | undefined;

    if (job.inputsFileId) {
      try {
        const inputs = await loadJson<BuildRequestInput>(ctx, job.inputsFileId);
        const transform = inputs.transformation as
          | { mode?: unknown; targets?: unknown; sourceName?: unknown }
          | undefined;
        if (transform && typeof transform.sourceName === "string") {
          const targets = Array.isArray(transform.targets)
            ? transform.targets.filter(
                (target): target is string => typeof target === "string",
              )
            : [];
          const label = targets.length
            ? targets.join(" + ")
            : typeof transform.mode === "string"
              ? transform.mode
              : "Transform";
          transformedName = `${label} · ${transform.sourceName}`.slice(0, 200);
        }
        if (Array.isArray(inputs.parentAssetIds)) {
          parentAssetIds = inputs.parentAssetIds as Id<"assets">[];
        }
        if (Array.isArray(inputs.referenceAssetIds)) {
          referenceAssetIds = inputs.referenceAssetIds as Id<"assets">[];
        }
      } catch {
        // ignore
      }
    }

    const assetId = await ctx.runMutation(
      internal.storage.createAssetFromGeneration,
      {
        projectId: job.projectId,
        storageId,
        type: assetType,
        format,
        name: transformedName,
        sizeBytes: blob.size,
        durationSec: mediaMetadata?.durationSec,
        width: mediaMetadata?.width,
        height: mediaMetadata?.height,
        createdBy: job.createdBy,
        jobId: job._id,
        outputIndex,

        entityId: job.entityId,

        lineage: {
          prompt: job.prompt,
          model: job.model,
          modelVersion: job.modelVersion,
          seed: job.seed,
          parentAssetIds,
          referenceAssetIds,
        },
      },
    );
    outputAssetIds.push(assetId);

    if (
      job.promptSheetId &&
      job.entityId &&
      adapter.capabilities.kind === "image"
    ) {
      await ctx.runAction(internal.entities.lockReferenceFromJob, {
        entityId: job.entityId,
        assetId,
      });
      await ctx.runMutation(internal.promptSheets.completeAssetGeneration, {
        promptSheetId: job.promptSheetId,
        assetId,
      });
    }
  }

  if (!job.priceVersion || !job.unitUsdMicros)
    throw new Error("Missing authorized price snapshot");
  if (
    actualUnits !== undefined &&
    (!Number.isFinite(actualUnits) || actualUnits < 0)
  )
    throw new Error("Invalid reported usage");
  const actualCost =
    job.usageMarkupBps !== undefined &&
    job.supplierActualCostUsdMicros !== undefined
      ? Math.min(
          job.estimatedCostUsdMicros,
          applyUsageMarkup(job.supplierActualCostUsdMicros, job.usageMarkupBps),
        )
      : actualUnits === undefined
        ? job.estimatedCostUsdMicros
        : Math.min(
            job.estimatedCostUsdMicros,
            chargeForUnits(actualUnits, job.unitUsdMicros),
          );

  await ctx.runMutation(internal.generation.markSucceeded, {
    jobId: job._id,
    outputAssetIds,
    actualCostUsdMicros: actualCost,
  });

  await ctx.runMutation(internal.generation.flagOutputIfNeeded, {
    userId: job.createdBy,
    projectId: job.projectId,
    jobId: job._id,
    prompt: job.prompt,
    assetIds: outputAssetIds,
  });
}

async function failAndRefund(
  ctx: ActionCtx,
  job: Doc<"generationJobs">,
  errorMessage: string,
) {
  await ctx.runMutation(internal.generation.markRefunded, {
    jobId: job._id,
    errorMessage,
  });
}

// ---------------------------------------------------------------------------
// Webhook HTTP handler (mounted from http.ts)
// ---------------------------------------------------------------------------

export const generationWebhook = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = serverEnv("GENERATION_WEBHOOK_SECRET");
  const body = await request.text();
  const signature =
    request.headers.get("x-dirrio-signature") ??
    request.headers.get("x-signature") ??
    "";

  if (!secret) {
    return new Response("Webhook secret not configured", { status: 503 });
  }

  const expected = await hmacSha256Hex(secret, body);
  if (!timingSafeEqual(signature, expected) && signature !== secret) {
    // Also allow raw secret match for simple local testing.
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: {
    providerJobId?: string;
    status?: string;
    error?: string;
  };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!payload.providerJobId) {
    return new Response("Missing providerJobId", { status: 400 });
  }

  const job = await ctx.runQuery(internal.generation.getJobByProviderId, {
    providerJobId: payload.providerJobId,
  });
  if (job === null) {
    return new Response("Job not found", { status: 404 });
  }

  // Kick the same poll path so settle/refund stays centralized.
  await ctx.scheduler.runAfter(0, internal.generation.pollJob, {
    jobId: job._id,
    pollAttempt: 0,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}
