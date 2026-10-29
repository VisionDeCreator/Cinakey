import { ConvexError } from "convex/values";
import { providerScopes } from "@dirrio/shared";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
type Ctx = QueryCtx | MutationCtx;
export const utcDay = (now = Date.now()) =>
  new Date(now).toISOString().slice(0, 10);
export const utcMonth = (now = Date.now()) => utcDay(now).slice(0, 7);
export const policy = (ctx: Ctx, key: string) =>
  ctx.db
    .query("providerPolicies")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
export async function providerTotal(ctx: Ctx, scope: string, period: string) {
  return await ctx.db
    .query("providerTotals")
    .withIndex("by_scope_period", (q) =>
      q.eq("scope", scope).eq("period", period),
    )
    .unique();
}
export async function paidWorkPause(ctx: Ctx, model: string) {
  for (const scope of providerScopes(model)) {
    if ((await policy(ctx, scope))?.paused)
      return `New paid work is paused by the ${scope} control. Contact support.`;
  }
  return null;
}
export async function assertProviderAdmission(
  ctx: MutationCtx,
  model: string,
  amount: number,
) {
  const pause = await paidWorkPause(ctx, model);
  if (pause) throw new ConvexError({ code: "PROVIDER_PAUSED", message: pause });
  const state = await ctx.db.query("providerAccountingState").unique();
  for (const scope of providerScopes(model)) {
    const p = await policy(ctx, scope);
    if (!p) continue;
    if (
      [p.dailyCap, p.monthlyCap, p.maxOutstanding].some(
        (v) => v !== undefined,
      ) &&
      !state?.ready
    )
      throw new ConvexError({
        code: "PROVIDER_ACCOUNTING_PENDING",
        message:
          "Provider controls are awaiting accounting initialization. Contact support.",
      });
    if (p.maxRequest !== undefined && amount > p.maxRequest)
      throw new ConvexError({
        code: "PROVIDER_REQUEST_LIMIT",
        message: `Request exceeds the ${scope} per-request limit.`,
      });
    const total = await providerTotal(ctx, scope, "all"),
      reserved = total?.reserved ?? 0;
    if (
      p.maxOutstanding !== undefined &&
      (total?.active ?? 0) >= p.maxOutstanding
    )
      throw new ConvexError({
        code: "PROVIDER_CONCURRENCY_LIMIT",
        message: `The ${scope} outstanding-reservation limit has been reached. Try again after current work reconciles.`,
      });
    for (const [period, cap] of [
      [utcDay(), p.dailyCap],
      [utcMonth(), p.monthlyCap],
    ] as const) {
      if (
        cap !== undefined &&
        BigInt((await providerTotal(ctx, scope, period))?.spent ?? 0) +
          BigInt(reserved) +
          BigInt(amount) >
          BigInt(cap)
      )
        throw new ConvexError({
          code: "PROVIDER_SPEND_LIMIT",
          message: `The ${scope} UTC spend limit has been reached. Contact support.`,
        });
    }
  }
}
async function adjust(
  ctx: MutationCtx,
  scope: string,
  period: string,
  reserved: number,
  spent: number,
  active: number,
) {
  if (!reserved && !spent && !active) return;
  const row = await providerTotal(ctx, scope, period);
  const next = {
    reserved: (row?.reserved ?? 0) + reserved,
    spent: (row?.spent ?? 0) + spent,
    active: (row?.active ?? 0) + active,
  };
  if (Object.values(next).some((v) => !Number.isSafeInteger(v) || v < 0))
    throw new Error(
      "Invalid provider accounting totals; reconciliation required",
    );
  if (row) await ctx.db.patch(row._id, next);
  else await ctx.db.insert("providerTotals", { scope, period, ...next });
}
/** Reconcile a job from its authoritative reservation/release entries; never mutate money. */
export async function syncProviderJob(
  ctx: MutationCtx,
  jobId: Id<"generationJobs">,
) {
  const job = await ctx.db.get(jobId);
  if (!job) return;
  const entries = await ctx.db
    .query("usageLedger")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .take(5);
  if (entries.length > 3)
    throw new Error(
      "Unexpected provider job ledger; reconcile before continuing",
    );
  const reserves = entries.filter((e) => e.reason === "reserve"),
    terminals = entries.filter(
      (e) => e.reason === "settle" || e.reason === "refund",
    );
  if (reserves.length > 1 || terminals.length > 1)
    throw new Error("Duplicate provider reservation or settlement");
  const reserve = reserves[0],
    terminal = terminals[0];
  if (!reserve) {
    if (
      terminal ||
      (job.estimatedCostUsdMicros > 0 &&
        (job.providerJobId || job.billingNeedsReview))
    )
      throw new Error(
        `Missing provider reservation for job ${jobId}; investigate before enabling limits`,
      );
    return;
  }
  const amount = -reserve.delta;
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    (terminal &&
      (terminal.delta < 0 ||
        terminal.delta > amount ||
        (terminal.reason === "refund" && terminal.delta !== amount)))
  )
    throw new Error("Invalid provider reservation evidence");
  const previous = await ctx.db
    .query("providerJobAccounting")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .unique();
  const next = {
    model: job.model,
    reserved: terminal ? 0 : amount,
    spent: terminal ? amount - terminal.delta : 0,
    settledAt: terminal?.createdAt,
  };
  if (previous && previous.model !== next.model)
    throw new Error("Provider job model changed");
  for (const scope of providerScopes(job.model)) {
    await adjust(
      ctx,
      scope,
      "all",
      next.reserved - (previous?.reserved ?? 0),
      next.spent - (previous?.spent ?? 0),
      (next.reserved > 0 ? 1 : 0) - ((previous?.reserved ?? 0) > 0 ? 1 : 0),
    );
    if (previous?.settledAt !== undefined && previous.spent) {
      await adjust(
        ctx,
        scope,
        utcDay(previous.settledAt),
        0,
        -previous.spent,
        0,
      );
      await adjust(
        ctx,
        scope,
        utcMonth(previous.settledAt),
        0,
        -previous.spent,
        0,
      );
    }
    if (next.settledAt !== undefined && next.spent) {
      await adjust(ctx, scope, utcDay(next.settledAt), 0, next.spent, 0);
      await adjust(ctx, scope, utcMonth(next.settledAt), 0, next.spent, 0);
    }
  }
  if (previous) await ctx.db.patch(previous._id, next);
  else await ctx.db.insert("providerJobAccounting", { jobId, ...next });
}
