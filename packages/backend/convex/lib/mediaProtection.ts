import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function timelineUsesAsset(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  assetId: Id<"assets">,
) {
  const shared = await ctx.db
    .query("resourceAssetUses")
    .withIndex("by_asset", (q) => q.eq("assetId", assetId))
    .first();
  const linked = await ctx.db
    .query("projectAssetLinks")
    .withIndex("by_asset", (q) => q.eq("assetId", assetId))
    .first();
  if (shared || linked) return true;
  const asset = await ctx.db.get(assetId);
  if (
    asset &&
    (
      await ctx.db
        .query("assets")
        .withIndex("by_storage", (q) => q.eq("storageId", asset.storageId))
        .take(2)
    ).length > 1
  )
    return true;
  const versions = await ctx.db
    .query("timelineVersions")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return versions.some(
    (version) =>
      version.mediaAssetIds === undefined ||
      version.mediaAssetIds.includes(assetId),
  );
}
export async function assertMediaRemovable(
  ctx: MutationCtx,
  projectId: Id<"projects"> | undefined,
  assetId: Id<"assets">,
) {
  const used = await ctx.db
    .query("resourceAssetUses")
    .withIndex("by_asset", (q) => q.eq("assetId", assetId))
    .first();
  const linked = await ctx.db
    .query("projectAssetLinks")
    .withIndex("by_asset", (q) => q.eq("assetId", assetId))
    .first();
  if (used || linked)
    throw new Error(
      "This media is pinned by a shared resource or episode. Archive the resource instead.",
    );
  if (!projectId) return;
  if (await timelineUsesAsset(ctx, projectId, assetId))
    throw new Error(
      "This media is used by a saved timeline or its history. Keep it to preserve your edits.",
    );
  const takes = await ctx.db
    .query("takes")
    .filter((q) =>
      q.or(
        q.eq(q.field("assetId"), assetId),
        q.eq(q.field("proxyAssetId"), assetId),
      ),
    )
    .first();
  if (takes)
    throw new Error(
      "This media belongs to a video take. Remove it through Video instead.",
    );
  const asset = await ctx.db.get(assetId);
  if (asset) {
    const aliases = await ctx.db
      .query("assets")
      .withIndex("by_storage", (q) => q.eq("storageId", asset.storageId))
      .collect();
    if (aliases.some((other) => other._id !== assetId))
      throw new Error(
        "This file is shared by another asset and cannot be deleted",
      );
  }
  const shots = await ctx.db
    .query("shots")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const sequences = await ctx.db
    .query("sequences")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  if (
    shots.some((shot) => shot.keyframeAssetId === assetId) ||
    sequences.some((sequence) => sequence.previzAssetId === assetId)
  )
    throw new Error("This media is used as a shot or staging reference");
  const entities = await ctx.db
    .query("entities")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const project = await ctx.db.get(projectId);
  if (
    project?.styleReferenceAssetId === assetId ||
    entities.some((e) => e.lockedReferenceAssetIds.includes(assetId))
  )
    throw new Error(
      "Clear this image's reference assignments before deleting it.",
    );
}
