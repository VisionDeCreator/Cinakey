import { query } from "./_generated/server";
import { requireUser } from "./lib/access";
/** Validates Convex Auth tokens before the API uses an authenticated service context. */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return { identity: await ctx.auth.getUserIdentity(), userId: user._id };
  },
});
