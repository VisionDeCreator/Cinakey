import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { STARTER_CREDITS } from "./limits";

/**
 * Create a personal workspace for a user and link it on the user doc.
 * No-ops if the user already has a personalWorkspaceId.
 * Grants one-time starter credits on first create.
 */
export async function ensurePersonalWorkspaceForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Id<"workspaces">> {
  const user = await ctx.db.get(userId);
  if (user === null) {
    throw new Error("User not found");
  }
  if (user.personalWorkspaceId !== undefined) {
    const existing = await ctx.db.get(user.personalWorkspaceId);
    if (existing !== null) {
      await maybeGrantStarterCredits(ctx, existing._id, userId);
      return existing._id;
    }
  }

  const now = Date.now();
  const name =
    user.name !== undefined && user.name.length > 0
      ? `${user.name}'s Workspace`
      : user.email !== undefined
        ? `${user.email}'s Workspace`
        : "Personal Workspace";

  const workspaceId = await ctx.db.insert("workspaces", {
    name,
    ownerUserId: userId,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.patch(userId, { personalWorkspaceId: workspaceId });
  await maybeGrantStarterCredits(ctx, workspaceId, userId);
  return workspaceId;
}

async function maybeGrantStarterCredits(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
): Promise<void> {
  const workspace = await ctx.db.get(workspaceId);
  if (workspace === null) return;
  if (workspace.starterCreditsGrantedAt !== undefined) return;

  const latest = await ctx.db
    .query("creditLedger")
    .withIndex("by_workspace_time", (q) => q.eq("workspaceId", workspaceId))
    .order("desc")
    .first();
  const prev = latest?.balanceAfter ?? 0;
  const now = Date.now();
  await ctx.db.insert("creditLedger", {
    workspaceId,
    userId,
    delta: STARTER_CREDITS,
    reason: "grant",
    balanceAfter: prev + STARTER_CREDITS,
    createdAt: now,
  });
  await ctx.db.patch(workspaceId, {
    starterCreditsGrantedAt: now,
    updatedAt: now,
  });
}
