import {
  createEmptySheet,
  lockedIdsFromSheet,
  mergeSheet,
  normalizeEntityName,
  type IdentitySlotKey,
  type SheetDocument,
  assertSheetDocument,
} from "@cinakey/shared";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { requireProjectAccess } from "./lib/access";
import { getFileUrl, loadJson, saveJson } from "./storage";

const kindValidator = v.union(
  v.literal("character"),
  v.literal("location"),
  v.literal("prop"),
  v.literal("style"),
);

const identitySlotValidator = v.union(
  v.literal("front"),
  v.literal("threeQuarter"),
  v.literal("profile"),
  v.literal("fullBody"),
);

function asAssetIds(ids: string[]): Id<"assets">[] {
  return ids as Id<"assets">[];
}

type WithSheetResult = {
  entity: Doc<"entities">;
  sheet: SheetDocument;
  lockedUrls: Record<string, string | null>;
  styleSheet: SheetDocument | null;
  styleEntityId: Id<"entities"> | null;
  projectRules: string[];
};

export const listForProject = query({
  args: {
    projectId: v.id("projects"),
    kind: v.optional(kindValidator),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    if (args.kind !== undefined) {
      return await ctx.db
        .query("entities")
        .withIndex("by_project_kind", (q) =>
          q.eq("projectId", args.projectId).eq("kind", args.kind!),
        )
        .collect();
    }
    return await ctx.db
      .query("entities")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const get = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (entity === null) return null;
    await requireProjectAccess(ctx, entity.projectId);
    return entity;
  },
});

export const listAssetsForEntity = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (entity === null) throw new Error("Entity not found");
    await requireProjectAccess(ctx, entity.projectId);
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .collect();
    return assets.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listJobsForEntity = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (entity === null) throw new Error("Entity not found");
    await requireProjectAccess(ctx, entity.projectId);
    const jobs = await ctx.db
      .query("generationJobs")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .collect();
    return jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  },
});

/** Ensure a single Project Style entity exists for the project. */
export const ensureStyle = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const existing = await ctx.db
      .query("entities")
      .withIndex("by_project_kind", (q) =>
        q.eq("projectId", args.projectId).eq("kind", "style"),
      )
      .first();
    if (existing !== null) return existing._id;
    const now = Date.now();
    return await ctx.db.insert("entities", {
      projectId: args.projectId,
      kind: "style",
      name: "Project Style",
      description: "Overall look applied to every generation prompt",
      lockedReferenceAssetIds: [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    kind: kindValidator,
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    if (args.kind === "style") {
      throw new Error("Use ensureStyle to create the project style sheet");
    }
    const name = args.name.trim();
    if (name.length === 0) throw new Error("Entity name is required");
    const now = Date.now();
    return await ctx.db.insert("entities", {
      projectId: args.projectId,
      kind: args.kind,
      name,
      description: args.description,
      lockedReferenceAssetIds: [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    entityId: v.id("entities"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (entity === null) throw new Error("Entity not found");
    await requireProjectAccess(ctx, entity.projectId);
    const patch: {
      name?: string;
      description?: string;
      updatedAt: number;
    } = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length === 0) throw new Error("Entity name is required");
      patch.name = name;
    }
    if (args.description !== undefined) {
      patch.description = args.description;
    }
    await ctx.db.patch(args.entityId, patch);
  },
});

export const findByName = query({
  args: {
    projectId: v.id("projects"),
    kind: kindValidator,
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_project_kind", (q) =>
        q.eq("projectId", args.projectId).eq("kind", args.kind),
      )
      .collect();
    const key = normalizeEntityName(args.name);
    return entities.find((e) => normalizeEntityName(e.name) === key) ?? null;
  },
});

export const getEntityInternal = internalQuery({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.entityId);
  },
});

export const applySheetBlob = internalMutation({
  args: {
    entityId: v.id("entities"),
    sheetFileId: v.id("_storage"),
    lockedReferenceAssetIds: v.array(v.id("assets")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.entityId, {
      sheetFileId: args.sheetFileId,
      lockedReferenceAssetIds: args.lockedReferenceAssetIds,
      updatedAt: Date.now(),
    });
  },
});

export const assertProjectAccess = internalQuery({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) throw new Error("User not found");
    const project = await ctx.db.get(args.projectId);
    if (project === null) throw new Error("Project not found");
    if (user.isStaff === true) return { project };
    const workspace = await ctx.db.get(project.workspaceId);
    if (workspace === null || workspace.ownerUserId !== user._id) {
      throw new Error("Project access denied");
    }
    return { project };
  },
});

export const findStyleInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("entities")
      .withIndex("by_project_kind", (q) =>
        q.eq("projectId", args.projectId).eq("kind", "style"),
      )
      .first();
  },
});

async function loadSheetDoc(
  ctx: ActionCtx,
  entity: Doc<"entities">,
): Promise<SheetDocument> {
  if (entity.sheetFileId) {
    try {
      return assertSheetDocument(await loadJson(ctx, entity.sheetFileId));
    } catch {
      return createEmptySheet(entity.kind);
    }
  }
  return createEmptySheet(entity.kind);
}

/**
 * Load entity + parsed sheet + locked asset preview URLs.
 */
export const getWithSheet = action({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args): Promise<WithSheetResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const entity: Doc<"entities"> | null = await ctx.runQuery(
      internal.entities.getEntityInternal,
      { entityId: args.entityId },
    );
    if (entity === null) throw new Error("Entity not found");

    await ctx.runQuery(internal.entities.assertProjectAccess, {
      projectId: entity.projectId,
      userId,
    });

    const sheet = await loadSheetDoc(ctx, entity);

    const lockedUrls: Record<string, string | null> = {};
    for (const assetId of entity.lockedReferenceAssetIds) {
      const asset = await ctx.runQuery(internal.storage.getAssetInternal, {
        assetId,
      });
      lockedUrls[assetId] =
        asset === null ? null : await getFileUrl(ctx, asset.storageId);
    }

    const project: Doc<"projects"> = await ctx.runQuery(
      internal.generation.getProjectWorkspace,
      { projectId: entity.projectId },
    );

    let styleSheet: SheetDocument | null = null;
    const styleEntity: Doc<"entities"> | null = await ctx.runQuery(
      internal.entities.findStyleInternal,
      { projectId: entity.projectId },
    );
    if (styleEntity) {
      styleSheet = await loadSheetDoc(ctx, styleEntity);
    }

    return {
      entity,
      sheet,
      lockedUrls,
      styleSheet,
      styleEntityId: styleEntity?._id ?? null,
      projectRules: project.rules,
    };
  },
});

/**
 * Merge a patch into the entity sheet (new blob; never overwrite).
 */
export const saveSheet = action({
  args: {
    entityId: v.id("entities"),
    patch: v.any(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const entity = await ctx.runQuery(internal.entities.getEntityInternal, {
      entityId: args.entityId,
    });
    if (entity === null) throw new Error("Entity not found");
    await ctx.runQuery(internal.entities.assertProjectAccess, {
      projectId: entity.projectId,
      userId,
    });

    const current = await loadSheetDoc(ctx, entity);
    const patch = args.patch as Partial<SheetDocument>;
    const next = mergeSheet(current, patch, entity.sheetFileId);
    const { storageId } = await saveJson(ctx, next);
    const locked = asAssetIds(lockedIdsFromSheet(next));
    await ctx.runMutation(internal.entities.applySheetBlob, {
      entityId: args.entityId,
      sheetFileId: storageId,
      lockedReferenceAssetIds: locked,
    });
    return { sheetFileId: storageId, sheet: next };
  },
});

export const lockReference = action({
  args: {
    entityId: v.id("entities"),
    assetId: v.id("assets"),
    slot: v.optional(identitySlotValidator),
    expressionLabel: v.optional(v.string()),
    heroIndex: v.optional(v.number()),
    moodReference: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const entity = await ctx.runQuery(internal.entities.getEntityInternal, {
      entityId: args.entityId,
    });
    if (entity === null) throw new Error("Entity not found");
    await ctx.runQuery(internal.entities.assertProjectAccess, {
      projectId: entity.projectId,
      userId,
    });

    const asset = await ctx.runQuery(internal.storage.getAssetInternal, {
      assetId: args.assetId,
    });
    if (asset === null || asset.projectId !== entity.projectId) {
      throw new Error("Asset not found in this project");
    }

    const current = await loadSheetDoc(ctx, entity);
    const patch: Partial<SheetDocument> = {};
    if (args.slot !== undefined) {
      patch.identitySlots = {
        ...current.identitySlots,
        [args.slot as IdentitySlotKey]: args.assetId,
      };
    } else if (args.expressionLabel !== undefined) {
      const label = args.expressionLabel.trim() || "Expression";
      const existing = [...(current.expressionSlots ?? [])];
      const idx = existing.findIndex(
        (e) => e.label.toLowerCase() === label.toLowerCase(),
      );
      if (idx >= 0) {
        existing[idx] = { label, assetId: args.assetId };
      } else {
        existing.push({ label, assetId: args.assetId });
      }
      patch.expressionSlots = existing;
    } else if (args.moodReference === true) {
      const moods = [...(current.moodReferenceAssetIds ?? [])];
      if (!moods.includes(args.assetId)) moods.push(args.assetId);
      patch.moodReferenceAssetIds = moods;
    } else {
      const heroes = [...(current.heroAssetIds ?? [])];
      if (args.heroIndex !== undefined && args.heroIndex >= 0) {
        heroes[args.heroIndex] = args.assetId;
      } else if (!heroes.includes(args.assetId)) {
        heroes.push(args.assetId);
      }
      patch.heroAssetIds = heroes;
    }

    const next = mergeSheet(current, patch, entity.sheetFileId);
    const { storageId } = await saveJson(ctx, next);
    await ctx.runMutation(internal.entities.applySheetBlob, {
      entityId: args.entityId,
      sheetFileId: storageId,
      lockedReferenceAssetIds: asAssetIds(lockedIdsFromSheet(next)),
    });
    return { sheet: next };
  },
});

export const unlockReference = action({
  args: {
    entityId: v.id("entities"),
    slot: v.optional(identitySlotValidator),
    expressionLabel: v.optional(v.string()),
    heroAssetId: v.optional(v.id("assets")),
    moodAssetId: v.optional(v.id("assets")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const entity = await ctx.runQuery(internal.entities.getEntityInternal, {
      entityId: args.entityId,
    });
    if (entity === null) throw new Error("Entity not found");
    await ctx.runQuery(internal.entities.assertProjectAccess, {
      projectId: entity.projectId,
      userId,
    });

    const current = await loadSheetDoc(ctx, entity);
    const patch: Partial<SheetDocument> = {};
    if (args.slot !== undefined) {
      const slots = { ...current.identitySlots };
      delete slots[args.slot as IdentitySlotKey];
      patch.identitySlots = slots;
    } else if (args.expressionLabel !== undefined) {
      const label = args.expressionLabel.trim().toLowerCase();
      patch.expressionSlots = (current.expressionSlots ?? []).filter(
        (e) => e.label.toLowerCase() !== label,
      );
    } else if (args.moodAssetId !== undefined) {
      patch.moodReferenceAssetIds = (current.moodReferenceAssetIds ?? []).filter(
        (id) => id !== args.moodAssetId,
      );
    } else if (args.heroAssetId !== undefined) {
      patch.heroAssetIds = (current.heroAssetIds ?? []).filter(
        (id) => id !== args.heroAssetId,
      );
    }

    const next = mergeSheet(current, patch, entity.sheetFileId);
    const { storageId } = await saveJson(ctx, next);
    await ctx.runMutation(internal.entities.applySheetBlob, {
      entityId: args.entityId,
      sheetFileId: storageId,
      lockedReferenceAssetIds: asAssetIds(lockedIdsFromSheet(next)),
    });
    return { sheet: next };
  },
});
