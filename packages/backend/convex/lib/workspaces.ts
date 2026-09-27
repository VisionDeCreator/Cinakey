import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Create a personal workspace for a user and link it on the user doc.
 * No-ops if the user already has a personalWorkspaceId.
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
  return workspaceId;
}
