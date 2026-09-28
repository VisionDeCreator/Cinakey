import type { MutationCtx } from "../_generated/server";

/**
 * Fixed-window rate limit. Throws if the caller exceeds `limit` within `windowMs`.
 */
export async function assertRateLimit(
  ctx: MutationCtx,
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query("rateLimitBuckets")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (existing === null) {
    await ctx.db.insert("rateLimitBuckets", {
      key,
      windowStart: now,
      count: 1,
    });
    return;
  }

  if (now - existing.windowStart >= windowMs) {
    await ctx.db.patch(existing._id, { windowStart: now, count: 1 });
    return;
  }

  if (existing.count >= limit) {
    throw new Error("Rate limit exceeded. Try again later.");
  }

  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}
