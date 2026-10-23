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

export async function requireWorkspaceAccess(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
) {
  const user = await requireUser(ctx);
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || !isWorkspaceOwner(user, workspace))
    throw new Error("Workspace access denied");
  return workspace;
}

export async function requireSeriesAccess(ctx: Ctx, seriesId: Id<"series">) {
  const series = await ctx.db.get(seriesId);
  if (!series) throw new Error("Series not found");
  await requireWorkspaceAccess(ctx, series.workspaceId);
  return series;
}

export async function requireAssetAccess(ctx: Ctx, assetId: Id<"assets">) {
  const asset = await ctx.db.get(assetId);
  if (!asset) throw new Error("Asset not found");
  if (asset.workspaceId) await requireWorkspaceAccess(ctx, asset.workspaceId);
  else if (asset.projectId) await requireProjectAccess(ctx, asset.projectId);
  else throw new Error("Asset has no owner");
  return asset;
}

/** Membership is explicit: owning a workspace alone does not attach a file to a production. */
export async function projectCanUseAsset(
  ctx: Ctx,
  projectId: Id<"projects">,
  assetId: Id<"assets">,
) {
  const asset = await ctx.db.get(assetId);
  if (!asset) return false;
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
