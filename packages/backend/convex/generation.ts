import { paidWorkPause } from "./lib/providerControls";
import { mediaUnavailable } from "./lib/mediaControls";
import { generationRestriction } from "./lib/restrictions";
import { recordJobEvent } from "./lib/jobEvents";
import {
  PRICE_VERSION,
  USAGE_MARKUP_BPS,
  applyUsageMarkup,
  QUOTE_TTL_MS,
  videoPrice,
  videoRate,
} from "@cinakey/shared";
import type { BuildRequestInput } from "@cinakey/shared";
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { getAdapter, listAdapters } from "./adapters";
import { appendLedgerEntry } from "./billing";
import {
  requireUser,
  projectCanUseAsset,
  requireProjectAccess,
  requireProjectAccessForUser,
} from "./lib/access";
import { RATE_LIMITS } from "./lib/limits";
import { assertRateLimit } from "./lib/rateLimit";
import { scanText } from "./moderation";
import { insertNotification } from "./notifications";
import { deleteFile } from "./storage";
import { enqueueTask } from "./tasks";

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

export const listCapabilities = query({
  args: {},
  handler: async () => {
    return listAdapters()
      .filter((a) => a.capabilities.kind === "video")
      .map((a) => a.capabilities);
  },
});

export const estimateCost = query({
  args: {
    adapterId: v.string(),
    kind: v.string(),
    input: v.any(),
  },
  handler: async (_ctx, args) => {
    const adapter = getAdapter(args.adapterId);
    if (
      !adapter ||
      adapter.capabilities.kind !== "video" ||
      !adapter.capabilities.operations.includes(args.kind as never)
    ) {
      throw new Error(
        `Unsupported video operation: ${args.adapterId}/${args.kind}`,
      );
    }
    const input = {
      ...(args.input as BuildRequestInput),
      kind: args.kind,
    };
    return {
      usdMicros: adapter.estimateCost(input),
      priceVersion: PRICE_VERSION,
      developmentPrice: false,
      costModel: {
        ...adapter.capabilities.costModel,
        usdMicrosPerUnit: videoRate(args.adapterId, input.resolution),
      },
    };
  },
});

export const quote = mutation({
  args: {
    projectId: v.id("projects"),
    adapterId: v.string(),
    kind: v.string(),
    durationSec: v.number(),
    resolution: v.string(),
    maxCostUsdMicros: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const project = await requireProjectAccess(ctx, args.projectId);
    const adapter = getAdapter(args.adapterId);
    if (
      !adapter ||
      adapter.capabilities.kind !== "video" ||
      !adapter.capabilities.operations.includes(args.kind as never)
    )
      throw new Error("Unsupported priced operation");
    await assertRateLimit(ctx, `quotes:${user._id}`, 120, 60_000);
    const maximumUsdMicros = videoPrice(
      args.adapterId,
      args.durationSec,
      args.resolution,
    );
    if (
      args.maxCostUsdMicros !== undefined &&
      (!Number.isSafeInteger(args.maxCostUsdMicros) ||
        args.maxCostUsdMicros < maximumUsdMicros)
    )
      throw new ConvexError({
        code: "PRICE_CHANGED",
        message:
          "The price exceeds the accepted maximum. Review the updated estimate.",
      });
    const snapshot = {
      workspaceId: project.workspaceId,
      projectId: project._id,
      userId: user._id,
      model: args.adapterId,
      kind: args.kind,
      durationSec: args.durationSec,
      resolution: args.resolution,
      priceVersion: PRICE_VERSION,
      unitUsdMicros: videoRate(args.adapterId, args.resolution),
      usageMarkupBps: USAGE_MARKUP_BPS,
      maximumUsdMicros,
      expiresAt: Date.now() + QUOTE_TTL_MS,
    };
    const quoteId = await ctx.db.insert("usageQuotes", snapshot);
    return { quoteId, ...snapshot };
  },
});
export const getQuoteInternal = internalQuery({
  args: { quoteId: v.id("usageQuotes") },
  handler: (ctx, { quoteId }) => ctx.db.get(quoteId),
});

export const getJob = query({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job === null) {
      return null;
    }
    await requireProjectAccess(ctx, job.projectId);
    return job;
  },
});

// ---------------------------------------------------------------------------
// Internal queries / mutations (job state machine)
// ---------------------------------------------------------------------------

export const getJobInternal = internalQuery({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

export const getJobByProviderId = internalQuery({
  args: { providerJobId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("generationJobs")
      .withIndex("by_provider_job", (q) =>
        q.eq("providerJobId", args.providerJobId),
      )
      .first();
  },
});

export const loadStartContext = internalQuery({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) {
      throw new Error("User not found");
    }
    const project = await ctx.db.get(args.projectId);
    if (project === null) {
      throw new Error("Project not found");
    }
    await requireProjectAccessForUser(ctx, project._id, user._id);
    return { user, project };
  },
});

export const createQueuedJob = internalMutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),

    entityId: v.optional(v.id("entities")),
    promptSheetId: v.optional(v.id("promptSheets")),
    model: v.string(),
    modelVersion: v.string(),
    kind: v.string(),
    prompt: v.string(),
    seed: v.optional(v.number()),
    inputsFileId: v.optional(v.id("_storage")),
    estimatedCostUsdMicros: v.number(),
    quoteId: v.optional(v.id("usageQuotes")),
    durationSec: v.optional(v.number()),
    resolution: v.optional(v.string()),
    createdBy: v.id("users"),
    referenceAssetIds: v.optional(v.array(v.id("assets"))),
    requestKey: v.optional(v.string()),
    requestFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.estimatedCostUsdMicros) ||
      args.estimatedCostUsdMicros <= 0
    )
      throw new Error("Invalid USD reservation");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.workspaceId !== args.workspaceId)
      throw new Error("Project/workspace mismatch");
    await requireProjectAccessForUser(ctx, args.projectId, args.createdBy);
    if (args.requestKey) {
      const existing = await ctx.db
        .query("generationJobs")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .filter((q) => q.eq(q.field("requestKey"), args.requestKey))
        .first();
      if (existing) {
        if (existing.requestFingerprint !== args.requestFingerprint)
          throw new ConvexError({
            code: "REQUEST_CONFLICT",
            message:
              "This request ID was already used with different generation settings",
          });
        return existing._id;
      }
    }
    for (const assetId of args.referenceAssetIds ?? []) {
      if (!(await projectCanUseAsset(ctx, args.projectId, assetId)))
        throw new Error("Input media is unavailable for moderation review");
    }
    const quote = args.quoteId ? await ctx.db.get(args.quoteId) : null;
    if (
      args.quoteId &&
      (!quote ||
        quote.userId !== args.createdBy ||
        quote.projectId !== args.projectId ||
        quote.workspaceId !== args.workspaceId ||
        quote.model !== args.model ||
        quote.kind !== args.kind ||
        quote.maximumUsdMicros !== args.estimatedCostUsdMicros ||
        quote.durationSec !== args.durationSec ||
        quote.resolution !== args.resolution)
    )
      throw new Error("Quote scope or price mismatch");
    if (quote && (quote.expiresAt <= Date.now() || quote.jobId))
      throw new Error("Quote expired or already used");
    const now = Date.now();
    const jobId = await ctx.db.insert("generationJobs", {
      projectId: args.projectId,
      workspaceId: args.workspaceId,

      entityId: args.entityId,
      promptSheetId: args.promptSheetId,
      model: args.model,
      requestKey: args.requestKey,
      requestFingerprint: args.requestFingerprint,
      modelVersion: args.modelVersion,
      kind: args.kind,
      prompt: args.prompt,
      seed: args.seed,
      inputAssetIds: args.referenceAssetIds ?? [],
      inputsFileId: args.inputsFileId,
      estimatedCostUsdMicros: args.estimatedCostUsdMicros,
      quoteId: args.quoteId,
      priceVersion: quote?.priceVersion ?? PRICE_VERSION,
      unitUsdMicros: quote?.unitUsdMicros ?? args.estimatedCostUsdMicros,
      usageMarkupBps: quote?.usageMarkupBps,
      status: "queued",
      submissionFenced: true,
      outputAssetIds: [],
      attempts: 0,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });

    if (quote) await ctx.db.patch(quote._id, { jobId });
    try {
      await appendLedgerEntry(ctx, {
        workspaceId: args.workspaceId,
        userId: args.createdBy,
        projectId: args.projectId,
        jobId,
        delta: -args.estimatedCostUsdMicros,
        reason: "reserve",
      });
    } catch (err) {
      await ctx.db.delete(jobId);
      if (
        err instanceof Error &&
        err.message.startsWith("Insufficient USD balance")
      )
        throw new ConvexError({
          code: "INSUFFICIENT_FUNDS",
          message: "Insufficient USD balance for this generation",
        });
      throw err;
    }

    await recordJobEvent(ctx, jobId, "queued");
    // Request-bound text jobs share the ledger but execute in their API request.
    if (args.inputsFileId)
      await enqueueTask(ctx, 0, "generation:submitAndTrack", { jobId });
    return jobId;
  },
});

export const markSubmitted = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    providerJobId: v.string(),
    attempts: v.number(),
    providerResultFileId: v.optional(v.id("_storage")),
    providerActualUnits: v.optional(v.number()),
    supplierCostUpperBoundUsdMicros: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await recordJobEvent(ctx, args.jobId, "submitted");
    await ctx.db.patch(args.jobId, {
      status: "submitted",
      providerJobId: args.providerJobId,
      submissionState: "accepted",
      providerResultFileId: args.providerResultFileId,
      providerActualUnits: args.providerActualUnits,
      supplierCostUpperBoundUsdMicros: args.supplierCostUpperBoundUsdMicros,
      attempts: args.attempts,
      updatedAt: Date.now(),
      errorMessage: undefined,
    });
  },
});

export const markRunning = internalMutation({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    await recordJobEvent(ctx, args.jobId, "running");
    await ctx.db.patch(args.jobId, {
      status: "running",
      updatedAt: Date.now(),
    });
  },
});

export const markSucceeded = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    outputAssetIds: v.array(v.id("assets")),
    actualCostUsdMicros: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === "succeeded" || job.status === "refunded") return;
    if (
      !Number.isSafeInteger(args.actualCostUsdMicros) ||
      args.actualCostUsdMicros < 0 ||
      args.actualCostUsdMicros > job.estimatedCostUsdMicros
    )
      throw new Error("Invalid actual cost");
    const actualCostUsdMicros =
      job.usageMarkupBps !== undefined &&
      job.supplierActualCostUsdMicros !== undefined
        ? Math.min(
            job.estimatedCostUsdMicros,
            applyUsageMarkup(
              job.supplierActualCostUsdMicros!,
              job.usageMarkupBps,
            ),
          )
        : args.actualCostUsdMicros;
    const project = await ctx.db.get(job.projectId);
    if (!project) throw new Error("Project not found");
    await appendLedgerEntry(ctx, {
      workspaceId: project.workspaceId,
      userId: job.createdBy,
      projectId: job.projectId,
      jobId: job._id,
      delta: job.estimatedCostUsdMicros - actualCostUsdMicros,
      reason: "settle",
    });
    // The checkpoint is temporary; final assets have their own storage files.
    if (job.providerResultFileId)
      await deleteFile(ctx, job.providerResultFileId);
    const now = Date.now();
    await recordJobEvent(ctx, args.jobId, "succeeded");
    await ctx.db.patch(args.jobId, {
      status: "succeeded",
      outputAssetIds: args.outputAssetIds,
      actualCostUsdMicros,
      billingNeedsReview:
        job.usageMarkupBps !== undefined &&
        job.supplierActualCostUsdMicros !== undefined
          ? applyUsageMarkup(
              job.supplierActualCostUsdMicros,
              job.usageMarkupBps,
            ) > job.estimatedCostUsdMicros
          : false,
      updatedAt: now,
      completedAt: now,
      providerResultFileId: undefined,
      errorMessage: undefined,
    });
    if (job.inputsFileId) {
      const transformationSession =
        project.purpose === "genjutsu"
          ? await ctx.db
              .query("genjutsuSessions")
              .withIndex("by_scope", (q) => q.eq("storageScopeId", project._id))
              .first()
          : null;
      const href = transformationSession
        ? `/genjutsu/${transformationSession._id}`
        : job.entityId
          ? `/projects/${job.projectId}/assets/${job.entityId}`
          : `/projects/${job.projectId}/studio`;
      await insertNotification(ctx, {
        userId: job.createdBy,
        projectId: job.projectId,
        kind: "job_succeeded",
        title: `Generation succeeded (${job.model})`,
        body: job.prompt.slice(0, 120),
        href,
      });
    }
  },
});

export const markFailed = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === "succeeded" || job.status === "refunded") return;
    const now = Date.now();
    await recordJobEvent(ctx, args.jobId, "failed");
    await ctx.db.patch(args.jobId, {
      status: "failed",
      errorMessage: args.errorMessage,
      updatedAt: now,
      completedAt: now,
    });
  },
});

export const markRefunded = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === "succeeded" || job.status === "refunded") return;
    const project = await ctx.db.get(job.projectId);
    if (!project) throw new Error("Project not found");
    await appendLedgerEntry(ctx, {
      workspaceId: project.workspaceId,
      userId: job.createdBy,
      projectId: job.projectId,
      jobId: job._id,
      delta: job.estimatedCostUsdMicros,
      reason: "refund",
    });
    // The checkpoint is temporary; final assets have their own storage files.
    if (job.providerResultFileId)
      await deleteFile(ctx, job.providerResultFileId);
    const now = Date.now();
    await recordJobEvent(ctx, args.jobId, "refunded");
    await ctx.db.patch(args.jobId, {
      status: "refunded",
      errorMessage: args.errorMessage,
      updatedAt: now,
      completedAt: now,
      providerResultFileId: undefined,
    });
    if (job.inputsFileId) {
      const transformationSession =
        project.purpose === "genjutsu"
          ? await ctx.db
              .query("genjutsuSessions")
              .withIndex("by_scope", (q) => q.eq("storageScopeId", project._id))
              .first()
          : null;
      const href = transformationSession
        ? `/genjutsu/${transformationSession._id}`
        : job.entityId
          ? `/projects/${job.projectId}/assets/${job.entityId}`
          : `/projects/${job.projectId}/studio`;
      await insertNotification(ctx, {
        userId: job.createdBy,
        projectId: job.projectId,
        kind: "job_failed",
        title: `Generation failed (${job.model})`,
        body: (args.errorMessage ?? "Generation failed").slice(0, 200),
        href,
      });
    }
  },
});

export const bumpAttempts = internalMutation({
  args: { jobId: v.id("generationJobs"), attempts: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      attempts: args.attempts,
      updatedAt: Date.now(),
    });
  },
});

/** Rate-limit + likeness check before queuing a job. */
export const assertStartAllowed = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    prompt: v.string(),
    referenceAssetIds: v.array(v.id("assets")),
  },
  handler: async (ctx, args) => {
    await assertRateLimit(
      ctx,
      `startGeneration:${args.userId}`,
      RATE_LIMITS.startGeneration.limit,
      RATE_LIMITS.startGeneration.windowMs,
    );

    for (const assetId of args.referenceAssetIds) {
      const asset = await ctx.db.get(assetId);
      if (
        asset === null ||
        !(await projectCanUseAsset(ctx, args.projectId, asset._id))
      ) {
        throw new Error(`Asset ${assetId} not found in this project`);
      }
      if (asset.likenessConsent === false) {
        throw new Error(
          "Reference asset is missing likeness consent for a real face",
        );
      }
    }

    const scan = scanText(args.prompt);
    if (scan.verdict === "blocked") {
      await ctx.db.insert("moderationFlags", {
        userId: args.userId,
        projectId: args.projectId,
        stage: "prompt",
        verdict: "blocked",
        ruleId: scan.ruleId ?? "block.unknown",
        snippet: scan.snippet,
        status: "open",
        createdAt: Date.now(),
      });
      throw new Error(
        `Prompt blocked by safety rules (${scan.ruleId ?? "policy"})`,
      );
    }
    if (scan.verdict === "flagged") {
      await ctx.db.insert("moderationFlags", {
        userId: args.userId,
        projectId: args.projectId,
        stage: "prompt",
        verdict: "flagged",
        ruleId: scan.ruleId ?? "flag.unknown",
        snippet: scan.snippet,
        status: "open",
        createdAt: Date.now(),
      });
    }
  },
});

export const flagOutputIfNeeded = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    jobId: v.id("generationJobs"),
    prompt: v.string(),
    assetIds: v.array(v.id("assets")),
  },
  handler: async (ctx, args) => {
    const scan = scanText(args.prompt);
    if (scan.verdict === "allow") return;
    await ctx.db.insert("moderationFlags", {
      userId: args.userId,
      projectId: args.projectId,
      jobId: args.jobId,
      assetId: args.assetIds[0],
      stage: "output",
      verdict: scan.verdict === "blocked" ? "flagged" : "flagged",
      ruleId: scan.ruleId ?? "flag.output",
      snippet: scan.snippet,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

export const getProjectWorkspace = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (project === null) {
      throw new Error("Project not found");
    }
    return project;
  },
});

/** Durable dispatch fence: a lease recovery must never blindly replay a paid POST. */
export const beginSubmission = internalMutation({
  args: { jobId: v.id("generationJobs"), attempt: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.status === "succeeded" ||
      job.status === "refunded" ||
      job.status === "failed"
    )
      return "terminal" as const;
    if (
      job.submissionState === "uncertain" ||
      job.submissionState === "in_flight"
    )
      return "review" as const;
    if (job.preventAutomaticResubmission && job.attempts > 0)
      return "review" as const;
    if (job.providerJobId) return "resume" as const;
    const project = await ctx.db.get(job.projectId);
    let blocked = project
      ? await generationRestriction(ctx, job.createdBy, project.workspaceId)
      : "Project is unavailable";
    blocked ??= await paidWorkPause(ctx, job.model);
    for (const assetId of job.inputAssetIds ?? []) {
      const asset = await ctx.db.get(assetId);
      if (!asset || (await mediaUnavailable(ctx, asset.storageId))) {
        blocked = "Input media is unavailable for moderation review";
        break;
      }
    }
    if (blocked) {
      if (
        job.submissionFenced !== true ||
        !project ||
        job.status !== "queued" ||
        job.attempts !== 0 ||
        job.submissionState
      )
        return "review" as const;
      await appendLedgerEntry(ctx, {
        workspaceId: project.workspaceId,
        userId: job.createdBy,
        projectId: project._id,
        jobId: job._id,
        delta: job.estimatedCostUsdMicros,
        reason: "refund",
      });
      await ctx.db.patch(job._id, {
        status: "refunded",
        errorMessage: blocked,
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
      await recordJobEvent(ctx, job._id, "restriction_canceled");
      return "terminal" as const;
    }

    await recordJobEvent(ctx, job._id, "submission_started");
    await ctx.db.patch(job._id, {
      submissionState: "in_flight",
      attempts: args.attempt,
      updatedAt: Date.now(),
    });
    return "submit" as const;
  },
});
export const markSubmissionUncertain = internalMutation({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === "succeeded" || job.status === "refunded") return;
    await recordJobEvent(ctx, job._id, "submission_uncertain");
    await ctx.db.patch(job._id, {
      submissionState: "uncertain",
      errorMessage:
        "Provider outcome uncertain; review before resubmitting. Funds remain reserved.",
      updatedAt: Date.now(),
    });
  },
});
export const markSubmissionRejected = internalMutation({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    await recordJobEvent(ctx, args.jobId, "submission_rejected");
    await ctx.db.patch(args.jobId, {
      submissionState: "rejected",
      updatedAt: Date.now(),
    });
  },
});

/** Final captured receipt, separate from a free preflight estimate; never overwrite it on retries. */
export const recordSupplierCharge = internalMutation({
  args: { jobId: v.id("generationJobs"), amount: v.number() },
  handler: async (ctx, { jobId, amount }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !Number.isSafeInteger(amount) || amount < 0)
      throw new Error("Invalid supplier charge");
    if (
      job.supplierActualCostUsdMicros !== undefined &&
      job.supplierActualCostUsdMicros !== amount
    )
      throw new Error("Supplier receipt changed; reconciliation required");
    await ctx.db.patch(jobId, { supplierActualCostUsdMicros: amount });
  },
});
