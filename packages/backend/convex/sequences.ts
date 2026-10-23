import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireProjectAccess } from "./lib/access";
import { markBlockoutStaleForScriptPrompt } from "./lib/promptSheetDeps";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    return await ctx.db
      .query("sequences")
      .withIndex("by_project_order", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const listInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sequences")
      .withIndex("by_project_order", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const getInternal = internalQuery({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => ctx.db.get(args.sequenceId),
});

export const upsertFromScriptPrompt = internalMutation({
  args: {
    projectId: v.id("projects"),
    scriptPromptId: v.optional(v.id("promptSheets")),
    title: v.string(),
    durationSec: v.number(),
    order: v.number(),
    existingSequenceId: v.optional(v.id("sequences")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.existingSequenceId) {
      await ctx.db.patch(args.existingSequenceId, {
        title: args.title,
        durationSec: args.durationSec,
        ...(args.scriptPromptId ? { scriptPromptId: args.scriptPromptId } : {}),
        updatedAt: now,
      });
      return args.existingSequenceId;
    }
    return await ctx.db.insert("sequences", {
      projectId: args.projectId,
      order: args.order,
      title: args.title,
      durationSec: args.durationSec,
      scriptPromptId: args.scriptPromptId,
      shotIds: [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const setShotIds = internalMutation({
  args: {
    sequenceId: v.id("sequences"),
    shotIds: v.array(v.id("shots")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sequenceId, {
      shotIds: args.shotIds,
      updatedAt: Date.now(),
    });
  },
});

export const linkSequenceOnSheet = internalMutation({
  args: {
    promptSheetId: v.id("promptSheets"),
    sequenceId: v.id("sequences"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.promptSheetId, {
      sequenceId: args.sequenceId,
      updatedAt: Date.now(),
    });
  },
});

export const ensureScene = internalMutation({
  args: {
    projectId: v.id("projects"),
    elementId: v.string(),
    heading: v.string(),
    synopsis: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("scenes")
      .withIndex("by_project_element", (q) =>
        q.eq("projectId", args.projectId).eq("elementId", args.elementId),
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        heading: args.heading,
        synopsis: args.synopsis,
        updatedAt: now,
      });
      return existing._id;
    }
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const order = scenes.length;
    return await ctx.db.insert("scenes", {
      projectId: args.projectId,
      elementId: args.elementId,
      order,
      heading: args.heading,
      synopsis: args.synopsis,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const replaceSequenceShots = internalMutation({
  args: {
    projectId: v.id("projects"),
    sceneId: v.id("scenes"),
    sequenceId: v.id("sequences"),
    shots: v.array(
      v.object({
        n: v.number(),
        shotType: v.string(),
        cameraMove: v.optional(v.string()),
        startSec: v.number(),
        endSec: v.number(),
        durationSec: v.number(),
        notes: v.optional(v.string()),
        scriptLineKey: v.optional(v.string()),
        characterIds: v.array(v.id("entities")),
        locationId: v.optional(v.id("entities")),
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

    const now = Date.now();
    const ids: Id<"shots">[] = [];
    const used = new Set<Id<"shots">>();

    for (const [i, shot] of args.shots.entries()) {
      const lineKey =
        shot.scriptLineKey ??
        [
          shot.n,
          shot.startSec,
          shot.endSec,
          shot.shotType.trim(),
          (shot.cameraMove ?? "").trim(),
          (shot.notes ?? "").trim(),
        ].join("|");
      const prev = existing[i];
      if (prev) {
        used.add(prev._id);
        await ctx.db.patch(prev._id, {
          sceneId: args.sceneId,
          order: i,
          shotType: shot.shotType,
          cameraMove: shot.cameraMove,
          durationSec: shot.durationSec,
          startSec: shot.startSec,
          endSec: shot.endSec,
          characterIds: shot.characterIds,
          locationId: shot.locationId,
          notes: shot.notes,
          scriptLineKey: lineKey,
          outdated: false,
          updatedAt: now,
        });
        ids.push(prev._id);
      } else {
        const id = await ctx.db.insert("shots", {
          projectId: args.projectId,
          sceneId: args.sceneId,
          sequenceId: args.sequenceId,
          order: i,
          shotType: shot.shotType,
          cameraMove: shot.cameraMove,
          durationSec: shot.durationSec,
          startSec: shot.startSec,
          endSec: shot.endSec,
          characterIds: shot.characterIds,
          locationId: shot.locationId,
          status: "planned",
          outdated: false,
          notes: shot.notes,
          scriptLineKey: lineKey,
          createdAt: now,
          updatedAt: now,
        });
        ids.push(id);
      }
    }

    for (const s of existing) {
      if (!used.has(s._id)) {
        await ctx.db.delete(s._id);
      }
    }

    return ids;
  },
});

export const markShotBlockoutSynced = internalMutation({
  args: {
    shotId: v.id("shots"),
    blockoutScriptLineKey: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.shotId, {
      blockoutScriptLineKey: args.blockoutScriptLineKey,
      updatedAt: Date.now(),
    });
  },
});

export const setPrevizAssetId = internalMutation({
  args: {
    sequenceId: v.id("sequences"),
    previzAssetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sequenceId, {
      previzAssetId: args.previzAssetId,
      updatedAt: Date.now(),
    });
  },
});

export const getShotInternal = internalQuery({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args) => ctx.db.get(args.shotId),
});

export const markBlockoutStale = internalMutation({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => {
    const seq = await ctx.db.get(args.sequenceId);
    if (seq?.scriptPromptId) {
      await markBlockoutStaleForScriptPrompt(ctx, seq.scriptPromptId);
    }
  },
});
