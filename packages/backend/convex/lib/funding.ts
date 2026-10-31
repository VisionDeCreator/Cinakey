import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appendLedgerEntry } from "./ledger";

export async function expiredAvailable(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const pools = await ctx.db
    .query("fundingPools")
    .withIndex("by_workspace_remaining", (q) =>
      q.eq("workspaceId", workspaceId).gt("remaining", 0),
    )
    .collect();
  return pools
    .filter(
      (p) =>
        p.revoked || (p.expiresAt !== undefined && p.expiresAt <= Date.now()),
    )
    .reduce((n, p) => n + p.remaining, 0);
}
export async function expireFunding(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
) {
  const pools = await ctx.db
    .query("fundingPools")
    .withIndex("by_workspace_remaining", (q) =>
      q.eq("workspaceId", workspaceId).gt("remaining", 0),
    )
    .collect();
  for (const pool of pools)
    if (
      pool.remaining > 0 &&
      (pool.revoked ||
        (pool.expiresAt !== undefined && pool.expiresAt <= Date.now()))
    ) {
      const account = await ctx.db
        .query("billingAccounts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .unique();
      await appendLedgerEntry(ctx, {
        workspaceId,
        userId,
        delta: -pool.remaining,
        reason: "funding_expiry",
        requestId: `expire:${pool._id}:${account?.sequence ?? 0}`,
      });
      await ctx.db.patch(pool._id, { remaining: 0 });
    }
}
export async function allocateFunding(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  amount: number,
  purchasedOnly = false,
) {
  const pools = await ctx.db
    .query("fundingPools")
    .withIndex("by_workspace_remaining", (q) =>
      q.eq("workspaceId", workspaceId).gt("remaining", 0),
    )
    .collect();
  pools.sort(
    (a, b) =>
      (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) ||
      a.createdAt - b.createdAt,
  );
  let needed = amount;
  const allocations: { poolId: Id<"fundingPools">; amount: number }[] = [];
  for (const p of pools) {
    if (needed === 0) break;
    if (purchasedOnly && p.kind !== "purchased") continue;
    if (p.revoked || (p.expiresAt !== undefined && p.expiresAt <= Date.now()))
      continue;
    const take = Math.min(p.remaining, needed);
    if (take > 0) {
      allocations.push({ poolId: p._id, amount: take });
      await ctx.db.patch(p._id, {
        remaining: p.remaining - take,
        held: p.held + take,
      });
      needed -= take;
    }
  }
  if (purchasedOnly && needed > 0)
    throw new Error("Insufficient purchased generation balance");
  // Development/staff grants predate payment pools and remain the unpooled remainder.
  return allocations;
}
export async function releaseFunding(
  ctx: MutationCtx,
  reserve: Doc<"usageLedger">,
  returned: number,
) {
  let consumed = -reserve.delta - returned;
  for (const a of reserve.fundingAllocations ?? []) {
    const p = await ctx.db.get(a.poolId);
    if (!p || p.held < a.amount) throw new Error("Funding allocation mismatch");
    const spent = Math.min(consumed, a.amount);
    consumed -= spent;
    await ctx.db.patch(p._id, {
      held: p.held - a.amount,
      remaining: p.remaining + a.amount - spent,
    });
  }
}
