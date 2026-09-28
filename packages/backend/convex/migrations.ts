import { v } from "convex/values";
import {
  assembleLookDevPrompt,
  assertSheetDocument,
  type SheetDocument,
} from "@cinakey/shared";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { buildSearchText } from "./lib/assetSearch";
import {
  PROMPT_TEMPLATE_VERSION,
  isAssetSheetType,
  renderPromptSheetText,
  validateStructured,
} from "./lib/promptRender";
import { loadJson, saveJson } from "./storage";

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

const INLINE_RENDERED_MAX = 80_000;

const sheetTypeForKind: Record<
  string,
  "character" | "creature" | "environment" | "product" | null
> = {
  character: "character",
  creature: "creature",
  location: "environment",
  prop: "product",
  style: null,
};

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

async function resolveRenderedText(
  ctx: ActionCtx,
  tip: Doc<"promptSheets"> | undefined,
  entity: Doc<"entities">,
  artStyle: string,
): Promise<string | null> {
  if (tip) {
    if (tip.renderedText?.trim()) return tip.renderedText;
    if (tip.renderedFileId) {
      try {
        return String(await loadJson(ctx, tip.renderedFileId));
      } catch {
        /* fall through */
      }
    }
    if (tip.structuredFileId) {
      try {
        const structured = await loadJson(ctx, tip.structuredFileId);
        if (isAssetSheetType(tip.type)) {
          const validated = validateStructured(tip.type, structured);
          if (validated.ok) {
            return renderPromptSheetText(tip.type, validated.data, artStyle);
          }
        }
      } catch {
        /* fall through */
      }
    }
  }

  if (!entity.sheetFileId) return null;
  try {
    const sheet = assertSheetDocument(
      await loadJson(ctx, entity.sheetFileId),
    ) as SheetDocument;
    if (sheet.draftPrompt?.trim()) return sheet.draftPrompt;
    return (
      assembleLookDevPrompt({
        entitySheet: sheet,
        entityName: entity.name,
        entityDescription: entity.description,
      }) || null
    );
  } catch {
    return null;
  }
}

/**
 * Phase 11A: ensure every creative entity has a tip prompt sheet with
 * rendered text; copy style mood ref → projects.styleReferenceAssetId.
 * Run: `npx convex run migrations:migratePhase11A`
 */
export const migratePhase11A = action({
  args: {},
  handler: async (ctx) => {
    const projects: Doc<"projects">[] = await ctx.runQuery(
      internal.migrations.listProjectsInternal,
      {},
    );

    let entitiesMigrated = 0;
    let tipsCreated = 0;
    let styleRefsCopied = 0;
    let skipped = 0;

    for (const project of projects) {
      const entities: Doc<"entities">[] = await ctx.runQuery(
        internal.migrations.listEntitiesForProjectInternal,
        { projectId: project._id },
      );
      const tips: Doc<"promptSheets">[] = await ctx.runQuery(
        internal.migrations.listTipSheetsInternal,
        { projectId: project._id },
      );

      let artStyle = "";
      const styleEntity = entities.find((e) => e.kind === "style");
      if (styleEntity?.sheetFileId) {
        try {
          const styleSheet = assertSheetDocument(
            await loadJson(ctx, styleEntity.sheetFileId),
          ) as SheetDocument;
          artStyle = styleSheet.artStyleBlock?.trim() ?? "";
          const moodRef = styleSheet.moodReferenceAssetIds?.[0];
          if (
            project.styleReferenceAssetId === undefined &&
            moodRef
          ) {
            await ctx.runMutation(
              internal.migrations.patchStyleReferenceInternal,
              {
                projectId: project._id,
                styleReferenceAssetId: moodRef as Id<"assets">,
              },
            );
            styleRefsCopied += 1;
          }
        } catch {
          /* ignore */
        }
      }

      for (const entity of entities) {
        if (entity.kind === "style") continue;
        const sheetType = sheetTypeForKind[entity.kind];
        if (!sheetType) continue;

        const existingTip = tips.find(
          (t) => t.entityId === entity._id && isAssetSheetType(t.type),
        );

        if (existingTip?.renderedText?.trim() || existingTip?.renderedFileId) {
          skipped += 1;
          continue;
        }

        const text = await resolveRenderedText(
          ctx,
          existingTip,
          entity,
          artStyle,
        );
        if (!text?.trim()) {
          skipped += 1;
          continue;
        }

        const stub = {
          schema: "cinakey.prompt/custom/1",
          type: sheetType,
          customPrompt: true,
          migratedFrom: "phase11a",
        };
        const { storageId: structuredFileId } = await saveJson(ctx, stub);
        let renderedText: string | undefined = text;
        let renderedFileId: Id<"_storage"> | undefined;
        if (text.length > INLINE_RENDERED_MAX) {
          const stored = await saveJson(ctx, text);
          renderedFileId = stored.storageId;
          renderedText = undefined;
        }

        await ctx.runMutation(internal.migrations.insertMigratedTipInternal, {
          projectId: project._id,
          type: sheetType,
          entityId: entity._id,
          structuredFileId,
          renderedText,
          renderedFileId,
          demoteTipId: existingTip?._id,
          parentId: existingTip?._id,
          version: existingTip ? existingTip.version + 1 : 1,
        });
        tipsCreated += 1;
        entitiesMigrated += 1;
      }
    }

    return { entitiesMigrated, tipsCreated, styleRefsCopied, skipped };
  },
});
