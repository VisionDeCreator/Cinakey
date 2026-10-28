import {
  chargeForUnits,
  TOKEN_RATES,
  TOKEN_SUPPLIER_RATES,
  DEEPSEEK_MODEL,
  tokenUsagePrice,
  USAGE_MARKUP_BPS,
  tokenBatchPrice,
  tokenBatchSupplierCost,
  addTokenUsage,
  formatUsd,
  PRICE_VERSION,
  TOKEN_USD_MICROS_PER_1K,
} from "@cinakey/shared";
import { requireProjectAccessForUser } from "./lib/access";
import { v, ConvexError } from "convex/values";
import { internalMutation } from "./_generated/server";
import { appendLedgerEntry } from "./billing";

export const createChatJob = internalMutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    estimatedCostUsdMicros: v.number(),
    prompt: v.string(),
    modelVersion: v.optional(v.string()),
    kind: v.optional(v.string()),
    entityId: v.optional(v.id("entities")),
  },
  handler: async (ctx, args) => {
    await requireProjectAccessForUser(ctx, args.projectId, args.userId);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.workspaceId !== args.workspaceId)
      throw new Error("Project/workspace mismatch");
    if (
      !Number.isSafeInteger(args.estimatedCostUsdMicros) ||
      args.estimatedCostUsdMicros <= 0
    )
      throw new Error("Invalid analysis USD reservation");
    const now = Date.now();
    const jobId = await ctx.db.insert("generationJobs", {
      projectId: args.projectId,
      model: "deepseek",
      modelVersion: args.modelVersion ?? DEEPSEEK_MODEL,
      kind: args.kind ?? "chat",
      entityId: args.entityId,
      prompt: args.prompt.slice(0, 500),
      estimatedCostUsdMicros: args.estimatedCostUsdMicros,
      priceVersion: PRICE_VERSION,
      usageMarkupBps: USAGE_MARKUP_BPS,
      tokenRateSnapshot: TOKEN_RATES,
      supplierTokenRateSnapshot: TOKEN_SUPPLIER_RATES,
      unitUsdMicros: TOKEN_USD_MICROS_PER_1K,
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
        delta: -args.estimatedCostUsdMicros,
        reason: "reserve",
      });
    } catch (err) {
      await ctx.db.delete(jobId);
      if (
        err instanceof Error &&
        err.message.startsWith("Insufficient USD balance")
      ) {
        throw new ConvexError({
          code: "INSUFFICIENT_FUNDS" as const,
          required: args.estimatedCostUsdMicros,
          message: `Insufficient USD balance. This analysis requires ${formatUsd(args.estimatedCostUsdMicros)}.`,
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
    actualCostUsdMicros: v.number(),
    actualTokens: v.optional(v.number()),
    usage: v.optional(
      v.object({
        inputTokens: v.number(),
        cachedInputTokens: v.number(),
        outputTokens: v.number(),
      }),
    ),
    batches: v.optional(
      v.array(
        v.object({
          inputTokens: v.number(),
          cachedInputTokens: v.number(),
          outputTokens: v.number(),
          period: v.union(v.literal("peak"), v.literal("off_peak")),
          providerCreatedAt: v.number(),
        }),
      ),
    ),
    succeeded: v.boolean(),
    usageMissing: v.optional(v.boolean()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      job === null ||
      (job.status === "succeeded" && job.actualCostUsdMicros !== undefined) ||
      job.status === "refunded"
    )
      return;
    if (
      !Number.isSafeInteger(args.actualCostUsdMicros) ||
      args.actualCostUsdMicros < 0
    )
      throw new Error("Invalid actual cost");
    const project = await ctx.db.get(job.projectId);
    if (
      !project ||
      project.workspaceId !== args.workspaceId ||
      job.projectId !== args.projectId ||
      job.createdBy !== args.userId
    )
      throw new Error("Usage scope mismatch");
    if (
      args.succeeded &&
      (args.usageMissing ||
        (job.usageMarkupBps !== undefined
          ? !args.batches?.length
          : job.tokenRateSnapshot && !args.usage))
    ) {
      if (job.projectId !== args.projectId || job.createdBy !== args.userId)
        throw new Error("Usage scope mismatch");
      await ctx.db.patch(job._id, {
        status: "succeeded",
        billingNeedsReview: true,
        updatedAt: Date.now(),
      });
      return;
    }
    if (
      args.actualTokens !== undefined &&
      (!Number.isSafeInteger(args.actualTokens) || args.actualTokens < 0)
    )
      throw new Error("Invalid token usage");
    if (args.succeeded) {
      const reconciledUsage =
        args.batches?.reduce((total, batch) => addTokenUsage(total, batch), {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
        }) ?? args.usage;
      if (
        args.usage &&
        reconciledUsage &&
        (args.usage.inputTokens !== reconciledUsage.inputTokens ||
          args.usage.cachedInputTokens !== reconciledUsage.cachedInputTokens ||
          args.usage.outputTokens !== reconciledUsage.outputTokens)
      )
        throw new Error("Provider usage totals do not match billing evidence");
      if (args.actualTokens !== undefined && !job.unitUsdMicros)
        throw new Error("Missing authorized token price");
      const supplierActualCostUsdMicros =
        args.batches && job.usageMarkupBps !== undefined
          ? tokenBatchSupplierCost(args.batches, job.supplierTokenRateSnapshot)
          : undefined;
      const billed =
        args.batches && job.usageMarkupBps !== undefined
          ? tokenBatchPrice(
              args.batches,
              job.supplierTokenRateSnapshot,
              job.usageMarkupBps,
            )
          : undefined;
      const actual = Math.min(
        billed !== undefined
          ? billed
          : args.usage && job.tokenRateSnapshot
            ? tokenUsagePrice(args.usage, job.tokenRateSnapshot)
            : args.actualTokens === undefined
              ? args.actualCostUsdMicros
              : chargeForUnits(args.actualTokens / 1000, job.unitUsdMicros!),
        job.estimatedCostUsdMicros,
      );
      await appendLedgerEntry(ctx, {
        workspaceId: args.workspaceId,
        userId: args.userId,
        projectId: args.projectId,
        jobId: args.jobId,
        providerCostUsdMicros: supplierActualCostUsdMicros,
        delta: job.estimatedCostUsdMicros - actual,
        reason: "settle",
      });
      await ctx.db.patch(args.jobId, {
        status: "succeeded",
        actualCostUsdMicros: actual,
        ...(args.batches
          ? { tokenUsageBatches: args.batches, supplierActualCostUsdMicros }
          : {}),
        billingNeedsReview:
          billed !== undefined
            ? billed > job.estimatedCostUsdMicros
            : args.usage && job.tokenRateSnapshot
              ? tokenUsagePrice(args.usage, job.tokenRateSnapshot) >
                job.estimatedCostUsdMicros
              : false,
        ...(reconciledUsage
          ? {
              tokenUsage: reconciledUsage,
              supplierCostUpperBoundUsdMicros: tokenUsagePrice(
                reconciledUsage,
                job.supplierTokenRateSnapshot ?? TOKEN_SUPPLIER_RATES,
              ),
            }
          : {}),
        updatedAt: Date.now(),
      });
    } else {
      await appendLedgerEntry(ctx, {
        workspaceId: args.workspaceId,
        userId: args.userId,
        projectId: args.projectId,
        jobId: args.jobId,
        delta: job.estimatedCostUsdMicros,
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
