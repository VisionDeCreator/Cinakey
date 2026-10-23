import {
  assertSheetDocument,
  normalizeEntityName,
  parseScriptPromptText,
  requiredAssetsFromScript,
  seedAssetPromptFromScriptDescription,
  scriptAssetLabelKey,
  validateAssetPromptText,
  validateScriptPromptText,
  type AssetSheetType,
  type SheetDocument,
} from "@cinakey/shared";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "../operations";
import type {
  Doc,
  Id,
} from "../../../../packages/backend/convex/_generated/dataModel";
import { action, type ActionCtx } from "../runtime/operation";
import {
  isAssetSheetType,
  renderPromptSheetText,
  validateStructured,
} from "../../../../packages/backend/convex/lib/promptRender";
import { loadJson } from "../../../../packages/backend/convex/storage";
import { saveJson } from "./storage";

const typeValidator = v.union(
  v.literal("character"),
  v.literal("creature"),
  v.literal("environment"),
  v.literal("product"),
  v.literal("script"),
  v.literal("blockout"),
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
    const rendered = renderPromptSheetText(args.type, validated.data, artStyle);
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

const assetTypeValidator = v.union(
  v.literal("character"),
  v.literal("creature"),
  v.literal("environment"),
  v.literal("product"),
);

const entityKindForAssetType = {
  character: "character",
  creature: "creature",
  environment: "location",
  product: "prop",
} as const;

/** Save full Phase 7C template text as the tip asset prompt sheet (custom mode). */
export const savePromptText = action({
  args: {
    projectId: v.id("projects"),
    entityId: v.optional(v.id("entities")),
    entityName: v.optional(v.string()),
    type: assetTypeValidator,
    promptText: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    promptSheetId: Id<"promptSheets">;
    entityId: Id<"entities">;
    version: number;
    validationWarning?: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: args.projectId,
      userId,
    });

    const promptText = args.promptText.trim();
    if (promptText.length === 0) {
      throw new Error("promptText is empty");
    }

    const project = await ctx.runQuery(api.projects.get, {
      projectId: args.projectId,
    });
    const validation = validateAssetPromptText(args.type, promptText, {
      hasStyleReference: Boolean(project?.styleReferenceAssetId),
    });

    let entityId = args.entityId;
    const entityKind = entityKindForAssetType[args.type];
    const displayName =
      args.name?.trim() || args.entityName?.trim() || "Untitled asset";

    if (!entityId && args.entityName?.trim()) {
      const entities: Doc<"entities">[] = await ctx.runQuery(
        internal.promptSheets.listEntitiesInternal,
        { projectId: args.projectId },
      );
      const key = normalizeEntityName(args.entityName.trim());
      const match = entities.find(
        (e) => e.kind === entityKind && normalizeEntityName(e.name) === key,
      );
      entityId = match?._id;
    }

    if (!entityId) {
      entityId = await ctx.runMutation(
        internal.promptSheets.createEntityInternal,
        {
          projectId: args.projectId,
          kind: entityKind,
          name: displayName,
        },
      );
    } else {
      await ctx.runMutation(internal.promptSheets.patchEntityKindInternal, {
        entityId,
        kind: entityKind,
        name: args.name?.trim() || args.entityName?.trim() || undefined,
      });
    }

    const stub = {
      schema: "cinakey.prompt/custom/1",
      type: args.type,
      customPrompt: true,
    };
    const { storageId: structuredFileId } = await saveJson(ctx, stub);
    const renderedStore = await storeRendered(ctx, promptText);

    let parentId: Id<"promptSheets"> | undefined;
    let version = 1;
    let demoteTipId: Id<"promptSheets"> | undefined;

    const tips: Doc<"promptSheets">[] = await ctx.runQuery(
      internal.promptSheets.listTipsInternal,
      { projectId: args.projectId },
    );
    const existing = tips.find(
      (t) => t.entityId === entityId && isAssetSheetType(t.type),
    );
    if (existing) {
      demoteTipId = existing._id;
      parentId = existing._id;
      version = existing.version + 1;
    }

    const promptSheetId: Id<"promptSheets"> = await ctx.runMutation(
      internal.promptSheets.insertTip,
      {
        projectId: args.projectId,
        type: args.type,
        entityId,
        structuredFileId,
        ...renderedStore,
        status: "draft",
        isCustom: true,
        parentId,
        version,
        demoteTipId,
      },
    );

    return {
      promptSheetId,
      entityId,
      version,
      validationWarning: validation.warning,
    };
  },
});

/** Save script prompt text as tip SoT; syncs sequence shots, required assets, and marks blockout stale. */
export const saveScriptPromptText = action({
  args: {
    projectId: v.id("projects"),
    sequenceId: v.optional(v.id("sequences")),
    promptText: v.string(),
    title: v.optional(v.string()),
    applyShots: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    promptSheetId: Id<"promptSheets">;
    sequenceId: Id<"sequences">;
    version: number;
    validationWarning?: string;
    shotCount: number;
    assetsCreated: number;
    assetsMarkedStale: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: args.projectId,
      userId,
    });

    const promptText = args.promptText.trim();
    if (promptText.length === 0) {
      throw new Error("promptText is empty");
    }

    const validation = validateScriptPromptText(promptText);
    const parsed = parseScriptPromptText(promptText);

    const entities: Doc<"entities">[] = await ctx.runQuery(
      internal.promptSheets.listEntitiesInternal,
      { projectId: args.projectId },
    );

    const synced = await syncRequiredAssetsFromScript(ctx, {
      projectId: args.projectId,
      parsed,
      entities,
    });
    const referenceMap = synced.referenceMap;
    // Keep structured refs pointing at resolved entity ids
    parsed.references = parsed.references.map((r) => {
      const hit = referenceMap.find((m) => m.imageN === r.imageN);
      return hit ? { ...r, entityId: hit.entityId as string } : r;
    });

    const { storageId: structuredFileId } = await saveJson(ctx, parsed);
    const renderedStore = await storeRendered(ctx, promptText);

    let parentId: Id<"promptSheets"> | undefined;
    let version = 1;
    let demoteTipId: Id<"promptSheets"> | undefined;
    let sequenceId = args.sequenceId;

    const tips: Doc<"promptSheets">[] = await ctx.runQuery(
      internal.promptSheets.listTipsInternal,
      { projectId: args.projectId },
    );

    let existing: Doc<"promptSheets"> | undefined;
    if (sequenceId) {
      existing = tips.find(
        (t) => t.type === "script" && t.sequenceId === sequenceId,
      );
    }
    if (!existing && !sequenceId) {
      existing = tips
        .filter((t) => t.type === "script")
        .sort((a, b) => b.version - a.version)[0];
      if (existing?.sequenceId) sequenceId = existing.sequenceId;
    }
    if (existing) {
      demoteTipId = existing._id;
      parentId = existing._id;
      version = existing.version + 1;
      if (!sequenceId && existing.sequenceId) sequenceId = existing.sequenceId;
    }

    const title = args.title?.trim() || "Part 1";

    const sequences = await ctx.runQuery(api.sequences.list, {
      projectId: args.projectId,
    });

    if (!sequenceId) {
      const order = sequences.length;
      sequenceId = await ctx.runMutation(
        internal.sequences.upsertFromScriptPrompt,
        {
          projectId: args.projectId,
          title: title || `Part ${order + 1}`,
          durationSec: parsed.totalDurationSec,
          order,
        },
      );
    }

    const promptSheetId: Id<"promptSheets"> = await ctx.runMutation(
      internal.promptSheets.insertTip,
      {
        projectId: args.projectId,
        type: "script",
        sequenceId,
        structuredFileId,
        ...renderedStore,
        status: "approved",
        isCustom: true,
        parentId,
        version,
        referenceMap: referenceMap.length > 0 ? referenceMap : undefined,
        demoteTipId,
      },
    );

    const partIndex =
      sequences.findIndex((s) => s._id === sequenceId) >= 0
        ? sequences.findIndex((s) => s._id === sequenceId)
        : sequences.length;

    await ctx.runMutation(internal.sequences.upsertFromScriptPrompt, {
      projectId: args.projectId,
      scriptPromptId: promptSheetId,
      title: args.title?.trim() || `Part ${partIndex + 1}`,
      durationSec: parsed.totalDurationSec,
      order: partIndex,
      existingSequenceId: sequenceId,
    });

    await ctx.runMutation(internal.sequences.linkSequenceOnSheet, {
      promptSheetId,
      sequenceId,
    });

    let shotCount = 0;
    if (args.applyShots !== false) {
      const applied = await ctx.runAction(api.sequences.applyScriptPrompt, {
        projectId: args.projectId,
        promptSheetId,
        title: args.title?.trim() || `Part ${partIndex + 1}`,
      });
      shotCount = applied.shotCount;
      sequenceId = applied.sequenceId;
    } else {
      await ctx.runMutation(internal.promptSheets.markScriptDependentsStale, {
        promptSheetId,
      });
    }

    return {
      promptSheetId,
      sequenceId,
      version,
      validationWarning: validation.warning,
      shotCount,
      assetsCreated: synced.createdEntityIds.length,
      assetsMarkedStale: synced.staleSheetIds.length,
    };
  },
});

/**
 * Ensure every script REFERENCE / cast / location has an entity + tip sheet.
 * Creates missing assets; marks existing tips out_of_date when the script
 * description for that asset changed.
 */
async function syncRequiredAssetsFromScript(
  ctx: ActionCtx,
  args: {
    projectId: Id<"projects">;
    parsed: ReturnType<typeof parseScriptPromptText>;
    entities: Doc<"entities">[];
  },
): Promise<{
  referenceMap: { imageN: number; entityId: Id<"entities"> }[];
  createdEntityIds: Id<"entities">[];
  staleSheetIds: Id<"promptSheets">[];
}> {
  const required = requiredAssetsFromScript(args.parsed);
  const tips: Doc<"promptSheets">[] = await ctx.runQuery(
    internal.promptSheets.listTipsInternal,
    { projectId: args.projectId },
  );
  const entities = [...args.entities];
  const referenceMap: { imageN: number; entityId: Id<"entities"> }[] = [];
  const createdEntityIds: Id<"entities">[] = [];
  const staleSheetIds: Id<"promptSheets">[] = [];
  const artStyle = args.parsed.artStyleBlock;
  const project = await ctx.runQuery(api.projects.get, {
    projectId: args.projectId,
  });
  const hasStyleReference = Boolean(project?.styleReferenceAssetId);

  for (const req of required) {
    const kind =
      req.assetType === "environment"
        ? ("location" as const)
        : req.assetType === "product"
          ? ("prop" as const)
          : req.assetType === "creature"
            ? ("creature" as const)
            : ("character" as const);

    const key = scriptAssetLabelKey(req.label);
    let entity =
      entities.find(
        (e) =>
          e.kind !== "style" &&
          (normalizeEntityName(e.name) === normalizeEntityName(req.label) ||
            scriptAssetLabelKey(e.name) === key ||
            key.includes(scriptAssetLabelKey(e.name)) ||
            scriptAssetLabelKey(e.name).includes(key)),
      ) ?? undefined;

    if (!entity) {
      const entityId = await ctx.runMutation(
        internal.promptSheets.createEntityInternal,
        {
          projectId: args.projectId,
          kind,
          name: req.label,
        },
      );
      await ctx.runMutation(
        internal.promptSheets.patchEntityDescriptionInternal,
        {
          entityId,
          description: req.description,
        },
      );
      createdEntityIds.push(entityId);
      const created = await ctx.runQuery(
        internal.promptSheets.getEntityInternal,
        {
          entityId,
        },
      );
      if (created) {
        entities.push(created);
        entity = created;
      }
    } else {
      // Align kind/name when script is clearer
      await ctx.runMutation(internal.promptSheets.patchEntityKindInternal, {
        entityId: entity._id,
        kind,
        name: req.label,
      });
      const prevDesc = (entity.description ?? "").trim();
      const nextDesc = req.description.trim();
      if (nextDesc && nextDesc !== prevDesc) {
        await ctx.runMutation(
          internal.promptSheets.patchEntityDescriptionInternal,
          { entityId: entity._id, description: nextDesc },
        );
      }
    }

    if (!entity) continue;
    referenceMap.push({ imageN: req.imageN, entityId: entity._id });

    const tip = tips.find(
      (t) => t.entityId === entity!._id && isAssetSheetType(t.type),
    );

    if (!tip) {
      const promptText = seedAssetPromptFromScriptDescription(
        req.assetType as AssetSheetType,
        req.label,
        req.description,
        artStyle,
        { hasStyleReference },
      );
      await ctx.runAction(api.promptSheets.savePromptText, {
        projectId: args.projectId,
        entityId: entity._id,
        type: req.assetType,
        promptText,
        name: req.label,
      });
      // refresh tips cache for subsequent iterations
      const refreshed: Doc<"promptSheets">[] = await ctx.runQuery(
        internal.promptSheets.listTipsInternal,
        { projectId: args.projectId },
      );
      tips.length = 0;
      tips.push(...refreshed);
    } else {
      const prevDesc = (entity.description ?? "").trim();
      const nextDesc = req.description.trim();
      const tipText = (tip.renderedText ?? "").trim();
      const descriptionChanged =
        Boolean(nextDesc) &&
        nextDesc !== prevDesc &&
        !(
          tipText.length > 0 &&
          nextDesc.length > 40 &&
          tipText.includes(nextDesc.slice(0, 40))
        );
      if (descriptionChanged) {
        const marked = await ctx.runMutation(
          internal.promptSheets.markAssetTipOutOfDateInternal,
          { promptSheetId: tip._id },
        );
        if (marked) staleSheetIds.push(tip._id);
      }
    }
  }

  return { referenceMap, createdEntityIds, staleSheetIds };
}

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

/** Restore a prior prompt sheet version as a new tip (Undo / version menu). */
export const restorePromptVersion = action({
  args: { promptSheetId: v.id("promptSheets") },
  handler: async (
    ctx,
    args,
  ): Promise<{ promptSheetId: Id<"promptSheets">; version: number }> => {
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
    if (!isAssetSheetType(sheet.type) && sheet.type !== "script") {
      throw new Error("Can only restore asset or script prompt sheets");
    }

    let rendered = sheet.renderedText ?? "";
    if (sheet.renderedFileId) {
      rendered = String(await loadJson(ctx, sheet.renderedFileId));
    }
    if (!rendered && sheet.structuredFileId) {
      try {
        const structured = await loadJson(ctx, sheet.structuredFileId);
        if (sheet.type === "script") {
          const { renderScriptPrompt } = await import("@cinakey/shared");
          rendered = renderScriptPrompt(structured as never);
        } else {
          const artStyle = await loadArtStyleBlock(ctx, sheet.projectId);
          rendered = renderPromptSheetText(sheet.type, structured, artStyle);
        }
      } catch {
        throw new Error("Could not restore prompt text from this version");
      }
    }

    if (sheet.type === "script") {
      const result = await ctx.runAction(
        api.promptSheets.saveScriptPromptText,
        {
          projectId: sheet.projectId,
          sequenceId: sheet.sequenceId,
          promptText: rendered,
        },
      );
      return {
        promptSheetId: result.promptSheetId,
        version: result.version,
      };
    }

    if (!sheet.entityId) {
      throw new Error("Asset prompt sheet missing entity");
    }

    const result = await ctx.runAction(api.promptSheets.savePromptText, {
      projectId: sheet.projectId,
      entityId: sheet.entityId,
      type: sheet.type,
      promptText: rendered,
    });
    return {
      promptSheetId: result.promptSheetId,
      version: result.version,
    };
  },
});
