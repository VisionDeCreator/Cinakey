import { v } from "convex/values";
import {
  referenceAlias,
  replacementReferenceAlias,
  renameReferenceMentions,
  scriptMentions,
} from "@cinakey/shared";
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
    expectedAssetId: v.optional(v.id("assets")),
  },
  handler: async (ctx, { projectId, alias: raw, assetId, expectedAssetId }) => {
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
    if (
      expectedAssetId &&
      project.referenceBindings?.find((b) => b.alias === alias)?.assetId !==
        expectedAssetId
    )
      throw new Error(
        "This reference changed in another window. Refresh before undoing.",
      );
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

/** Rename the alias and current plain-text script together with a version conflict check. */
export const rename = mutation({
  args: {
    projectId: v.id("projects"),
    alias: v.string(),
    newAlias: v.string(),
    expectedId: v.id("workspaceScripts"),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectAccess(ctx, args.projectId);
    const alias = referenceAlias(args.alias),
      newAlias = referenceAlias(args.newAlias);
    if (!newAlias || newAlias.length > 80)
      throw new Error("Use a reference name of 1–80 characters.");
    const bindings = project.referenceBindings ?? [];
    const binding = bindings.find((b) => b.alias === alias);
    if (!binding) throw new Error("Link this reference before renaming it.");
    if (alias !== newAlias && bindings.some((b) => b.alias === newAlias))
      throw new Error("That reference name is already in use.");
    const asset = await ctx.db.get(binding.assetId);
    if (
      !asset ||
      (/^image_\d+$/.test(newAlias) && asset.type !== "image") ||
      (/^video_\d+$/.test(newAlias) && asset.type !== "video")
    )
      throw new Error("The reference name must match the media type.");
    const rows = await ctx.db
      .query("workspaceScripts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const tip = rows.find((row) => row.isTip);
    if (!tip || tip._id !== args.expectedId)
      throw new Error(
        "Script changed in another window. Reload before renaming.",
      );
    if (tip.text === undefined)
      throw new Error("Save the script before renaming a reference.");
    // Do not capture another unbound mention that happens to use the new name.
    if (alias !== newAlias && scriptMentions(tip.text).includes(newAlias))
      throw new Error(
        "That name already appears in the script. Choose a different name.",
      );
    const text = renameReferenceMentions(tip.text, alias, newAlias);
    if (text.length > 200000)
      throw new Error("Renaming would exceed the script length limit.");
    if (alias === newAlias) return { id: tip._id, text };
    await ctx.db.patch(tip._id, { isTip: false });
    const id = await ctx.db.insert("workspaceScripts", {
      projectId: args.projectId,
      text,
      parentId: tip._id,
      label: `Rename @${alias} to @${newAlias}`,
      isTip: true,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.projectId, {
      referenceBindings: bindings.map((b) =>
        b.alias === alias ? { ...b, alias: newAlias } : b,
      ),
      updatedAt: Date.now(),
    });
    return { id, text };
  },
});

/** Change media type and rewrite only this alias in one transaction. */
export const replace = mutation({
  args: {
    projectId: v.id("projects"),
    alias: v.string(),
    assetId: v.id("assets"),
    expectedId: v.id("workspaceScripts"),
    expectedAssetId: v.union(v.id("assets"), v.null()),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectAccess(ctx, args.projectId);
    if (!(await projectCanUseAsset(ctx, args.projectId, args.assetId)))
      throw new Error("Asset not found in this project");
    const asset = await ctx.db.get(args.assetId);
    if (!asset || !["image", "video"].includes(asset.type))
      throw new Error("References must be images or videos.");
    const alias = referenceAlias(args.alias);
    const bindings = project.referenceBindings ?? [];
    const previousAssetId =
      bindings.find((b) => b.alias === alias)?.assetId ?? null;
    if (previousAssetId !== args.expectedAssetId)
      throw new Error(
        "This reference changed in another window. Refresh before replacing.",
      );
    const rows = await ctx.db
      .query("workspaceScripts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const tip = rows.find((r) => r.isTip);
    if (!tip || tip._id !== args.expectedId)
      throw new Error(
        "Script changed in another window. Reload before replacing.",
      );
    if (tip.text === undefined)
      throw new Error("Save the script before replacing a reference.");
    if (!scriptMentions(tip.text).includes(alias))
      throw new Error("This reference no longer appears in the script.");
    const newAlias = replacementReferenceAlias(alias, asset.type, [
      ...bindings.map((b) => b.alias),
      ...scriptMentions(tip.text),
    ]);
    const text = renameReferenceMentions(tip.text, alias, newAlias);
    if (text.length > 200000)
      throw new Error("Replacement would exceed the script length limit.");
    await ctx.db.patch(tip._id, { isTip: false });
    const id = await ctx.db.insert("workspaceScripts", {
      projectId: args.projectId,
      text,
      parentId: tip._id,
      label: `Replace @${alias} with @${newAlias}`,
      isTip: true,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.projectId, {
      referenceBindings: [
        ...bindings.filter((b) => b.alias !== alias),
        { alias: newAlias, assetId: args.assetId },
      ],
      updatedAt: Date.now(),
    });
    return {
      id,
      text,
      alias: newAlias,
      previousVersionId: tip._id,
      previousAssetId,
    };
  },
});

/** Exact-version undo preserves the original pasted spelling and unrelated references. */
export const undoReplacement = mutation({
  args: {
    projectId: v.id("projects"),
    expectedId: v.id("workspaceScripts"),
    previousVersionId: v.id("workspaceScripts"),
    alias: v.string(),
    originalAlias: v.string(),
    assetId: v.id("assets"),
    previousAssetId: v.union(v.id("assets"), v.null()),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectAccess(ctx, args.projectId);
    const current = await ctx.db.get(args.expectedId),
      previous = await ctx.db.get(args.previousVersionId);
    if (
      !current?.isTip ||
      current.projectId !== args.projectId ||
      current.parentId !== args.previousVersionId ||
      previous?.projectId !== args.projectId ||
      previous.text === undefined
    )
      throw new Error(
        "The script has changed. Use script history to restore an earlier version.",
      );
    const bindings = project.referenceBindings ?? [];
    if (
      bindings.find((b) => b.alias === args.alias)?.assetId !== args.assetId ||
      (args.alias !== args.originalAlias &&
        bindings.some((b) => b.alias === args.originalAlias))
    )
      throw new Error(
        "This reference changed in another window. Refresh before undoing.",
      );
    if (
      args.previousAssetId &&
      !(await projectCanUseAsset(ctx, args.projectId, args.previousAssetId))
    )
      throw new Error("The previous asset is no longer available.");
    await ctx.db.patch(current._id, { isTip: false });
    const id = await ctx.db.insert("workspaceScripts", {
      projectId: args.projectId,
      text: previous.text,
      parentId: current._id,
      label: "Undo reference replacement",
      isTip: true,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.projectId, {
      referenceBindings: [
        ...bindings.filter((b) => b.alias !== args.alias),
        ...(args.previousAssetId
          ? [{ alias: args.originalAlias, assetId: args.previousAssetId }]
          : []),
      ],
      updatedAt: Date.now(),
    });
    return { id, text: previous.text };
  },
});
