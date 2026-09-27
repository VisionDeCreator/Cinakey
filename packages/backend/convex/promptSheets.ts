/**
 * Prompt sheets: structured templates (asset / script / blockout) with
 * versioned tip rows and rendered text.
 */

import {
  assertSheetDocument,
  type SheetDocument,
} from "@cinakey/shared";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";
import { requireProjectAccess } from "./lib/access";
import {
  markBlockoutStaleForScriptPrompt,
  markScriptPromptsStaleForAssetSheet,
  markSheetsStaleForStyleChange,
} from "./lib/promptSheetDeps";
import {
  PROMPT_TEMPLATE_VERSION,
  isAssetSheetType,
  renderPromptSheetText,
  validateStructured,
} from "./lib/promptRender";
import { loadJson, saveJson } from "./storage";

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

const INLINE_RENDERED_MAX = 80_000;

async function loadArtStyleBlock(
  ctx: ActionCtx,
  projectId: Id<"projects">,
): Promise<string> {
  const entities: Doc<"entities">[] = await ctx.runQuery(
    internal.promptSheets.listEntitiesInternal,
    { projectId },
  );
  const style = entities.find((e: Doc<"entities">) => e.kind === "style");
  if (!style?.sheetFileId) return "";
  try {
    const sheet = assertSheetDocument(
      await loadJson(ctx, style.sheetFileId),
    ) as SheetDocument;
    return sheet.artStyleBlock?.trim() ?? "";
  } catch {
    return "";
  }
}

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
    return await ctx.db
      .query("promptSheets")
      .withIndex("by_project_tip", (q) =>
        q.eq("projectId", args.projectId).eq("isTip", true),
      )
      .collect();
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

export const getWithContent = action({
  args: { promptSheetId: v.id("promptSheets") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    sheet: Doc<"promptSheets">;
    structured: unknown;
    renderedText: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const sheet: Doc<"promptSheets"> | null = await ctx.runQuery(
      internal.promptSheets.getInternal,
      { promptSheetId: args.promptSheetId },
    );
    if (sheet === null) throw new Error("Prompt sheet not found");
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: sheet.projectId,
      userId,
    });
    const structured = await loadJson(ctx, sheet.structuredFileId);
    let renderedText = sheet.renderedText ?? "";
    if (sheet.renderedFileId) {
      renderedText = String(await loadJson(ctx, sheet.renderedFileId));
    }
    return { sheet, structured, renderedText };
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

async function storeRendered(
  ctx: ActionCtx,
  text: string,
): Promise<{ renderedText?: string; renderedFileId?: Id<"_storage"> }> {
  if (text.length <= INLINE_RENDERED_MAX) {
    return { renderedText: text };
  }
  const { storageId } = await saveJson(ctx, text);
  return { renderedFileId: storageId };
}

/** Create or version a draft prompt sheet from structured data. */
export const createOrUpdateDraft = action({
  args: {
    projectId: v.id("projects"),
    type: typeValidator,
    structured: v.any(),
    entityId: v.optional(v.id("entities")),
    sequenceId: v.optional(v.id("sequences")),
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
    /** Replace tip for this entity (asset) or sequence+type. */
    replaceTipId: v.optional(v.id("promptSheets")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    promptSheetId: Id<"promptSheets">;
    renderedText: string;
    version: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: args.projectId,
      userId,
    });

    const validated = validateStructured(args.type, args.structured);
    if (!validated.ok) {
      throw new Error(`Invalid ${args.type} sheet: ${validated.error}`);
    }

    const artStyle = await loadArtStyleBlock(ctx, args.projectId);
    const rendered = renderPromptSheetText(
      args.type,
      validated.data,
      artStyle,
    );
    const { storageId: structuredFileId } = await saveJson(ctx, validated.data);
    const renderedStore = await storeRendered(ctx, rendered);

    let parentId: Id<"promptSheets"> | undefined;
    let version = 1;
    let demoteTipId: Id<"promptSheets"> | undefined = args.replaceTipId;

    if (!demoteTipId && args.entityId && isAssetSheetType(args.type)) {
      const tips: Doc<"promptSheets">[] = await ctx.runQuery(
        internal.promptSheets.listTipsInternal,
        { projectId: args.projectId, type: args.type },
      );
      const existing = tips.find(
        (t: Doc<"promptSheets">) => t.entityId === args.entityId,
      );
      if (existing) {
        demoteTipId = existing._id;
        parentId = existing._id;
        version = existing.version + 1;
      }
    } else if (demoteTipId) {
      const prev: Doc<"promptSheets"> | null = await ctx.runQuery(
        internal.promptSheets.getInternal,
        { promptSheetId: demoteTipId },
      );
      if (prev) {
        parentId = prev._id;
        version = prev.version + 1;
      }
    }

    const id: Id<"promptSheets"> = await ctx.runMutation(
      internal.promptSheets.insertTip,
      {
        projectId: args.projectId,
        type: args.type,
        entityId: args.entityId,
        sequenceId: args.sequenceId,
        structuredFileId,
        ...renderedStore,
        status: "draft",
        isCustom: false,
        parentId,
        version,
        referenceMap: args.referenceMap,
        sourceAssetSheetIds: args.sourceAssetSheetIds,
        sourceScriptPromptId: args.sourceScriptPromptId,
        demoteTipId,
      },
    );

    return { promptSheetId: id, renderedText: rendered, version };
  },
});

/** Approve an asset sheet and queue GPT Image 2 generation. */
export const approveAssetSheet = action({
  args: { promptSheetId: v.id("promptSheets") },
  handler: async (
    ctx,
    args,
  ): Promise<{ jobId: Id<"generationJobs">; estimatedCostCredits: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const sheet: Doc<"promptSheets"> | null = await ctx.runQuery(
      internal.promptSheets.getInternal,
      { promptSheetId: args.promptSheetId },
    );
    if (sheet === null) throw new Error("Prompt sheet not found");
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: sheet.projectId,
      userId,
    });
    if (!isAssetSheetType(sheet.type)) {
      throw new Error("Not an asset prompt sheet");
    }
    if (!sheet.entityId) {
      throw new Error("Asset sheet has no linked entity");
    }

    let rendered = sheet.renderedText ?? "";
    if (sheet.renderedFileId) {
      rendered = String(await loadJson(ctx, sheet.renderedFileId));
    }
    if (!rendered) {
      const structured = await loadJson(ctx, sheet.structuredFileId);
      const artStyle = await loadArtStyleBlock(ctx, sheet.projectId);
      rendered = renderPromptSheetText(sheet.type, structured, artStyle);
    }

    await ctx.runMutation(internal.promptSheets.patchStatus, {
      promptSheetId: sheet._id,
      status: "generating",
    });

    const result: {
      jobId: Id<"generationJobs">;
      estimatedCostCredits: number;
    } = await ctx.runAction(api.generation.startGeneration, {
      projectId: sheet.projectId,
      adapterId: "gpt-image-2",
      kind: "text-to-image",
      prompt: rendered,
      entityId: sheet.entityId,
      promptSheetId: sheet._id,
    });

    await ctx.runMutation(internal.promptSheets.markAssetDependentsStale, {
      promptSheetId: sheet._id,
    });

    return result;
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

/** Edit rendered text → custom mode. */
export const setCustomRenderedText = action({
  args: {
    promptSheetId: v.id("promptSheets"),
    renderedText: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"promptSheets">> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const sheet: Doc<"promptSheets"> | null = await ctx.runQuery(
      internal.promptSheets.getInternal,
      { promptSheetId: args.promptSheetId },
    );
    if (sheet === null) throw new Error("Prompt sheet not found");
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: sheet.projectId,
      userId,
    });
    const renderedStore = await storeRendered(ctx, args.renderedText);
    const structured = await loadJson(ctx, sheet.structuredFileId);
    const { storageId } = await saveJson(ctx, structured);
    return await ctx.runMutation(internal.promptSheets.insertTip, {
      projectId: sheet.projectId,
      type: sheet.type,
      entityId: sheet.entityId,
      sequenceId: sheet.sequenceId,
      structuredFileId: storageId,
      ...renderedStore,
      status: sheet.status === "draft" ? "draft" : "approved",
      isCustom: true,
      parentId: sheet._id,
      version: sheet.version + 1,
      referenceMap: sheet.referenceMap,
      sourceAssetSheetIds: sheet.sourceAssetSheetIds,
      sourceScriptPromptId: sheet.sourceScriptPromptId,
      demoteTipId: sheet._id,
    });
  },
});

/** Reset custom → re-render from structured + current art style. */
export const resetToStructured = action({
  args: { promptSheetId: v.id("promptSheets") },
  handler: async (ctx, args): Promise<Id<"promptSheets">> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const sheet: Doc<"promptSheets"> | null = await ctx.runQuery(
      internal.promptSheets.getInternal,
      { promptSheetId: args.promptSheetId },
    );
    if (sheet === null) throw new Error("Prompt sheet not found");
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: sheet.projectId,
      userId,
    });
    const structured = await loadJson(ctx, sheet.structuredFileId);
    const artStyle = await loadArtStyleBlock(ctx, sheet.projectId);
    const rendered = renderPromptSheetText(sheet.type, structured, artStyle);
    const { storageId } = await saveJson(ctx, structured);
    const renderedStore = await storeRendered(ctx, rendered);
    return await ctx.runMutation(internal.promptSheets.insertTip, {
      projectId: sheet.projectId,
      type: sheet.type,
      entityId: sheet.entityId,
      sequenceId: sheet.sequenceId,
      structuredFileId: storageId,
      ...renderedStore,
      status: "draft",
      isCustom: false,
      parentId: sheet._id,
      version: sheet.version + 1,
      referenceMap: sheet.referenceMap,
      sourceAssetSheetIds: sheet.sourceAssetSheetIds,
      sourceScriptPromptId: sheet.sourceScriptPromptId,
      demoteTipId: sheet._id,
    });
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
