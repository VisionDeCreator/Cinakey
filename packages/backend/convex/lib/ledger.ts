import { assertProviderAdmission, syncProviderJob } from "./providerControls";
import { assertGenerationAllowed } from "./restrictions";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  allocateFunding,
  expireFunding,
  expiredAvailable,
  releaseFunding,
} from "./funding";
import {
  assertPaymentGeneration,
  productionEntitlement,
} from "./paymentAccess";
import { checkBudgets, updateTotals } from "./budgets";

export type LedgerReason =
  | "grant"
  | "adjustment"
  | "funding_expiry"
  | "funding_reversal"
  | "reserve"
  | "settle"
  | "refund";

export async function getWorkspaceBalance(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<number> {
  const account = await ctx.db
    .query("billingAccounts")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  return (account?.available ?? 0) - (await expiredAvailable(ctx, workspaceId));
}

export async function appendLedgerEntry(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    projectId?: Id<"projects">;
    jobId?: Id<"generationJobs">;
    requestId?: string;
    companyFunded?: boolean;
    providerCostUsdMicros?: number;
    delta: number;
    reason: LedgerReason;
  },
): Promise<{ balanceAfter: number; entryId: Id<"usageLedger"> }> {
  if (!Number.isSafeInteger(args.delta))
    throw new Error("Ledger amounts must be safe integers");
  let companyFunded = args.companyFunded;
  let budgetSpentUsdMicros: number | undefined;
  let providerCostUsdMicros: number | undefined;
  let reserveEntry: Doc<"usageLedger"> | null = null;
  let scope: { seriesId?: Id<"series">; budgetMonth?: string } = {};
  if (args.reason === "grant" || args.reason === "adjustment") {
    if (args.delta <= 0 || args.jobId || args.projectId)
      throw new Error("Invalid grant");
  } else if (
    args.reason === "funding_expiry" ||
    args.reason === "funding_reversal"
  ) {
    if (args.delta >= 0 || args.jobId || args.projectId || !args.requestId)
      throw new Error("Invalid funding deduction");
  } else {
    if (!args.jobId || !args.projectId)
      throw new Error("Usage requires a job and project");
    const job = await ctx.db.get(args.jobId);
    const project = await ctx.db.get(args.projectId);
    if (
      !job ||
      !project ||
      job.projectId !== args.projectId ||
      job.createdBy !== args.userId ||
      project.workspaceId !== args.workspaceId
    )
      throw new Error("Usage scope mismatch");
    const entries = await ctx.db
      .query("usageLedger")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const reserve = entries.find((e) => e.reason === "reserve");
    reserveEntry = reserve ?? null;
    if (args.reason === "reserve") {
      if (args.delta >= 0 || -args.delta !== job.estimatedCostUsdMicros)
        throw new Error("Invalid reservation");
      if (reserve) {
        if (
          reserve.delta !== args.delta ||
          reserve.workspaceId !== args.workspaceId
        )
          throw new Error("Reservation mismatch");
        return { balanceAfter: reserve.balanceAfter, entryId: reserve._id };
      }
      await assertGenerationAllowed(ctx, args.userId, args.workspaceId);
      await assertProviderAdmission(ctx, job.model, -args.delta);
      companyFunded =
        (await ctx.db.get(args.workspaceId))?.billingMode === "internal";
      await assertPaymentGeneration(ctx, args.workspaceId, -args.delta);
      if (
        !(await productionEntitlement(ctx, args.workspaceId)).canWrite &&
        !["seedance-2.5", "sume-remix-lite"].includes(job.model) &&
        !(job.model === "deepseek" && job.kind === "transform-analysis")
      )
        throw new Error("Subscribe to use production analysis and staging.");
      await expireFunding(ctx, args.workspaceId, args.userId);
      scope = await checkBudgets(
        ctx,
        args.workspaceId,
        args.projectId,
        -args.delta,
      );
      if (companyFunded) {
        const shortfall =
          -args.delta - (await getWorkspaceBalance(ctx, args.workspaceId));
        if (shortfall > 0)
          await appendLedgerEntry(ctx, {
            workspaceId: args.workspaceId,
            userId: args.userId,
            delta: shortfall,
            reason: "grant",
            companyFunded: true,
            requestId: `company-funding:${args.jobId}`,
          });
      }
    } else {
      if (
        !reserve ||
        reserve.workspaceId !== args.workspaceId ||
        reserve.userId !== args.userId ||
        reserve.projectId !== args.projectId
      )
        throw new Error("Matching reservation required");
      if (
        args.delta < 0 ||
        args.delta > -reserve.delta ||
        (args.reason === "refund" && args.delta !== -reserve.delta)
      )
        throw new Error("Invalid reservation release");
      const terminal = entries.find(
        (e) => e.reason === "settle" || e.reason === "refund",
      );
      if (terminal) {
        if (terminal.reason !== args.reason || terminal.delta !== args.delta)
          throw new Error("Settlement mismatch");
        return { balanceAfter: terminal.balanceAfter, entryId: terminal._id };
      }
      companyFunded = reserve.companyFunded;
      providerCostUsdMicros =
        args.providerCostUsdMicros ?? job.supplierActualCostUsdMicros;
      if (
        providerCostUsdMicros !== undefined &&
        (!Number.isSafeInteger(providerCostUsdMicros) ||
          providerCostUsdMicros < 0)
      )
        throw new Error("Invalid provider cost");
      if (companyFunded)
        budgetSpentUsdMicros =
          providerCostUsdMicros ??
          (args.reason === "refund" ? 0 : -reserve.delta - args.delta);
      scope = { seriesId: reserve.seriesId, budgetMonth: reserve.budgetMonth };
    }
  }
  if (args.requestId) {
    const prior = await ctx.db
      .query("usageLedger")
      .withIndex("by_request", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("requestId", args.requestId),
      )
      .unique();
    if (prior) {
      if (
        prior.reason !== args.reason ||
        prior.delta !== args.delta ||
        prior.userId !== args.userId
      )
        throw new Error("Funding request mismatch");
      return { balanceAfter: prior.balanceAfter, entryId: prior._id };
    }
  }
  const account = await ctx.db
    .query("billingAccounts")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
    .unique();
  const prev = account?.available ?? 0;
  const balanceAfter = prev + args.delta;
  if (balanceAfter < 0) {
    throw new Error(
      `Insufficient USD balance (balance ${prev}, delta ${args.delta})`,
    );
  }
  if (!Number.isSafeInteger(balanceAfter))
    throw new Error("Balance exceeds safe integer range");
  let heldChange = 0;
  let spentChange = 0;
  if (args.reason === "reserve") heldChange = -args.delta;
  else if (args.reason === "settle" || args.reason === "refund") {
    const hold = await ctx.db
      .query("usageLedger")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .filter((q) => q.eq(q.field("reason"), "reserve"))
      .unique();
    if (!hold) throw new Error("Missing reservation");
    heldChange = hold.delta;
    spentChange = -hold.delta - args.delta;
  }
  if (args.projectId && args.reason !== "grant" && args.reason !== "adjustment")
    await updateTotals(
      ctx,
      args.workspaceId,
      args.projectId,
      scope.seriesId,
      scope.budgetMonth!,
      heldChange,
      budgetSpentUsdMicros ?? spentChange,
      companyFunded
        ? {
            standardPriceUsdMicros: spentChange,
            providerCostUsdMicros: providerCostUsdMicros ?? 0,
          }
        : undefined,
    );
  const fundingAllocations =
    args.reason === "reserve" && !companyFunded
      ? await allocateFunding(
          ctx,
          args.workspaceId,
          -args.delta,
          !(await productionEntitlement(ctx, args.workspaceId)).canWrite,
        )
      : undefined;
  if (reserveEntry && (args.reason === "settle" || args.reason === "refund"))
    await releaseFunding(ctx, reserveEntry, args.delta);
  const next = {
    available: balanceAfter,
    reserved: (account?.reserved ?? 0) + heldChange,
    spent: (account?.spent ?? 0) + spentChange,
    funded:
      (account?.funded ?? 0) +
      (args.reason === "grant" ||
      args.reason === "adjustment" ||
      args.reason === "funding_expiry" ||
      args.reason === "funding_reversal"
        ? args.delta
        : 0),
    sequence: (account?.sequence ?? 0) + 1,
  };
  for (const value of Object.values(next))
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Invalid account totals");
  if (account) await ctx.db.patch(account._id, next);
  else
    await ctx.db.insert("billingAccounts", {
      workspaceId: args.workspaceId,
      ...next,
    });
  const entryId = await ctx.db.insert("usageLedger", {
    ...scope,
    companyFunded,
    budgetSpentUsdMicros,
    providerCostUsdMicros,
    fundingAllocations,
    sequence: next.sequence,
    requestId: args.requestId,
    workspaceId: args.workspaceId,
    userId: args.userId,
    projectId: args.projectId,
    jobId: args.jobId,
    delta: args.delta,
    reason: args.reason,
    balanceAfter,
    createdAt: Date.now(),
  });
  if (args.jobId) await syncProviderJob(ctx, args.jobId);
  if (args.reason === "settle" || args.reason === "refund")
    await expireFunding(ctx, args.workspaceId, args.userId);
  return {
    balanceAfter: await getWorkspaceBalance(ctx, args.workspaceId),
    entryId,
  };
}
