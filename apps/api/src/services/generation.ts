import { currentProviderSignal } from "../runtime/provider-scope";
import { fetchMedia } from "../providers/transport";
import { useMockProviders } from "../config/env";
import {
  safeErrorMessage,
  workerCancellationError,
  ProviderError,
  SubmissionUncertainError,
} from "../providers/errors";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { BuildRequestInput, GenerationAdapter } from "@cinakey/shared";
import { getAdapter } from "../providers";
import { isDefaultTransientError } from "../providers/cost";
import { api, internal } from "../operations";
import type {
  Doc,
  Id,
} from "../../../../packages/backend/convex/_generated/dataModel";
import {
  action,
  httpAction,
  internalAction,
  type ActionCtx,
} from "../runtime/operation";
import { serverEnv } from "../config/env";
import {
  loadJson,
  saveFile,
  getFileUrl,
} from "../../../../packages/backend/convex/storage";
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
    adapterId: v.string(),
    kind: v.string(),
    prompt: v.string(),
    seed: v.optional(v.number()),
    shotId: v.optional(v.id("shots")),
    sequenceId: v.optional(v.id("sequences")),
    entityId: v.optional(v.id("entities")),
    promptSheetId: v.optional(v.id("promptSheets")),
    referenceAssetIds: v.optional(v.array(v.id("assets"))),
    parentAssetIds: v.optional(v.array(v.id("assets"))),
    maskAssetId: v.optional(v.id("assets")),
    startFrameAssetId: v.optional(v.id("assets")),
    endFrameAssetId: v.optional(v.id("assets")),
    parentTakeId: v.optional(v.id("takes")),
    imageCount: v.optional(v.number()),
    input: v.optional(v.any()),
    /** Skip spend-cap check when already validated by a wrapper action. */
    skipSpendCapCheck: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ jobId: Id<"generationJobs">; estimatedCostCredits: number }> => {
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
      args.adapterId === "gpt-image-2" &&
      project.styleReferenceAssetId !== undefined
        ? project.styleReferenceAssetId
        : undefined;
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
      if (asset === null || asset.projectId !== args.projectId) {
        throw new Error(`Asset ${assetId} not found in this project`);
      }
      const url = await getFileUrl(ctx, asset.storageId);
      if (!url) {
        throw new Error(`Could not resolve URL for asset ${assetId}`);
      }
      return url;
    }

    // Adapter expects: first URL = base image (for edit), rest = references.
    const referenceImageUrls: string[] = [];
    for (const assetId of parentAssetIds) {
      referenceImageUrls.push(await urlFor(assetId));
    }
    for (const assetId of referenceAssetIds) {
      if (!parentAssetIds.includes(assetId)) {
        referenceImageUrls.push(await urlFor(assetId));
      }
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

    const buildInput: BuildRequestInput = {
      ...(args.input as BuildRequestInput | undefined),
      prompt: args.prompt,
      kind: args.kind,
      seed: args.seed,
      imageCount: args.imageCount,
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
      parentTakeId: args.parentTakeId,
      entityId: args.entityId,
    };
    const estimated = adapter.estimateCost(buildInput);
    if (estimated <= 0) {
      throw new Error("Estimated cost must be positive");
    }

    if (args.skipSpendCapCheck !== true) {
      const cap = await ctx.runQuery(
        internal.shotGeneration.assertSpendCapInternal,
        {
          projectId: args.projectId,
          estimatedCostCredits: estimated,
        },
      );
      if (!cap.ok) {
        throw new Error(cap.message);
      }
    }

    const { storageId: inputsFileId } = await saveJson(ctx, buildInput);

    const jobId: Id<"generationJobs"> = await ctx.runMutation(
      internal.generation.createQueuedJob,
      {
        projectId: args.projectId,
        workspaceId: project.workspaceId,
        shotId: args.shotId,
        sequenceId: args.sequenceId,
        entityId: args.entityId,
        promptSheetId: args.promptSheetId,
        model: adapter.capabilities.id,
        modelVersion: adapter.capabilities.id,
        kind: args.kind,
        prompt: args.prompt,
        seed: args.seed,
        inputsFileId,
        estimatedCostCredits: estimated,
        createdBy: user._id,
        referenceAssetIds,
      },
    );

    return { jobId, estimatedCostCredits: estimated };
  },
});

/**
 * Queue four text-to-image jobs for a character identity set (front, ¾, profile, full body).
 */
export const startIdentitySet = action({
  args: {
    projectId: v.id("projects"),
    entityId: v.id("entities"),
    basePrompt: v.string(),
    referenceAssetIds: v.optional(v.array(v.id("assets"))),
    adapterId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    jobIds: Id<"generationJobs">[];
    estimatedCostCredits: number;
  }> => {
    const { IDENTITY_SLOT_KEYS, IDENTITY_SLOT_PROMPTS } =
      await import("@cinakey/shared");
    const adapterId = args.adapterId ?? "gpt-image-2";
    const jobIds: Id<"generationJobs">[] = [];
    let total = 0;
    for (const slot of IDENTITY_SLOT_KEYS) {
      const prompt = `${args.basePrompt.trim()}\n\n${IDENTITY_SLOT_PROMPTS[slot]}`;
      const result = await ctx.runAction(api.generation.startGeneration, {
        projectId: args.projectId,
        adapterId,
        kind: "text-to-image",
        prompt,
        entityId: args.entityId,
        referenceAssetIds: args.referenceAssetIds,
        input: { identitySlot: slot },
      });
      jobIds.push(result.jobId);
      total += result.estimatedCostCredits;
    }
    return { jobIds, estimatedCostCredits: total };
  },
});

// ---------------------------------------------------------------------------
// Internal actions: submit + poll
// ---------------------------------------------------------------------------

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

    // A reclaimed worker task resumes the persisted provider job instead of submitting again.
    if (job.providerJobId && !args.retry) {
      await ctx.runAction(internal.generation.pollJob, {
        jobId: job._id,
        pollAttempt: 0,
      });
      return;
    }

    const adapter = getAdapter(job.model);
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
      (request as Record<string, unknown>)._attempt = attempt;
      const result = await adapter.submit(request);

      let providerResultFileId: Id<"_storage"> | undefined;
      let providerActualUnits: number | undefined;
      if (result.completedInline && !useMockProviders()) {
        const poll = await adapter.poll(result.providerJobId);
        providerActualUnits = poll.actualUnits;
        const collected = await adapter.collect(result.providerJobId);
        providerResultFileId = await saveFile(
          ctx,
          new Blob([JSON.stringify(collected)], { type: "application/json" }),
        );
      }
      await ctx.runMutation(internal.generation.markSubmitted, {
        jobId: job._id,
        providerJobId: result.providerJobId,
        providerResultFileId,
        providerActualUnits,
        attempts: attempt,
      });

      if (result.completedInline) {
        // Sync providers (GPT Image, mock) keep outputs in-process.
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
    if (!job.providerJobId) {
      await failAndRefund(ctx, job, "Missing providerJobId");
      return;
    }

    if (
      job.submissionState === "uncertain" ||
      job.submissionState === "in_flight"
    )
      throw new SubmissionUncertainError();
    const adapter = getAdapter(job.model);
    if (!adapter) {
      await failAndRefund(ctx, job, `Unknown adapter: ${job.model}`);
      return;
    }

    try {
      if (job.providerResultFileId) {
        await finishSuccess(ctx, job, adapter, job.providerActualUnits);
        return;
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
      await finishSuccess(ctx, job, adapter, poll.actualUnits);
    } catch (err) {
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
) {
  if (!job.providerJobId) {
    throw new Error("Missing providerJobId");
  }
  const collected = job.providerResultFileId
    ? await loadJson<import("@cinakey/shared").CollectResult>(
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

    let parentAssetIds: Id<"assets">[] | undefined;
    let referenceAssetIds: Id<"assets">[] | undefined;
    let parentTakeId: Id<"takes"> | undefined;
    if (job.inputsFileId) {
      try {
        const inputs = await loadJson<BuildRequestInput>(ctx, job.inputsFileId);
        if (Array.isArray(inputs.parentAssetIds)) {
          parentAssetIds = inputs.parentAssetIds as Id<"assets">[];
        }
        if (Array.isArray(inputs.referenceAssetIds)) {
          referenceAssetIds = inputs.referenceAssetIds as Id<"assets">[];
        }
        if (typeof inputs.parentTakeId === "string") {
          parentTakeId = inputs.parentTakeId as Id<"takes">;
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
        sizeBytes: blob.size,
        createdBy: job.createdBy,
        jobId: job._id,
        outputIndex,
        shotId: job.shotId,
        entityId: job.entityId,
        tags:
          job.sequenceId && adapter.capabilities.kind === "video" && !job.shotId
            ? ["sequence-master", "video"]
            : undefined,
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
      job.sequenceId &&
      adapter.capabilities.kind === "video" &&
      !job.shotId
    ) {
      // Sequence master: split into per-shot takes with trim windows.
      await ctx.runMutation(internal.shotGeneration.createSequenceTakes, {
        projectId: job.projectId,
        sequenceId: job.sequenceId,
        masterAssetId: assetId,
        jobId: job._id,
      });
      const seqShots = await ctx.runQuery(
        internal.shotGeneration.getShotsForSequenceInternal,
        { sequenceId: job.sequenceId },
      );
      await ctx.runMutation(internal.shotGeneration.clearGeneratingStatus, {
        shotIds: seqShots.map((s: Doc<"shots">) => s._id),
      });
    } else if (job.shotId) {
      if (adapter.capabilities.kind === "video") {
        await ctx.runMutation(internal.generation.createTake, {
          projectId: job.projectId,
          shotId: job.shotId,
          assetId,
          jobId: job._id,
          parentTakeId,
        });
        await ctx.runMutation(internal.shotGeneration.clearGeneratingStatus, {
          shotIds: [job.shotId],
        });
      } else if (adapter.capabilities.kind === "image") {
        await ctx.runMutation(internal.generation.setShotKeyframeInternal, {
          shotId: job.shotId,
          keyframeAssetId: assetId,
        });
      }
    }

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

  const units =
    actualUnits ??
    (adapter.capabilities.kind === "video"
      ? 5
      : adapter.capabilities.kind === "llm"
        ? 1
        : 1);
  const actualCost = Math.min(
    job.estimatedCostCredits,
    Math.ceil(units * adapter.capabilities.costModel.creditsPerUnit),
  );

  await ctx.runMutation(internal.generation.markSucceeded, {
    jobId: job._id,
    outputAssetIds,
    actualCostCredits: actualCost,
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

  if (job.sequenceId && !job.shotId) {
    const seqShots = await ctx.runQuery(
      internal.shotGeneration.getShotsForSequenceInternal,
      { sequenceId: job.sequenceId },
    );
    await ctx.runMutation(internal.shotGeneration.restoreShotsAfterFail, {
      shotIds: seqShots.map((s: Doc<"shots">) => s._id),
    });
  } else if (job.shotId) {
    await ctx.runMutation(internal.shotGeneration.restoreShotsAfterFail, {
      shotIds: [job.shotId],
    });
  }
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
    request.headers.get("x-cinakey-signature") ??
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
