import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
export const recipient = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return user?.notificationEmailEnabled !== false
      ? (user?.email ?? null)
      : null;
  },
});
