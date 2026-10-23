import { v, ConvexError } from "convex/values";
import { internalMutation } from "./_generated/server";
import { appendLedgerEntry, getWorkspaceBalance } from "./credits";

export const createChatJob = internalMutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    estimatedCostCredits: v.number(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("generationJobs", {
      projectId: args.projectId,
      model: "deepseek",
      modelVersion: "deepseek-chat",
      kind: "chat",
      prompt: args.prompt.slice(0, 500),
      estimatedCostCredits: args.estimatedCostCredits,
      status: "running",
      outputAssetIds: [],
      attempts: 1,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now,
    });
    try {
      await appendLedgerEntry(ctx, {
        workspaceId: args.workspaceId,
        userId: args.userId,
        projectId: args.projectId,
        jobId,
        delta: -args.estimatedCostCredits,
        reason: "reserve",
      });
    } catch (err) {
      await ctx.db.delete(jobId);
      const balance = await getWorkspaceBalance(ctx, args.workspaceId);
      if (
        err instanceof Error &&
        err.message.startsWith("Insufficient credits")
      ) {
        throw new ConvexError({
          code: "INSUFFICIENT_CREDITS" as const,
          balance,
          required: args.estimatedCostCredits,
        });
      }
      throw err;
    }
    return jobId;
  },
});

export const settleChatJob = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    projectId: v.id("projects"),
    actualCostCredits: v.number(),
    succeeded: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job === null || job.status === "succeeded" || job.status === "refunded")
      return;
    if (args.succeeded) {
      const actual = Math.min(args.actualCostCredits, job.estimatedCostCredits);
      await appendLedgerEntry(ctx, {
        workspaceId: args.workspaceId,
        userId: args.userId,
        projectId: args.projectId,
        jobId: args.jobId,
        delta: job.estimatedCostCredits - actual,
        reason: "settle",
      });
      await ctx.db.patch(args.jobId, {
        status: "succeeded",
        actualCostCredits: actual,
        updatedAt: Date.now(),
      });
    } else {
      await appendLedgerEntry(ctx, {
        workspaceId: args.workspaceId,
        userId: args.userId,
        projectId: args.projectId,
        jobId: args.jobId,
        delta: job.estimatedCostCredits,
        reason: "refund",
      });
      await ctx.db.patch(args.jobId, {
        status: "refunded",
        errorMessage: args.errorMessage,
        updatedAt: Date.now(),
      });
    }
  },
});
