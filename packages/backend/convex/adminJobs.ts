import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { hasAdminPermission } from "@cinakey/shared";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireAdminPermission } from "./lib/access";
import { appendAuditLog } from "./lib/audit";
import { appendLedgerEntry } from "./lib/ledger";
import { assertRateLimit } from "./lib/rateLimit";
import { recordJobEvent } from "./lib/jobEvents";
import { enqueueTask } from "./tasks";
const statusValidator = v.union(
  v.literal("queued"),
  v.literal("submitted"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("refunded"),
);
const terminal = (job: Doc<"generationJobs">) =>
  ["succeeded", "refunded", "failed"].includes(job.status);
const provider = (job: Doc<"generationJobs">) =>
  job.model === "deepseek"
    ? "deepseek"
    : ["seedance-2.5", "sume-remix-lite"].includes(job.model)
      ? "sume"
      : "legacy";
function jobVersion(job: Doc<"generationJobs">) {
  return JSON.stringify([
    job.updatedAt,
    job.status,
    job.submissionState,
    job.attempts,
    job.providerJobId,
    job.modelVersion,
    job.preventAutomaticResubmission,
  ]);
}
function recoveryAvailability(
  job: Doc<"generationJobs">,
  tasks: Doc<"apiTasks">[],
  observation?: Doc<"jobObservations">,
) {
  const blocked = terminal(job)
    ? "Job is already terminal"
    : tasks.length > 1
      ? "Duplicate worker tasks require review"
      : null;
  const cancel =
    blocked ??
    (job.submissionFenced !== true ||
    job.status !== "queued" ||
    job.attempts !== 0 ||
    job.providerJobId ||
    job.submissionState ||
    !job.inputsFileId ||
    tasks.some((task) => task.state === "running")
      ? "Only unsubmitted, unleased work can be cancelled"
      : null);
  const resume =
    blocked ??
    (!job.providerJobId ||
    !job.inputsFileId ||
    tasks.some((task) => task.state === "running")
      ? "A provider request ID and no active worker lease are required"
      : !observation ||
          observation.providerJobId !== job.providerJobId ||
          observation.modelVersion !== job.modelVersion ||
          observation.jobVersion !== jobVersion(job) ||
          Date.now() - observation.observedAt > 300_000 ||
          !["queued", "running", "succeeded"].includes(observation.status)
        ? "Check provider status first; recent positive evidence is required"
        : job.submissionState === "in_flight" &&
            Date.now() - job.updatedAt < 120_000
          ? "Submission is still in flight"
          : null);
  return {
    cancel,
    resume,
    check:
      terminal(job) || !job.providerJobId
        ? "An active job with a provider request ID is required"
        : null,
  };
}
function needsAttention(job: Doc<"generationJobs">, attention: string) {
  if (attention === "uncertain")
    return (
      job.submissionState === "uncertain" || job.submissionState === "in_flight"
    );
  if (attention === "billing_review") return job.billingNeedsReview === true;
  return !terminal(job) && Date.now() - job.updatedAt >= 900_000;
}
function metadata(job: Doc<"generationJobs">, financial: boolean) {
  return {
    _id: job._id,
    projectId: job.projectId,
    workspaceId: job.workspaceId,
    createdBy: job.createdBy,
    model: job.model,
    modelVersion: job.modelVersion,
    provider: provider(job),
    kind: job.kind,
    status: job.status,
    submissionState: job.submissionState,
    providerJobId: job.providerJobId,
    attempts: job.attempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    hasInputSnapshot: !!job.inputsFileId,
    outputCount: job.outputAssetIds.length,
    billingNeedsReview: job.billingNeedsReview === true,
    preventAutomaticResubmission: job.preventAutomaticResubmission === true,
    attention: ["uncertain", "billing_review", "stalled"].filter((flag) =>
      needsAttention(job, flag),
    ),
    failureCategory:
      job.submissionState === "uncertain" || job.submissionState === "in_flight"
        ? "Submission outcome requires evidence"
        : job.billingNeedsReview
          ? "Billing review required"
          : job.status === "failed" || job.status === "refunded"
            ? "Job failed or reservation released"
            : null,
    financial: financial
      ? {
          estimated: job.estimatedCostUsdMicros,
          actual: job.actualCostUsdMicros,
          supplierActual: job.supplierActualCostUsdMicros,
          priceVersion: job.priceVersion,
          unitUsdMicros: job.unitUsdMicros,
        }
      : null,
  };
}
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    attention: v.optional(
      v.union(
        v.literal("uncertain"),
        v.literal("billing_review"),
        v.literal("stalled"),
      ),
    ),
    jobId: v.optional(v.string()),
    status: v.optional(statusValidator),
    model: v.optional(v.string()),
    provider: v.optional(
      v.union(v.literal("sume"), v.literal("deepseek"), v.literal("legacy")),
    ),
    user: v.optional(v.string()),
    workspace: v.optional(v.string()),
    project: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "jobs.read");
    if (
      !Number.isSafeInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Page size must be 1 to 100");
    if (
      (args.from !== undefined && !Number.isFinite(args.from)) ||
      (args.to !== undefined && !Number.isFinite(args.to)) ||
      (args.from !== undefined && args.to !== undefined && args.from > args.to)
    )
      throw new Error("Invalid date range");
    const empty = { page: [], isDone: true, continueCursor: "" };
    const userId = args.user?.includes("@")
      ? (
          await ctx.db
            .query("users")
            .withIndex("email", (q) =>
              q.eq("email", args.user!.trim().toLowerCase()),
            )
            .first()
        )?._id
      : args.user
        ? ctx.db.normalizeId("users", args.user)
        : null;
    const workspaceId = args.workspace
      ? ctx.db.normalizeId("workspaces", args.workspace)
      : null;
    const projectId = args.project
      ? ctx.db.normalizeId("projects", args.project)
      : null;
    if (
      (args.user && !userId) ||
      (args.workspace && !workspaceId) ||
      (args.project && !projectId)
    )
      return empty;
    const from = args.from ?? Number.MIN_SAFE_INTEGER,
      to = args.to ?? Number.MAX_SAFE_INTEGER;
    const financial = hasAdminPermission(actor, "billing.read");
    if (args.jobId) {
      const id = ctx.db.normalizeId("generationJobs", args.jobId);
      const job = id && (await ctx.db.get(id));
      if (
        !job ||
        (args.attention && !needsAttention(job, args.attention)) ||
        (args.status && job.status !== args.status) ||
        (args.model && job.model !== args.model) ||
        (args.provider && provider(job) !== args.provider) ||
        (userId && job.createdBy !== userId) ||
        (workspaceId && job.workspaceId !== workspaceId) ||
        (projectId && job.projectId !== projectId) ||
        job.createdAt < from ||
        job.createdAt > to
      )
        return empty;
      return { ...empty, page: [metadata(job, financial)] };
    }
    const jobs = ctx.db.query("generationJobs");
    let rows = workspaceId
      ? jobs.withIndex("by_workspace_created", (q) =>
          q
            .eq("workspaceId", workspaceId)
            .gte("createdAt", from)
            .lte("createdAt", to),
        )
      : projectId
        ? jobs.withIndex("by_project_created", (q) =>
            q
              .eq("projectId", projectId)
              .gte("createdAt", from)
              .lte("createdAt", to),
          )
        : userId
          ? jobs.withIndex("by_creator_created", (q) =>
              q
                .eq("createdBy", userId)
                .gte("createdAt", from)
                .lte("createdAt", to),
            )
          : args.status
            ? jobs.withIndex("by_status_created", (q) =>
                q
                  .eq("status", args.status!)
                  .gte("createdAt", from)
                  .lte("createdAt", to),
              )
            : args.model
              ? jobs.withIndex("by_model_created", (q) =>
                  q
                    .eq("model", args.model!)
                    .gte("createdAt", from)
                    .lte("createdAt", to),
                )
              : args.attention === "billing_review"
                ? jobs.withIndex("by_billing_review", (q) =>
                    q.eq("billingNeedsReview", true),
                  )
                : args.attention === "stalled"
                  ? jobs.withIndex("by_updated", (q) =>
                      q.lte("updatedAt", Date.now() - 900_000),
                    )
                  : jobs.withIndex("by_created", (q) =>
                      q.gte("createdAt", from).lte("createdAt", to),
                    );
    if (args.attention === "uncertain")
      rows = rows.filter((q) =>
        q.or(
          q.eq(q.field("submissionState"), "uncertain"),
          q.eq(q.field("submissionState"), "in_flight"),
        ),
      );
    if (args.attention === "billing_review")
      rows = rows.filter((q) => q.eq(q.field("billingNeedsReview"), true));
    if (args.attention === "stalled")
      rows = rows.filter((q) =>
        q.and(
          q.lte(q.field("updatedAt"), Date.now() - 900_000),
          q.or(
            q.eq(q.field("status"), "queued"),
            q.eq(q.field("status"), "submitted"),
            q.eq(q.field("status"), "running"),
          ),
        ),
      );
    rows = rows.filter((q) =>
      q.and(q.gte(q.field("createdAt"), from), q.lte(q.field("createdAt"), to)),
    );
    if (args.status)
      rows = rows.filter((q) => q.eq(q.field("status"), args.status));
    if (args.model)
      rows = rows.filter((q) => q.eq(q.field("model"), args.model));
    if (userId) rows = rows.filter((q) => q.eq(q.field("createdBy"), userId));
    if (projectId)
      rows = rows.filter((q) => q.eq(q.field("projectId"), projectId));
    if (args.provider === "deepseek")
      rows = rows.filter((q) => q.eq(q.field("model"), "deepseek"));
    if (args.provider === "sume")
      rows = rows.filter((q) =>
        q.or(
          q.eq(q.field("model"), "seedance-2.5"),
          q.eq(q.field("model"), "sume-remix-lite"),
        ),
      );
    if (args.provider === "legacy")
      rows = rows.filter((q) =>
        q.and(
          q.neq(q.field("model"), "deepseek"),
          q.neq(q.field("model"), "seedance-2.5"),
          q.neq(q.field("model"), "sume-remix-lite"),
        ),
      );
    const result = await rows.order("desc").paginate({
      ...args.paginationOpts,
      maximumRowsRead: 500,
      maximumBytesRead: 2_000_000,
    });
    return {
      ...result,
      page: result.page.map((job) => metadata(job, financial)),
    };
  },
});
async function records(ctx: QueryCtx, jobId: Id<"generationJobs">) {
  const [tasks, events, observations, reviews, actions] = await Promise.all([
    ctx.db
      .query("apiTasks")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", `generation:${jobId}`))
      .take(2),
    ctx.db
      .query("jobEvents")
      .withIndex("by_job_time", (q) => q.eq("jobId", jobId))
      .order("desc")
      .take(100),
    ctx.db
      .query("jobObservations")
      .withIndex("by_job_time", (q) => q.eq("jobId", jobId))
      .order("desc")
      .take(25),
    ctx.db
      .query("jobReviews")
      .withIndex("by_job_time", (q) => q.eq("jobId", jobId))
      .order("desc")
      .take(25),
    ctx.db
      .query("auditLog")
      .withIndex("by_target_time", (q) => q.eq("targetId", jobId))
      .order("desc")
      .take(50),
  ]);
  return { tasks, events, observations, reviews, actions };
}
export const detail = query({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId: rawId }) => {
    const jobId = ctx.db.normalizeId("generationJobs", rawId);
    const actor = await requireAdminPermission(ctx, "jobs.read");
    if (!jobId) return null;
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const data = await records(ctx, jobId);
    const financial = hasAdminPermission(actor, "billing.read");
    const ledger = financial
      ? await ctx.db
          .query("usageLedger")
          .withIndex("by_job", (q) => q.eq("jobId", jobId))
          .take(100)
      : [];
    const assets = await Promise.all(
      job.outputAssetIds.slice(0, 50).map((id) => ctx.db.get(id)),
    );
    return {
      availability: recoveryAvailability(job, data.tasks, data.observations[0]),
      job: metadata(job, financial),
      tasks: data.tasks.map((task) => ({
        _id: task._id,
        operation: task.operation,
        state: task.state,
        attempts: task.attempts,
        dueAt: task.dueAt,
        leaseUntil: task.leaseUntil,
      })),
      events: data.events,
      observations: data.observations,
      reviews: hasAdminPermission(actor, "jobs.manage") ? data.reviews : [],
      actions: data.actions.map((action) => ({
        _id: action._id,
        action: action.action,
        createdAt: action.createdAt,
      })),
      ledger: ledger.map((entry) => ({
        _id: entry._id,
        reason: entry.reason,
        delta: entry.delta,
        balanceAfter: entry.balanceAfter,
        createdAt: entry.createdAt,
      })),
      outputs: assets
        .filter((asset) => asset !== null)
        .map((asset) => ({
          assetId: asset._id,
          type: asset.type,
          format: asset.format,
          width: asset.width,
          height: asset.height,
          durationSec: asset.durationSec,
        })),
    };
  },
});
export const readContent = mutation({
  args: { jobId: v.id("generationJobs"), reason: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "jobs.content.read");
    const reason = args.reason.trim();
    if (reason.length < 3 || reason.length > 500)
      throw new Error("A reason of 3 to 500 characters is required");
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    await assertRateLimit(ctx, `jobContent:${actor._id}`, 30, 60_000);
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "jobs.content.read",
      targetType: "generationJobs",
      targetId: job._id,
      reason,
    });
    return { prompt: job.prompt, errorMessage: job.errorMessage };
  },
});
export const loadStatusContext = internalMutation({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, { jobId }) => {
    const actor = await requireAdminPermission(ctx, "jobs.manage");
    await assertRateLimit(ctx, `jobStatus:${actor._id}`, 30, 60_000);
    const job = await ctx.db.get(jobId);
    if (!job?.providerJobId || terminal(job))
      throw new Error("An active job with a provider request ID is required");
    return {
      jobId: job._id,
      providerJobId: job.providerJobId,
      model: job.model,
      modelVersion: job.modelVersion,
      checkedBy: actor._id,
      jobVersion: jobVersion(job),
    };
  },
});
export const recordObservation = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    jobVersion: v.string(),
    providerJobId: v.string(),
    modelVersion: v.optional(v.string()),
    checkedBy: v.id("users"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("unavailable"),
    ),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.providerJobId !== args.providerJobId ||
      job.modelVersion !== args.modelVersion ||
      jobVersion(job) !== args.jobVersion
    )
      throw new Error("Job changed during provider check");
    await ctx.db.insert("jobObservations", { ...args, observedAt: Date.now() });
    await appendAuditLog(ctx, {
      actorUserId: args.checkedBy,
      action: "jobs.provider.check",
      targetType: "generationJobs",
      targetId: job._id,
      meta: { status: args.status },
    });
  },
});
export const recover = mutation({
  args: {
    jobId: v.id("generationJobs"),
    action: v.union(
      v.literal("cancel"),
      v.literal("resume"),
      v.literal("review"),
    ),
    reason: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "jobs.manage");
    const reason = args.reason.trim();
    if (reason.length < 3 || reason.length > 500)
      throw new Error("A reason of 3 to 500 characters is required");
    if (!args.requestId.trim() || args.requestId.length > 128)
      throw new Error("A valid request ID is required");
    const fingerprint = JSON.stringify({
      action: args.action,
      jobId: args.jobId,
      reason,
    });
    const previous = await ctx.db
      .query("adminActionRequests")
      .withIndex("by_actor_request", (q) =>
        q.eq("actorUserId", actor._id).eq("requestId", args.requestId),
      )
      .unique();
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new Error("Administrative request mismatch");
      return;
    }
    await assertRateLimit(ctx, `jobRecovery:${actor._id}`, 30, 60_000);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    const data = await records(ctx, job._id);
    if (args.action !== "review") {
      const blocked = recoveryAvailability(
        job,
        data.tasks,
        data.observations[0],
      )[args.action];
      if (blocked) throw new Error(blocked);
    }
    if (args.action === "cancel") {
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
      await ctx.db.patch(job._id, {
        status: "refunded",
        updatedAt: Date.now(),
        completedAt: Date.now(),
        errorMessage: "Cancelled before provider submission",
      });
      for (const task of data.tasks) await ctx.db.delete(task._id);
      await recordJobEvent(ctx, job._id, "cancelled_before_submission");
    } else if (args.action === "resume") {
      await ctx.db.patch(job._id, {
        submissionState: "accepted",
        preventAutomaticResubmission: true,
        updatedAt: Date.now(),
      });
      for (const task of data.tasks) await ctx.db.delete(task._id);
      await enqueueTask(ctx, 0, "generation:pollJob", {
        jobId: job._id,
        pollAttempt: 0,
      });
      await recordJobEvent(
        ctx,
        job._id,
        "tracking_resumed_without_resubmission",
      );
    } else {
      await ctx.db.insert("jobReviews", {
        jobId: job._id,
        authorId: actor._id,
        note: reason,
        createdAt: Date.now(),
      });
      await recordJobEvent(ctx, job._id, "review_note_added");
    }
    await ctx.db.insert("adminActionRequests", {
      actorUserId: actor._id,
      requestId: args.requestId,
      fingerprint,
      createdAt: Date.now(),
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: `jobs.${args.action}`,
      targetType: "generationJobs",
      targetId: job._id,
      reason,
      requestId: args.requestId,
      before: { status: job.status, submissionState: job.submissionState },
      after: { action: args.action },
    });
  },
});
export const backfillWorkspace = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("generationJobs")
      .withIndex("by_created")
      .paginate({
        ...args.paginationOpts,
        numItems: 50,
        maximumRowsRead: 100,
        maximumBytesRead: 2_000_000,
      });
    let updated = 0;
    for (const job of page.page) {
      if (job.workspaceId) continue;
      const project = await ctx.db.get(job.projectId);
      if (project) {
        await ctx.db.patch(job._id, { workspaceId: project.workspaceId });
        updated++;
      }
    }
    return {
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      updated,
    };
  },
});
