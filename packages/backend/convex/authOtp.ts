import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { assertRateLimit } from "./lib/rateLimit";
import { normalizeAuthEmail, verifiedEmailUser } from "./lib/authEmail";
import type { Id } from "./_generated/dataModel";

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_COOLDOWN_MS = 60_000;
export const OTP_MAX_ATTEMPTS = 5;
const digest = v.string();
export const issue = internalMutation({
  args: {
    email: v.string(),
    challengeHash: digest,
    codeHash: digest,
    ipHash: digest,
  },
  handler: async (ctx, args) => {
    const email = normalizeAuthEmail(args.email);
    if (
      ![args.challengeHash, args.codeHash, args.ipHash].every((s) =>
        /^[a-f0-9]{64}$/.test(s),
      )
    )
      throw new Error("Invalid login challenge");
    const now = Date.now();
    const previous = await ctx.db
      .query("loginChallenges")
      .withIndex("by_email", (q) => q.eq("email", email))
      .order("desc")
      .first();
    if (previous && now - previous.createdAt < OTP_COOLDOWN_MS)
      throw new ConvexError({
        code: "OTP_RATE_LIMIT",
        message: "Please wait before requesting another code.",
        retryAfterSeconds: Math.ceil(
          (OTP_COOLDOWN_MS - (now - previous.createdAt)) / 1000,
        ),
      });
    await assertRateLimit(ctx, `login-email-hour:${email}`, 5, 3600_000);
    await assertRateLimit(ctx, `login-email-day:${email}`, 10, 86400_000);
    await assertRateLimit(ctx, `login-ip:${args.ipHash}`, 100, 3600_000);
    await assertRateLimit(ctx, "login-global", 1000, 3600_000);
    if (previous)
      await ctx.db.patch(previous._id, { expiresAt: now, delivered: false });
    const id = await ctx.db.insert("loginChallenges", {
      email,
      challengeHash: args.challengeHash,
      codeHash: args.codeHash,
      createdAt: now,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      delivered: false,
    });
    return { id, expiresAt: now + OTP_TTL_MS };
  },
});
export const delivered = internalMutation({
  args: { id: v.id("loginChallenges") },
  handler: async (ctx, { id }) => {
    const c = await ctx.db.get(id);
    if (c && c.expiresAt > Date.now())
      await ctx.db.patch(id, { delivered: true });
  },
});
export const consume = internalMutation({
  args: { email: v.string(), challengeHash: digest, codeHash: digest },
  handler: async (ctx, args): Promise<{ userId: Id<"users"> | null }> => {
    const email = normalizeAuthEmail(args.email);
    const c = await ctx.db
      .query("loginChallenges")
      .withIndex("by_challenge", (q) =>
        q.eq("challengeHash", args.challengeHash),
      )
      .unique();
    if (
      !c ||
      c.email !== email ||
      !c.delivered ||
      c.expiresAt <= Date.now() ||
      c.attempts >= OTP_MAX_ATTEMPTS
    )
      return { userId: null };
    // Return failed guesses instead of throwing, so the attempt counter commits.
    await ctx.db.patch(c._id, { attempts: c.attempts + 1 });
    if (c.codeHash !== args.codeHash) return { userId: null };
    const userId = await verifiedEmailUser(ctx, email);
    await ctx.db.delete(c._id);
    return { userId };
  },
});
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("loginChallenges")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now()))
      .take(100);
    for (const row of expired) await ctx.db.delete(row._id);
    return expired.length;
  },
});
/** One-time, idempotent cutover: email keys and retired credential rows only. No user IDs are recreated. */
export const normalizeExistingEmails = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("users")
      .paginate({ cursor, numItems: 100 });
    let normalized = 0;
    for (const user of page.page) {
      if (user.email) {
        const email = normalizeAuthEmail(user.email);
        if (user.email !== email) {
          await ctx.db.patch(user._id, { email });
          normalized++;
        }
      }
    }
    return { isDone: page.isDone, cursor: page.continueCursor, normalized };
  },
});
export const retirePasswords = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "password"))
      .take(100);
    for (const row of rows) await ctx.db.delete(row._id);
    return { removed: rows.length, isDone: rows.length < 100 };
  },
});
