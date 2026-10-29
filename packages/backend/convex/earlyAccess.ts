import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { assertRateLimit } from "./lib/rateLimit";
/** Waitlist only: never creates users, invitations, or access entitlements. */
export const request = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    idea: v.string(),
    clientKey: v.string(),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase(),
      name = args.name.trim(),
      idea = args.idea.trim();
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      name.length > 100 ||
      idea.length > 1000 ||
      !/^[a-f0-9]{64}$/.test(args.clientKey)
    )
      throw new Error("Invalid request");
    await assertRateLimit(
      ctx,
      `early-access:${args.clientKey}`,
      5,
      60 * 60 * 1000,
    );
    const existing = await ctx.db
      .query("earlyAccessRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!existing)
      await ctx.db.insert("earlyAccessRequests", {
        email,
        name,
        idea,
        status: "pending",
        createdAt: Date.now(),
      });
    return { ok: true };
  },
});
