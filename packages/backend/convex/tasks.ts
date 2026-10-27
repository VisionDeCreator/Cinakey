import { getFunctionName, type FunctionReference } from "convex/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { appendLedgerEntry } from "./billing";

export async function enqueueTask(
  ctx: MutationCtx,
  delay: number,
  reference:
    string | FunctionReference<"mutation" | "action", "public" | "internal">,
  args: unknown,
) {
  const operation =
    typeof reference === "string" ? reference : getFunctionName(reference);
  const jobId = (args as { jobId?: string })?.jobId;
  const dedupeKey =
    operation.startsWith("generation:") && jobId
      ? `generation:${jobId}`
      : undefined;
  if (dedupeKey) {
    const existing = await ctx.db
      .query("apiTasks")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (existing) return existing._id;
  }
  return ctx.db.insert("apiTasks", {
    operation,
    dedupeKey,
    args,
    dueAt: Date.now() + Math.max(0, delay),
    state: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
}
export const enqueue = internalMutation({
  args: {
    operation: v.string(),
    args: v.any(),
    delay: v.number(),
    identity: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const id = await enqueueTask(ctx, args.delay, args.operation, args.args);
    if (args.identity) await ctx.db.patch(id, { identity: args.identity });
    return id;
  },
});
export const claim = internalMutation({
  args: { owner: v.string(), limit: v.number() },
  handler: async (ctx, { owner, limit }) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("apiTasks")
      .withIndex("by_state_lease", (q) =>
        q.eq("state", "running").lte("leaseUntil", now),
      )
      .take(20);
    for (const task of expired)
      await ctx.db.patch(task._id, {
        state: "pending",
        dueAt: now,
        leaseOwner: undefined,
        leaseUntil: undefined,
      });
    const tasks = await ctx.db
      .query("apiTasks")
      .withIndex("by_state_due", (q) =>
        q.eq("state", "pending").lte("dueAt", now),
      )
      .take(Math.max(1, Math.min(limit, 10)));
    for (const task of tasks)
      await ctx.db.patch(task._id, {
        state: "running",
        leaseOwner: owner,
        leaseUntil: now + 120_000,
        attempts: task.attempts + 1,
      });
    return tasks;
  },
});
export const heartbeat = internalMutation({
  args: { id: v.id("apiTasks"), owner: v.string() },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task || task.state !== "running" || task.leaseOwner !== args.owner)
      throw new Error("Task lease lost");
    await ctx.db.patch(task._id, { leaseUntil: Date.now() + 120_000 });
  },
});
export const complete = internalMutation({
  args: { id: v.id("apiTasks"), owner: v.string() },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (task?.state === "running" && task.leaseOwner === args.owner)
      await ctx.db.delete(task._id);
  },
});
export const retry = internalMutation({
  args: {
    id: v.id("apiTasks"),
    owner: v.string(),
    error: v.string(),
    permanent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (task?.state !== "running" || task.leaseOwner !== args.owner) return;
    const exhausted = args.permanent === true || task.attempts >= 6;
    await ctx.db.patch(task._id, {
      state: exhausted ? "failed" : "pending",
      error: args.error.slice(0, 1000),
      dueAt: Date.now() + Math.min(300_000, 1000 * 2 ** task.attempts),
      leaseOwner: undefined,
      leaseUntil: undefined,
    });
  },
});
/** Recover pre-migration generation jobs or a missed dispatch, in bounded pages. */
export const reconcileGeneration = internalMutation({
  args: {
    status: v.union(
      v.literal("queued"),
      v.literal("submitted"),
      v.literal("running"),
    ),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("generationJobs")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .paginate({ cursor: args.cursor, numItems: 50 });
    for (const job of page.page) {
      if (job.submissionState === "uncertain") continue;
      // Text jobs belong to individual API requests, not the provider worker.
      if (
        !job.inputsFileId &&
        job.model !== "gpt-image-2" &&
        job.kind !== "text-to-image" &&
        job.kind !== "image-edit"
      ) {
        if (job.updatedAt < Date.now() - 30 * 60_000) {
          const project = await ctx.db.get(job.projectId);
          if (project)
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
            errorMessage: "Request interrupted. Please try again.",
            updatedAt: Date.now(),
            completedAt: Date.now(),
          });
          const messages = await ctx.db
            .query("copilotMessages")
            .withIndex("by_job", (q) => q.eq("jobId", job._id))
            .collect();
          for (const message of messages)
            if (message.streaming)
              await ctx.db.patch(message._id, {
                streaming: false,
                content:
                  message.content || "Request interrupted. Please try again.",
                updatedAt: Date.now(),
              });
        }
        continue;
      }
      await enqueueTask(
        ctx,
        0,
        job.providerJobId ? "generation:pollJob" : "generation:submitAndTrack",
        { jobId: job._id, ...(job.providerJobId ? { pollAttempt: 0 } : {}) },
      );
    }
    return { isDone: page.isDone, cursor: page.continueCursor };
  },
});
