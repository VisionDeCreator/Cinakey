import type { MutationCtx, QueryCtx } from "../_generated/server";
/** Missing settings preserve invite-only access; authentication reads this transactionally. */
export async function registrationPolicy(ctx: QueryCtx | MutationCtx) {
  const row = await ctx.db
    .query("registrationSettings")
    .withIndex("by_key", (q) => q.eq("key", "platform"))
    .unique();
  return {
    requireApproval: row?.requireApproval ?? true,
    revision: row?.revision ?? 0,
  };
}
