import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/access";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    try {
      return await requireUser(ctx);
    } catch {
      return null;
    }
  },
});

/**
 * Idempotent: ensures the signed-in user has a personal workspace.
 * Safe to call from the app shell after sign-in (covers users created
 * before the Auth callback existed, and test setups).
 */
export const ensurePersonalWorkspace = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await ensurePersonalWorkspaceForUser(ctx, user._id);
  },
});
