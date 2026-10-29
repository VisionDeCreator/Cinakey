import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
type Ctx = QueryCtx | MutationCtx;
export const mediaControl = (ctx: Ctx, storageId: string) =>
  ctx.db
    .query("mediaControls")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .unique();
export async function mediaUnavailable(ctx: Ctx, storageId: string) {
  return (await mediaControl(ctx, storageId))?.quarantined === true;
}
export async function assertMediaNotHeld(ctx: Ctx, storageId: string) {
  const control = await mediaControl(ctx, storageId);
  if (control?.retentionHold || control?.quarantined)
    throw new Error("Media is quarantined or under a retention hold");
}
export async function r2References(ctx: Ctx, id: Id<"r2Files">) {
  const [asset, media, publication, staged, upload] = await Promise.all([
    ctx.db
      .query("assets")
      .withIndex("by_storage", (q) => q.eq("storageId", id))
      .first(),
    ctx.db
      .query("mediaFiles")
      .withIndex("by_storage", (q) => q.eq("storageId", id))
      .first(),
    ctx.db
      .query("publishedExports")
      .withIndex("by_storage", (q) => q.eq("storageId", id))
      .first(),
    ctx.db
      .query("publishedExports")
      .withIndex("by_staged", (q) => q.eq("stagedStorageId", id))
      .first(),
    ctx.db
      .query("r2Uploads")
      .withIndex("by_file", (q) => q.eq("fileId", id))
      .first(),
  ]);
  return {
    asset: !!asset,
    media: !!media,
    publication: !!publication,
    staged: !!staged,
    upload: !!upload,
  };
}
export function hasR2References(
  refs: Awaited<ReturnType<typeof r2References>>,
) {
  return Object.values(refs).some(Boolean);
}
/** Account purge must preserve the ownership/reference records as well as the bytes. */
export async function assertWorkspaceNoMediaHolds(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
) {
  const [media, r2, publications, projects, workspaceAssets] =
    await Promise.all([
      ctx.db
        .query("mediaFiles")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("r2Files")
        .withIndex("by_workspace_created", (q) =>
          q.eq("workspaceId", workspaceId),
        )
        .collect(),
      ctx.db
        .query("publishedExports")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("projects")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("assets")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
    ]);
  const files = new Set<string>([
    ...workspaceAssets.map((a) => a.storageId),
    ...media.map((f) => f.storageId),
    ...r2.map((f) => f._id),
  ]);
  for (const publication of publications) {
    if (publication.storageId) files.add(publication.storageId);
    if (publication.stagedStorageId) files.add(publication.stagedStorageId);
  }
  for (const project of projects) {
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    for (const asset of assets) files.add(asset.storageId);
  }
  for (const id of files) await assertMediaNotHeld(ctx, id);
}
