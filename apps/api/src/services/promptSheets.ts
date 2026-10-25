import {
  assertSheetDocument,
  normalizeEntityName,
  validateAssetPromptText,
  type SheetDocument,
} from "@cinakey/shared";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type {
  Doc,
  Id,
} from "../../../../packages/backend/convex/_generated/dataModel";
import {
  isAssetSheetType,
  renderPromptSheetText,
  validateStructured,
} from "../../../../packages/backend/convex/lib/promptRender";
import { loadJson } from "../../../../packages/backend/convex/storage";
import { api, internal } from "../operations";
import { action, type ActionCtx } from "../runtime/operation";
import { saveJson } from "./storage";

const typeValidator = v.union(
  v.literal("character"),
  v.literal("creature"),
  v.literal("environment"),
  v.literal("product"),
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
  const project = await ctx.runQuery(internal.entities.getProjectInternal, {
    projectId,
  });
  const style =
    entities.find(
      (e: Doc<"entities">) => e._id === project?.activeStyleEntityId,
    ) ?? entities.find((e: Doc<"entities">) => e.kind === "style");
  if (!style?.sheetFileId)
    return style?.sourceResourceVersionId ? (style.description ?? "") : "";
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
    await ctx.runQuery(internal.workspace.assertAccess, {
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

    /** Replace the current asset prompt. */
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
    await ctx.runQuery(internal.workspace.assertAccess, {
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

        structuredFileId,
        ...renderedStore,
        status: "draft",
        isCustom: false,
        parentId,
        version,

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
    await ctx.runQuery(internal.workspace.assertAccess, {
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
    await ctx.runQuery(internal.workspace.assertAccess, {
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

      structuredFileId: storageId,
      ...renderedStore,
      status: sheet.status === "draft" ? "draft" : "approved",
      isCustom: true,
      parentId: sheet._id,
      version: sheet.version + 1,

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
    await ctx.runQuery(internal.workspace.assertAccess, {
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

      structuredFileId: storageId,
      ...renderedStore,
      status: "draft",
      isCustom: false,
      parentId: sheet._id,
      version: sheet.version + 1,

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
    await ctx.runQuery(internal.workspace.assertAccess, {
      projectId: sheet.projectId,
      userId,
    });
    if (!isAssetSheetType(sheet.type)) {
      throw new Error("Can only restore asset or script prompt sheets");
    }

    let rendered = sheet.renderedText ?? "";
    if (sheet.renderedFileId) {
      rendered = String(await loadJson(ctx, sheet.renderedFileId));
    }
    if (!rendered && sheet.structuredFileId) {
      try {
        const structured = await loadJson(ctx, sheet.structuredFileId);
        const artStyle = await loadArtStyleBlock(ctx, sheet.projectId);
        rendered = renderPromptSheetText(sheet.type, structured, artStyle);
      } catch {
        throw new Error("Could not restore prompt text from this version");
      }
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
