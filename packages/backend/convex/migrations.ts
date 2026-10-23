import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { buildSearchText } from "./lib/assetSearch";
import { PROMPT_TEMPLATE_VERSION } from "./lib/promptRender";

/**
 * One-shot Phase 4 backfill: asset name/searchText + structured project brief.
 * Run: `npx convex run migrations:migratePhase4`
 */
export const migratePhase4 = internalMutation({
  args: {},
  handler: async (ctx) => {
    let assetsPatched = 0;
    let projectsPatched = 0;

    const assets = await ctx.db.query("assets").collect();
    for (const asset of assets) {
      const row = asset as typeof asset & {
        name?: string;
        searchText?: string;
      };
      if (row.name !== undefined && row.searchText !== undefined) {
        continue;
      }
      const name = row.name?.trim() || `Untitled ${asset.type}`;
      await ctx.db.patch(asset._id, {
        name,
        searchText: buildSearchText(name, asset.tags ?? []),
      });
      assetsPatched += 1;
    }

    const projects = await ctx.db.query("projects").collect();
    for (const project of projects) {
      const brief = (project as { brief?: unknown }).brief;
      if (typeof brief === "string") {
        await ctx.db.patch(project._id, {
          brief: {
            logline: brief,
          },
        });
        projectsPatched += 1;
      }
    }

    return { assetsPatched, projectsPatched };
  },
});

export const listProjectsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("projects").collect();
  },
});

export const listEntitiesForProjectInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("entities")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const listTipSheetsInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("promptSheets")
      .withIndex("by_project_tip", (q) =>
        q.eq("projectId", args.projectId).eq("isTip", true),
      )
      .collect();
  },
});

export const patchStyleReferenceInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    styleReferenceAssetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (project === null) return;
    if (project.styleReferenceAssetId !== undefined) return;
    await ctx.db.patch(args.projectId, {
      styleReferenceAssetId: args.styleReferenceAssetId,
      updatedAt: Date.now(),
    });
  },
});

export const insertMigratedTipInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    type: v.union(
      v.literal("character"),
      v.literal("creature"),
      v.literal("environment"),
      v.literal("product"),
    ),
    entityId: v.id("entities"),
    structuredFileId: v.id("_storage"),
    renderedText: v.optional(v.string()),
    renderedFileId: v.optional(v.id("_storage")),
    demoteTipId: v.optional(v.id("promptSheets")),
    parentId: v.optional(v.id("promptSheets")),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.demoteTipId) {
      await ctx.db.patch(args.demoteTipId, { isTip: false, updatedAt: now });
    }
    return await ctx.db.insert("promptSheets", {
      projectId: args.projectId,
      type: args.type,
      entityId: args.entityId,
      structuredFileId: args.structuredFileId,
      renderedText: args.renderedText,
      renderedFileId: args.renderedFileId,
      templateVersion: PROMPT_TEMPLATE_VERSION,
      status: "draft",
      isCustom: true,
      parentId: args.parentId,
      version: args.version,
      isTip: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const listSequencesInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sequences")
      .withIndex("by_project_order", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const listShotsInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("shots")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const patchScriptTipRenderedInternal = internalMutation({
  args: {
    promptSheetId: v.id("promptSheets"),
    renderedText: v.optional(v.string()),
    renderedFileId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.promptSheetId, {
      ...(args.renderedText !== undefined
        ? { renderedText: args.renderedText }
        : {}),
      ...(args.renderedFileId !== undefined
        ? { renderedFileId: args.renderedFileId }
        : {}),
      updatedAt: Date.now(),
    });
  },
});

export const ensureSequenceForScriptInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    scriptPromptId: v.optional(v.id("promptSheets")),
    title: v.string(),
    durationSec: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("sequences")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return await ctx.db.insert("sequences", {
      projectId: args.projectId,
      order: existing.length,
      title: args.title,
      durationSec: args.durationSec,
      scriptPromptId: args.scriptPromptId,
      shotIds: [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const patchSequenceScriptInternal = internalMutation({
  args: {
    sequenceId: v.id("sequences"),
    scriptPromptId: v.id("promptSheets"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sequenceId, {
      scriptPromptId: args.scriptPromptId,
      updatedAt: Date.now(),
    });
  },
});

export const insertScriptTipInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    sequenceId: v.id("sequences"),
    structuredFileId: v.id("_storage"),
    renderedFileId: v.optional(v.id("_storage")),
    renderedText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tipId = await ctx.db.insert("promptSheets", {
      projectId: args.projectId,
      type: "script",
      sequenceId: args.sequenceId,
      structuredFileId: args.structuredFileId,
      renderedText: args.renderedText,
      renderedFileId: args.renderedFileId,
      templateVersion: PROMPT_TEMPLATE_VERSION,
      status: "draft",
      isCustom: true,
      version: 1,
      isTip: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.sequenceId, {
      scriptPromptId: tipId,
      updatedAt: now,
    });
    return tipId;
  },
});

export const backfillSequenceShotsInternal = internalMutation({
  args: {
    sequenceId: v.id("sequences"),
    projectId: v.id("projects"),
    shots: v.array(
      v.object({
        n: v.number(),
        shotType: v.string(),
        cameraMove: v.optional(v.string()),
        startSec: v.number(),
        endSec: v.number(),
        durationSec: v.number(),
        notes: v.optional(v.string()),
        scriptLineKey: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = (
      await ctx.db
        .query("shots")
        .withIndex("by_sequence", (q) => q.eq("sequenceId", args.sequenceId))
        .collect()
    ).sort((a, b) => a.order - b.order);

    // Also gather unsequenced project shots if sequence has none
    let pool = existing;
    if (pool.length === 0) {
      pool = (
        await ctx.db
          .query("shots")
          .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
          .collect()
      ).sort((a, b) => a.order - b.order);
    }

    const now = Date.now();
    let patched = 0;
    const ids: Id<"shots">[] = [];
    for (const [i, shot] of args.shots.entries()) {
      const prev = pool[i];
      if (!prev) break;
      await ctx.db.patch(prev._id, {
        sequenceId: args.sequenceId,
        order: i,
        startSec: shot.startSec,
        endSec: shot.endSec,
        durationSec: shot.durationSec,
        scriptLineKey: shot.scriptLineKey,
        notes: shot.notes ?? prev.notes,
        updatedAt: now,
      });
      ids.push(prev._id);
      patched += 1;
    }
    if (ids.length > 0) {
      await ctx.db.patch(args.sequenceId, {
        shotIds: ids,
        updatedAt: now,
      });
    }
    return patched;
  },
});
