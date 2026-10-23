import { deleteFile } from "./storage";
import { insertNotification } from "./notifications";
import { enqueueTask } from "./tasks";
import { v, ConvexError } from "convex/values";
import type { BuildRequestInput } from "@cinakey/shared";
import { getAdapter, listAdapters } from "./adapters";
import { appendLedgerEntry } from "./credits";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireProjectAccess } from "./lib/access";
import { RATE_LIMITS } from "./lib/limits";
import { assertRateLimit } from "./lib/rateLimit";
import { scanText } from "./moderation";

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
      credits: adapter.estimateCost(input),
      costModel: adapter.capabilities.costModel,
    };
  },
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
    if (user.isStaff !== true) {
      const workspace = await ctx.db.get(project.workspaceId);
      if (workspace === null || workspace.ownerUserId !== user._id) {
        throw new Error("Project access denied");
      }
    }
    return { user, project };
  },
});

export const createQueuedJob = internalMutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
    shotId: v.optional(v.id("shots")),
    sequenceId: v.optional(v.id("sequences")),
    entityId: v.optional(v.id("entities")),
    promptSheetId: v.optional(v.id("promptSheets")),
    model: v.string(),
    modelVersion: v.string(),
    kind: v.string(),
    prompt: v.string(),
    seed: v.optional(v.number()),
    inputsFileId: v.optional(v.id("_storage")),
    estimatedCostCredits: v.number(),
    createdBy: v.id("users"),
    referenceAssetIds: v.optional(v.array(v.id("assets"))),
    requestKey: v.optional(v.string()),
    requestFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.estimatedCostCredits) ||
      args.estimatedCostCredits <= 0
    )
      throw new Error("Invalid credit reservation");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.workspaceId !== args.workspaceId)
      throw new Error("Project/workspace mismatch");
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
    if (project.spendCapCredits !== undefined) {
      const entries = await ctx.db
        .query("creditLedger")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      const spent = Math.max(
        0,
        -entries
          .filter(
            (e) =>
              e.projectId === args.projectId &&
              ["reserve", "settle", "refund"].includes(e.reason),
          )
          .reduce((sum, e) => sum + e.delta, 0),
      );
      if (spent + args.estimatedCostCredits > project.spendCapCredits)
        throw new ConvexError({
          code: "SPEND_CAP",
          message: "Project spend cap reached",
        });
    }
    const now = Date.now();
    const jobId = await ctx.db.insert("generationJobs", {
      projectId: args.projectId,
      shotId: args.shotId,
      sequenceId: args.sequenceId,
      entityId: args.entityId,
      promptSheetId: args.promptSheetId,
      model: args.model,
      requestKey: args.requestKey,
      requestFingerprint: args.requestFingerprint,
      modelVersion: args.modelVersion,
      kind: args.kind,
      prompt: args.prompt,
      seed: args.seed,
      inputsFileId: args.inputsFileId,
      estimatedCostCredits: args.estimatedCostCredits,
      status: "queued",
      outputAssetIds: [],
      attempts: 0,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await appendLedgerEntry(ctx, {
        workspaceId: args.workspaceId,
        userId: args.createdBy,
        projectId: args.projectId,
        jobId,
        delta: -args.estimatedCostCredits,
        reason: "reserve",
      });
    } catch (err) {
      await ctx.db.delete(jobId);
      if (
        err instanceof Error &&
        err.message.startsWith("Insufficient credits")
      )
        throw new ConvexError({
          code: "INSUFFICIENT_CREDITS",
          message: "Insufficient credits for this generation",
        });
      throw err;
    }

    if (args.inputsFileId && args.model === "seedance-2.5") {
      const shots = args.shotId
        ? [await ctx.db.get(args.shotId)]
        : args.sequenceId
          ? await ctx.db
              .query("shots")
              .withIndex("by_sequence", (q) =>
                q.eq("sequenceId", args.sequenceId!),
              )
              .collect()
          : [];
      for (const shot of shots)
        if (shot)
          await ctx.db.patch(shot._id, {
            status: "generating",
            updatedAt: now,
          });
    }
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
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "submitted",
      providerJobId: args.providerJobId,
      submissionState: "accepted",
      providerResultFileId: args.providerResultFileId,
      providerActualUnits: args.providerActualUnits,
      attempts: args.attempts,
      updatedAt: Date.now(),
      errorMessage: undefined,
    });
  },
});

export const markRunning = internalMutation({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
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
    actualCostCredits: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === "succeeded" || job.status === "refunded") return;
    if (
      !Number.isFinite(args.actualCostCredits) ||
      args.actualCostCredits < 0 ||
      args.actualCostCredits > job.estimatedCostCredits
    )
      throw new Error("Invalid actual cost");
    const project = await ctx.db.get(job.projectId);
    if (!project) throw new Error("Project not found");
    await appendLedgerEntry(ctx, {
      workspaceId: project.workspaceId,
      userId: job.createdBy,
      projectId: job.projectId,
      jobId: job._id,
      delta: job.estimatedCostCredits - args.actualCostCredits,
      reason: "settle",
    });
    // The checkpoint is temporary; final assets have their own storage files.
    if (job.providerResultFileId)
      await deleteFile(ctx, job.providerResultFileId);
    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "succeeded",
      outputAssetIds: args.outputAssetIds,
      actualCostCredits: args.actualCostCredits,
      updatedAt: now,
      completedAt: now,
      providerResultFileId: undefined,
      errorMessage: undefined,
    });
    if (job.inputsFileId) {
      const href = job.shotId
        ? `/projects/${job.projectId}/video/${job.shotId}`
        : job.sequenceId
          ? `/projects/${job.projectId}/video`
          : job.entityId
            ? `/projects/${job.projectId}/assets/${job.entityId}`
            : `/dev/generation?jobId=${job._id}`;
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
      delta: job.estimatedCostCredits,
      reason: "refund",
    });
    // The checkpoint is temporary; final assets have their own storage files.
    if (job.providerResultFileId)
      await deleteFile(ctx, job.providerResultFileId);
    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "refunded",
      errorMessage: args.errorMessage,
      updatedAt: now,
      completedAt: now,
      providerResultFileId: undefined,
    });
    if (job.inputsFileId) {
      const href = job.shotId
        ? `/projects/${job.projectId}/video/${job.shotId}`
        : job.sequenceId
          ? `/projects/${job.projectId}/video`
          : job.entityId
            ? `/projects/${job.projectId}/assets/${job.entityId}`
            : `/dev/generation?jobId=${job._id}`;
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
      if (asset === null || asset.projectId !== args.projectId) {
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

export const createTake = internalMutation({
  args: {
    projectId: v.id("projects"),
    shotId: v.id("shots"),
    assetId: v.id("assets"),
    jobId: v.id("generationJobs"),
    parentTakeId: v.optional(v.id("takes")),
    trimStartSec: v.optional(v.number()),
    trimEndSec: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("takes")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const match = existing.find(
      (take) => take.shotId === args.shotId && take.assetId === args.assetId,
    );
    if (match) return match._id;
    return await ctx.db.insert("takes", {
      projectId: args.projectId,
      shotId: args.shotId,
      assetId: args.assetId,
      jobId: args.jobId,
      parentTakeId: args.parentTakeId,
      trimStartSec: args.trimStartSec,
      trimEndSec: args.trimEndSec,
      selected: false,
      createdAt: Date.now(),
    });
  },
});

export const setShotKeyframeInternal = internalMutation({
  args: {
    shotId: v.id("shots"),
    keyframeAssetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) return;
    await ctx.db.patch(args.shotId, {
      keyframeAssetId: args.keyframeAssetId,
      updatedAt: Date.now(),
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
    if (job.providerJobId) return "resume" as const;
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
    await ctx.db.patch(job._id, {
      submissionState: "uncertain",
      errorMessage:
        "Provider outcome uncertain; review before resubmitting. Credits remain reserved.",
      updatedAt: Date.now(),
    });
  },
});
export const markSubmissionRejected = internalMutation({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      submissionState: "rejected",
      updatedAt: Date.now(),
    });
  },
});
