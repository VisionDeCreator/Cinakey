import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireProjectAccess } from "./lib/access";
import {
  markBlockoutStaleForScriptPrompt,
  markScriptPromptsStaleForAssetSheet,
  markSheetsStaleForStyleChange,
} from "./lib/promptSheetDeps";
import { PROMPT_TEMPLATE_VERSION, isAssetSheetType } from "./lib/promptRender";

const typeValidator = v.union(
  v.literal("character"),
  v.literal("creature"),
  v.literal("environment"),
  v.literal("product"),
  v.literal("script"),
  v.literal("blockout"),
);

const statusValidator = v.union(
  v.literal("draft"),
  v.literal("approved"),
  v.literal("generating"),
  v.literal("done"),
  v.literal("out_of_date"),
);

export const listEntitiesInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("entities")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const getInternal = internalQuery({
  args: { promptSheetId: v.id("promptSheets") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.promptSheetId);
  },
});

export const listTips = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const rows = await ctx.db
      .query("promptSheets")
      .withIndex("by_project_tip", (q) =>
        q.eq("projectId", args.projectId).eq("isTip", true),
      )
      .collect();
    return rows.map((sheet) => ({
      _id: sheet._id,
      _creationTime: sheet._creationTime,
      entityId: sheet.entityId,
      sequenceId: sheet.sequenceId,
      type: sheet.type,
      status: sheet.status,
      version: sheet.version,
      projectId: sheet.projectId,
      updatedAt: sheet.updatedAt,
    }));
  },
});

export const listByType = query({
  args: {
    projectId: v.id("projects"),
    type: typeValidator,
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const rows = await ctx.db
      .query("promptSheets")
      .withIndex("by_project_type", (q) =>
        q.eq("projectId", args.projectId).eq("type", args.type),
      )
      .collect();
    return rows.filter((r) => r.isTip);
  },
});

export const get = query({
  args: { promptSheetId: v.id("promptSheets") },
  handler: async (ctx, args) => {
    const sheet = await ctx.db.get(args.promptSheetId);
    if (sheet === null) return null;
    await requireProjectAccess(ctx, sheet.projectId);
    return sheet;
  },
});

export const listTipsInternal = internalQuery({
  args: {
    projectId: v.id("projects"),
    type: v.optional(typeValidator),
  },
  handler: async (ctx, args) => {
    if (args.type) {
      const rows = await ctx.db
        .query("promptSheets")
        .withIndex("by_project_type", (q) =>
          q.eq("projectId", args.projectId).eq("type", args.type!),
        )
        .collect();
      return rows.filter((r) => r.isTip);
    }
    return await ctx.db
      .query("promptSheets")
      .withIndex("by_project_tip", (q) =>
        q.eq("projectId", args.projectId).eq("isTip", true),
      )
      .collect();
  },
});

export const insertTip = internalMutation({
  args: {
    projectId: v.id("projects"),
    type: typeValidator,
    entityId: v.optional(v.id("entities")),
    sequenceId: v.optional(v.id("sequences")),
    structuredFileId: v.id("_storage"),
    renderedText: v.optional(v.string()),
    renderedFileId: v.optional(v.id("_storage")),
    status: statusValidator,
    isCustom: v.boolean(),
    parentId: v.optional(v.id("promptSheets")),
    version: v.number(),
    referenceMap: v.optional(
      v.array(
        v.object({
          imageN: v.number(),
          entityId: v.id("entities"),
        }),
      ),
    ),
    sourceAssetSheetIds: v.optional(v.array(v.id("promptSheets"))),
    sourceScriptPromptId: v.optional(v.id("promptSheets")),
    demoteTipId: v.optional(v.id("promptSheets")),
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
      sequenceId: args.sequenceId,
      structuredFileId: args.structuredFileId,
      renderedText: args.renderedText,
      renderedFileId: args.renderedFileId,
      templateVersion: PROMPT_TEMPLATE_VERSION,
      status: args.status,
      isCustom: args.isCustom,
      parentId: args.parentId,
      version: args.version,
      referenceMap: args.referenceMap,
      sourceAssetSheetIds: args.sourceAssetSheetIds,
      sourceScriptPromptId: args.sourceScriptPromptId,
      isTip: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const patchStatus = internalMutation({
  args: {
    promptSheetId: v.id("promptSheets"),
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.promptSheetId, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const markStyleStale = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await markSheetsStaleForStyleChange(ctx, args.projectId);
  },
});

export const markAssetDependentsStale = internalMutation({
  args: { promptSheetId: v.id("promptSheets") },
  handler: async (ctx, args) => {
    return await markScriptPromptsStaleForAssetSheet(ctx, args.promptSheetId);
  },
});

export const markScriptDependentsStale = internalMutation({
  args: { promptSheetId: v.id("promptSheets") },
  handler: async (ctx, args) => {
    return await markBlockoutStaleForScriptPrompt(ctx, args.promptSheetId);
  },
});

/** Mark sheet done and lock the generated asset onto the entity. */
export const completeAssetGeneration = internalMutation({
  args: {
    promptSheetId: v.id("promptSheets"),
    assetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.promptSheetId, {
      status: "done",
      updatedAt: Date.now(),
    });
  },
});

export const patchEntityDescriptionInternal = internalMutation({
  args: {
    entityId: v.id("entities"),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.entityId, {
      description: args.description.trim(),
      updatedAt: Date.now(),
    });
  },
});

export const markAssetTipOutOfDateInternal = internalMutation({
  args: { promptSheetId: v.id("promptSheets") },
  handler: async (ctx, args) => {
    const sheet = await ctx.db.get(args.promptSheetId);
    if (!sheet || !sheet.isTip) return false;
    if (sheet.status === "out_of_date" || sheet.status === "draft")
      return false;
    await ctx.db.patch(args.promptSheetId, {
      status: "out_of_date",
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const getEntityInternal = internalQuery({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => ctx.db.get(args.entityId),
});

export const createEntityInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    kind: v.union(
      v.literal("character"),
      v.literal("creature"),
      v.literal("location"),
      v.literal("prop"),
    ),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("entities", {
      projectId: args.projectId,
      kind: args.kind,
      name: args.name.trim(),
      lockedReferenceAssetIds: [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const patchEntityKindInternal = internalMutation({
  args: {
    entityId: v.id("entities"),
    kind: v.union(
      v.literal("character"),
      v.literal("creature"),
      v.literal("location"),
      v.literal("prop"),
    ),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (entity === null || entity.kind === "style") return;
    const patch: {
      kind?: "character" | "creature" | "location" | "prop";
      name?: string;
      updatedAt: number;
    } = { updatedAt: Date.now() };
    if (entity.kind !== args.kind) patch.kind = args.kind;
    if (args.name && args.name !== entity.name) patch.name = args.name;
    if (Object.keys(patch).length > 1) {
      await ctx.db.patch(args.entityId, patch);
    }
  },
});

/** Pipeline summary for the Copilot tab. */
export const pipelineSummary = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const tips = await ctx.db
      .query("promptSheets")
      .withIndex("by_project_tip", (q) =>
        q.eq("projectId", args.projectId).eq("isTip", true),
      )
      .collect();
    const sequences = await ctx.db
      .query("sequences")
      .withIndex("by_project_order", (q) => q.eq("projectId", args.projectId))
      .collect();
    const project = await ctx.db.get(args.projectId);
    const assetSheets = tips.filter((t) => isAssetSheetType(t.type));
    const scriptSheets = tips.filter((t) => t.type === "script");
    const blockoutSheets = tips.filter((t) => t.type === "blockout");
    const gptCreditsPerImage = 10;
    const estimatedAssetCredits =
      assetSheets.filter(
        (s) => s.status === "draft" || s.status === "out_of_date",
      ).length * gptCreditsPerImage;

    return {
      story: {
        hasBrief: Boolean(project?.brief?.logline),
        logline: project?.brief?.logline ?? null,
      },
      assetSheets,
      scriptSheets,
      blockoutSheets,
      sequences,
      estimatedAssetCredits,
    };
  },
});

export type PromptSheetDoc = Doc<"promptSheets">;

/** Tip script prompt sheet for a sequence (part). */
export const getTipForSequence = query({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => {
    const sequence = await ctx.db.get(args.sequenceId);
    if (sequence === null) return null;
    await requireProjectAccess(ctx, sequence.projectId);
    if (sequence.scriptPromptId) {
      const tip = await ctx.db.get(sequence.scriptPromptId);
      if (tip?.isTip && tip.type === "script") return tip;
    }
    const tips = await ctx.db
      .query("promptSheets")
      .withIndex("by_sequence", (q) => q.eq("sequenceId", args.sequenceId))
      .collect();
    return (
      tips
        .filter((t) => t.isTip && t.type === "script")
        .sort((a, b) => b.version - a.version)[0] ?? null
    );
  },
});

/** Ordered script parts (sequences) with tip + previz + stale flags. */
export const listScriptParts = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const sequences = await ctx.db
      .query("sequences")
      .withIndex("by_project_order", (q) => q.eq("projectId", args.projectId))
      .collect();
    const tips = await ctx.db
      .query("promptSheets")
      .withIndex("by_project_tip", (q) =>
        q.eq("projectId", args.projectId).eq("isTip", true),
      )
      .collect();
    return sequences.map((seq, i) => {
      const scriptTip =
        (seq.scriptPromptId
          ? tips.find((t) => t._id === seq.scriptPromptId)
          : undefined) ??
        tips.find((t) => t.type === "script" && t.sequenceId === seq._id);
      const blockoutTip = tips.find(
        (t) => t.type === "blockout" && t.sequenceId === seq._id,
      );
      const scriptChanged =
        !blockoutTip ||
        blockoutTip.status === "out_of_date" ||
        blockoutTip.status === "draft" ||
        (scriptTip != null &&
          blockoutTip.sourceScriptPromptId !== undefined &&
          blockoutTip.sourceScriptPromptId !== scriptTip._id);
      return {
        sequenceId: seq._id,
        order: seq.order,
        label: seq.title?.trim() || `Part ${i + 1}`,
        durationSec: seq.durationSec,
        previzAssetId: seq.previzAssetId ?? null,
        scriptTipId: scriptTip?._id ?? null,
        scriptVersion: scriptTip?.version ?? null,
        scriptStatus: scriptTip?.status ?? null,
        renderedText: scriptTip?.renderedText ?? null,
        referenceMap: scriptTip?.referenceMap ?? [],
        blockoutTipId: blockoutTip?._id ?? null,
        blockoutStatus: blockoutTip?.status ?? null,
        scriptChanged,
        shotIds: seq.shotIds,
        /** A staging plan is stored, so "Rebuild from saved plan" can run free. */
        hasStagingPlan: Boolean(seq.stagingPlanFileId),
      };
    });
  },
});

/** Version history for a sequence's script prompt (newest first). */
export const listVersionsForSequence = query({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => {
    const sequence = await ctx.db.get(args.sequenceId);
    if (sequence === null) return [];
    await requireProjectAccess(ctx, sequence.projectId);
    const rows = await ctx.db
      .query("promptSheets")
      .withIndex("by_sequence", (q) => q.eq("sequenceId", args.sequenceId))
      .collect();
    return rows
      .filter((t) => t.type === "script")
      .sort((a, b) => b.version - a.version)
      .map((t) => ({
        _id: t._id,
        version: t.version,
        status: t.status,
        isTip: t.isTip,
        isCustom: t.isCustom,
        createdAt: t.createdAt,
        preview: (t.renderedText ?? "").slice(0, 120),
      }));
  },
});

/** Tip asset prompt sheet for an entity, with resolved rendered text. */
export const getTipForEntity = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (entity === null) return null;
    await requireProjectAccess(ctx, entity.projectId);
    const tips = await ctx.db
      .query("promptSheets")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .collect();
    const tip = tips
      .filter((t) => t.isTip && isAssetSheetType(t.type))
      .sort((a, b) => b.version - a.version)[0];
    if (!tip) return null;
    return tip;
  },
});

/** Version history for an entity's asset prompt sheets (newest first). */
export const listVersionsForEntity = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (entity === null) return [];
    await requireProjectAccess(ctx, entity.projectId);
    const rows = await ctx.db
      .query("promptSheets")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .collect();
    return rows
      .filter((t) => isAssetSheetType(t.type))
      .sort((a, b) => b.version - a.version)
      .map((t) => ({
        _id: t._id,
        version: t.version,
        status: t.status,
        isTip: t.isTip,
        isCustom: t.isCustom,
        createdAt: t.createdAt,
        preview: (t.renderedText ?? "").slice(0, 120),
      }));
  },
});
