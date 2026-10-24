import { v } from "convex/values";
import { referenceAlias } from "@cinakey/shared";
import { mutation, query } from "./_generated/server";
import { projectCanUseAsset, requireProjectAccess } from "./lib/access";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await requireProjectAccess(ctx, projectId);
    return project.referenceBindings ?? [];
  },
});

/** Atomic replacement means every mention of an alias points at one media ID. */
export const bind = mutation({
  args: {
    projectId: v.id("projects"),
    alias: v.string(),
    assetId: v.id("assets"),
  },
  handler: async (ctx, { projectId, alias: raw, assetId }) => {
    const project = await requireProjectAccess(ctx, projectId);
    const alias = referenceAlias(raw);
    if (!alias || alias.length > 80)
      throw new Error("Use a reference name of 1–80 characters.");
    if (!(await projectCanUseAsset(ctx, projectId, assetId)))
      throw new Error("Asset not found in this project");
    const asset = await ctx.db.get(assetId);
    if (!asset || !["image", "video"].includes(asset.type))
      throw new Error("References must be images or videos.");
    if (
      (/^image_\d+$/.test(alias) && asset.type !== "image") ||
      (/^video_\d+$/.test(alias) && asset.type !== "video")
    )
      throw new Error("The reference name must match the media type.");
    const bindings = (project.referenceBindings ?? []).filter(
      (b) => b.alias !== alias,
    );
    bindings.push({ alias, assetId });
    await ctx.db.patch(projectId, {
      referenceBindings: bindings,
      updatedAt: Date.now(),
    });
    return { alias, assetId };
  },
});
