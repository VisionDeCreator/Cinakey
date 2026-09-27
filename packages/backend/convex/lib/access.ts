import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/**
 * Require an authenticated user. Throws if not signed in.
 */
export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not authenticated");
  }
  const user = await ctx.db.get(userId);
  if (user === null) {
    throw new Error("User not found");
  }
  return user;
}

/**
 * Require a staff user (isStaff === true).
 */
export async function requireStaff(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.isStaff !== true) {
    throw new Error("Staff access required");
  }
  return user;
}

/**
 * Require that the caller owns the project's workspace (or is staff).
 * Returns the project document on success.
 */
export async function requireProjectAccess(
  ctx: Ctx,
  projectId: Id<"projects">,
): Promise<Doc<"projects">> {
  const user = await requireUser(ctx);
  const project = await ctx.db.get(projectId);
  if (project === null) {
    throw new Error("Project not found");
  }

  if (user.isStaff === true) {
    return project;
  }

  const workspace = await ctx.db.get(project.workspaceId);
  if (workspace === null) {
    throw new Error("Workspace not found");
  }
  if (workspace.ownerUserId !== user._id) {
    throw new Error("Project access denied");
  }
  return project;
}

/**
 * True when the user owns the workspace (or is staff).
 */
export function isWorkspaceOwner(
  user: Doc<"users">,
  workspace: Doc<"workspaces">,
): boolean {
  return user.isStaff === true || workspace.ownerUserId === user._id;
}
