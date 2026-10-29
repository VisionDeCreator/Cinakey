import { mediaUnavailable } from "./mediaControls";
import { hasAdminPermission, type AdminPermission } from "@cinakey/shared";
import { assertPaymentProduction } from "./paymentAccess";
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/**
 * Require an authenticated user. Throws if not signed in.
 */
export async function requireUser(
  ctx: Ctx,
  allowSuspended = false,
): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not authenticated");
  }
  const user = await ctx.db.get(userId);
  if (user === null) {
    throw new Error("User not found");
  }
  if (user.sessionsRevokedAt !== undefined) {
    const rawSessionId = await getAuthSessionId(ctx);
    const sessionId = rawSessionId
      ? ctx.db.normalizeId("authSessions", rawSessionId)
      : null;
    const session = sessionId ? await ctx.db.get(sessionId) : null;
    if (
      !session ||
      session.userId !== user._id ||
      Math.floor(session._creationTime) <= user.sessionsRevokedAt ||
      session.expirationTime <= Date.now()
    )
      throw new Error("Session revoked. Sign in again.");
  }
  if (!allowSuspended && user.suspendedAt !== undefined)
    throw new Error("This account is suspended. Contact support.");
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

export async function requireAdminPermission(
  ctx: Ctx,
  permission: AdminPermission,
) {
  const user = await requireStaff(ctx);
  if (!hasAdminPermission(user, permission))
    throw new Error("Staff access denied: permission required");
  return user;
}

export type WorkspaceRole = "owner" | "admin" | "creator" | "reviewer";

export async function workspaceRole(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
): Promise<WorkspaceRole | null> {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) return null;
  if (workspace.ownerUserId === userId) return "owner";
  const member = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", userId),
    )
    .unique();
  return member?.role ?? null;
}

export async function canAccessProject(
  ctx: Ctx,
  project: Doc<"projects">,
  user: Doc<"users">,
): Promise<boolean> {
  const role = await workspaceRole(ctx, project.workspaceId, user._id);
  if (role === "owner" || role === "admin") return true;
  if (role !== "creator") return false;
  const assignments = await ctx.db
    .query("productionAssignments")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", project.workspaceId).eq("userId", user._id),
    )
    .collect();
  return assignments.some(
    (a) =>
      a.projectId === project._id ||
      (project.seriesId !== undefined && a.seriesId === project.seriesId),
  );
}

export async function requireProjectAccessForUser(
  ctx: Ctx,
  projectId: Id<"projects">,
  userId: Id<"users">,
) {
  const project = await ctx.db.get(projectId);
  const user = await ctx.db.get(userId);
  if (!project) throw new Error("Project not found");
  if (
    !user ||
    user.suspendedAt !== undefined ||
    !(await canAccessProject(ctx, project, user))
  )
    throw new Error("Project access denied");
  return project;
}

/** Production access requires an active creator assignment or workspace administration. */
export async function requireProjectAccess(
  ctx: Ctx,
  projectId: Id<"projects">,
): Promise<Doc<"projects">> {
  const user = await requireUser(ctx);
  return requireProjectAccessForUser(ctx, projectId, user._id);
}

/** Kept for operations that deliberately require ownership, not membership. */
export function isWorkspaceOwner(
  user: Doc<"users">,
  workspace: Doc<"workspaces">,
): boolean {
  return workspace.ownerUserId === user._id;
}

/** Workspace-wide production operations are restricted to administrators. */
export async function requireWorkspaceAccess(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
) {
  const user = await requireUser(ctx);
  const workspace = await ctx.db.get(workspaceId);
  const role = await workspaceRole(ctx, workspaceId, user._id);
  if (!workspace || (role !== "owner" && role !== "admin"))
    throw new Error("Workspace access denied");
  return workspace;
}

export async function requireSeriesAccess(ctx: Ctx, seriesId: Id<"series">) {
  const series = await ctx.db.get(seriesId);
  if (!series) throw new Error("Series not found");
  // This helper is also used by series mutations; creators cannot administer series.
  await requireWorkspaceAccess(ctx, series.workspaceId);
  return series;
}

export async function requireAssetAccess(ctx: Ctx, assetId: Id<"assets">) {
  const asset = await ctx.db.get(assetId);
  if (!asset) throw new Error("Asset not found");
  if (asset.projectId) await requireProjectAccess(ctx, asset.projectId);
  else if (asset.workspaceId)
    await requireWorkspaceAccess(ctx, asset.workspaceId);
  else throw new Error("Asset has no owner");
  return asset;
}

export async function accessibleWorkspaceIds(ctx: Ctx, user: Doc<"users">) {
  const owned = await ctx.db
    .query("workspaces")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
    .collect();
  const memberships = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  return [
    ...new Set([
      ...owned.map((w) => w._id),
      ...memberships.map((m) => m.workspaceId),
    ]),
  ];
}

/** Membership is explicit: owning a workspace alone does not attach a file to a production. */
export async function projectCanUseAsset(
  ctx: Ctx,
  projectId: Id<"projects">,
  assetId: Id<"assets">,
) {
  const asset = await ctx.db.get(assetId);
  if (!asset || (await mediaUnavailable(ctx, asset.storageId))) return false;
  if (asset.projectId === projectId) return true;
  return !!(await ctx.db
    .query("projectAssetLinks")
    .withIndex("by_project_asset", (q) =>
      q.eq("projectId", projectId).eq("assetId", assetId),
    )
    .first());
}

export async function projectAssets(ctx: Ctx, projectId: Id<"projects">) {
  const owned = await ctx.db
    .query("assets")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const links = await ctx.db
    .query("projectAssetLinks")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const rows = new Map(owned.map((a) => [a._id, a]));
  for (const link of links) {
    const asset = await ctx.db.get(link.assetId);
    if (asset) rows.set(asset._id, asset);
  }
  return [...rows.values()];
}

/** Membership alone permits workspace selection, never workspace-wide production access. */
export async function requireWorkspaceMembership(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
) {
  const user = await requireUser(ctx);
  const role = await workspaceRole(ctx, workspaceId, user._id);
  if (!role) throw new Error("Workspace access denied");
  return { user, role };
}

/** Read permission and subscription write permission are deliberately independent. */
export async function requireProjectWrite(ctx: Ctx, projectId: Id<"projects">) {
  const project = await requireProjectAccess(ctx, projectId);
  await assertPaymentProduction(ctx, project.workspaceId);
  return project;
}
export async function requireSeriesWrite(ctx: Ctx, seriesId: Id<"series">) {
  const series = await requireSeriesAccess(ctx, seriesId);
  await assertPaymentProduction(ctx, series.workspaceId);
  return series;
}
/** Administrative production freezes also cover edits allowed after subscription expiry. */
export async function requireProjectUnpausedAccess(
  ctx: Ctx,
  projectId: Id<"projects">,
) {
  const project = await requireProjectAccess(ctx, projectId);
  await assertWorkspaceUnpaused(ctx, project.workspaceId);
  return project;
}
export async function requireSeriesUnpausedAccess(
  ctx: Ctx,
  seriesId: Id<"series">,
) {
  const series = await requireSeriesAccess(ctx, seriesId);
  await assertWorkspaceUnpaused(ctx, series.workspaceId);
  return series;
}
export async function assertWorkspaceUnpaused(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
) {
  if ((await ctx.db.get(workspaceId))?.productionPausedAt !== undefined)
    throw new Error(
      "Production is paused for this workspace. Contact support.",
    );
}
