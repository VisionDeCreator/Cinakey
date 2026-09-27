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
import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { getAdapter } from "./adapters";
import { completeChat } from "./adapters/deepseek";
import { requireProjectAccess } from "./lib/access";
import { convexEnv } from "./lib/env";
import { getFileUrl, loadJson, saveJson } from "./storage";

const kindValidator = v.union(
  v.literal("character"),
  v.literal("creature"),
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

export const lockReferenceFromJob = internalAction({
  args: {
    entityId: v.id("entities"),
    assetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.runQuery(internal.entities.getEntityInternal, {
      entityId: args.entityId,
    });
    if (entity === null) throw new Error("Entity not found");
    let current: SheetDocument = createEmptySheet(entity.kind);
    if (entity.sheetFileId) {
      try {
        current = assertSheetDocument(
          await loadJson(ctx, entity.sheetFileId),
        );
      } catch {
        current = createEmptySheet(entity.kind);
      }
    }
    const patch: Partial<SheetDocument> = {
      referenceSheetAssetId: args.assetId,
    };
    if (entity.kind === "location" || entity.kind === "prop") {
      const heroes = [...(current.heroAssetIds ?? [])];
      if (!heroes.includes(args.assetId)) heroes.unshift(args.assetId);
      patch.heroAssetIds = heroes;
    }
    const next = mergeSheet(current, patch, entity.sheetFileId);
    const { storageId } = await saveJson(ctx, next);
    await ctx.runMutation(internal.entities.applySheetBlob, {
      entityId: args.entityId,
      sheetFileId: storageId,
      lockedReferenceAssetIds: asAssetIds(lockedIdsFromSheet(next)),
    });
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
    /** Lock as the primary pipeline reference sheet image. */
    referenceSheet: v.optional(v.boolean()),
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
    if (args.referenceSheet === true) {
      patch.referenceSheetAssetId = args.assetId;
      if (entity.kind === "location" || entity.kind === "prop") {
        const heroes = [...(current.heroAssetIds ?? [])];
        if (!heroes.includes(args.assetId)) heroes.unshift(args.assetId);
        patch.heroAssetIds = heroes;
      }
    } else if (args.slot !== undefined) {
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

const AUTOFILL_ESTIMATED_TOKENS = 2000;

/** Estimated DeepSeek credits to auto-fill a Look Dev entity sheet. */
export const estimateAutofillCost = query({
  args: {},
  handler: async () => {
    const adapter = getAdapter("deepseek");
    const credits = Math.max(
      1,
      adapter?.estimateCost({ estimatedTokens: AUTOFILL_ESTIMATED_TOKENS }) ?? 2,
    );
    return {
      credits,
      costModel: adapter?.capabilities.costModel ?? {
        unit: "per_1k_tokens",
        creditsPerUnit: 1,
      },
    };
  },
});

/**
 * AI auto-fill for character/creature/location/prop Look Dev fields.
 * Charges DeepSeek credits; writes the sheet immediately (button click = approval).
 */
export const autofillSheet = action({
  args: { entityId: v.id("entities") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    sheet: SheetDocument;
    description?: string;
    estimatedCostCredits: number;
    actualCostCredits: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const entity = await ctx.runQuery(internal.entities.getEntityInternal, {
      entityId: args.entityId,
    });
    if (entity === null) throw new Error("Entity not found");
    if (
      entity.kind !== "character" &&
      entity.kind !== "creature" &&
      entity.kind !== "location" &&
      entity.kind !== "prop"
    ) {
      throw new Error(
        "Auto-fill is only available for characters, creatures, locations, and props",
      );
    }
    await ctx.runQuery(internal.entities.assertProjectAccess, {
      projectId: entity.projectId,
      userId: userId as Id<"users">,
    });

    const project = await ctx.runQuery(internal.entities.getProjectInternal, {
      projectId: entity.projectId,
    });
    if (project === null) throw new Error("Project not found");

    const adapter = getAdapter("deepseek");
    if (!adapter) throw new Error("DeepSeek adapter not found");
    const estimatedCostCredits = Math.max(
      1,
      adapter.estimateCost({ estimatedTokens: AUTOFILL_ESTIMATED_TOKENS }),
    );

    const balanceInfo = await ctx.runQuery(api.credits.getBalance, {});
    if (balanceInfo.balance < estimatedCostCredits) {
      throw new ConvexError({
        code: "INSUFFICIENT_CREDITS" as const,
        balance: balanceInfo.balance,
        required: estimatedCostCredits,
      });
    }

    const tip = await ctx.runQuery(internal.entities.getTipScriptInternal, {
      projectId: entity.projectId,
    });
    let scriptSummary = "(no script yet)";
    if (tip) {
      try {
        const { assertScriptDocument } = await import("@cinakey/shared");
        const { scriptSummaryFromDocument } = await import(
          "./lib/copilotPrompts"
        );
        const doc = assertScriptDocument(
          await loadJson(ctx, tip.contentFileId),
        );
        scriptSummary = scriptSummaryFromDocument(doc);
      } catch {
        scriptSummary = "(script could not be loaded)";
      }
    }

    const jobId = await ctx.runMutation(internal.generation.createQueuedJob, {
      projectId: entity.projectId,
      workspaceId: project.workspaceId,
      entityId: args.entityId,
      model: "deepseek",
      modelVersion: "deepseek-chat",
      kind: "look-dev-autofill",
      prompt: `autofill ${entity.kind} ${entity.name}`,
      estimatedCostCredits,
      createdBy: userId as Id<"users">,
    });

    try {
      const useMock =
        convexEnv("USE_MOCK_ADAPTERS") === "true" ||
        !convexEnv("DEEPSEEK_API_KEY");
      const fields = useMock
        ? mockAutofillFields(entity.kind, entity.name, entity.description)
        : await llmAutofillFields({
            kind: entity.kind,
            name: entity.name,
            description: entity.description,
            brief: project.brief ?? null,
            rules: project.rules,
            scriptSummary,
          });

      const sheetPatch: Partial<SheetDocument> = {};
      if (entity.kind === "location" || entity.kind === "prop") {
        const notes = fields.notes?.trim();
        if (notes) sheetPatch.notes = notes;
      } else {
        for (const key of [
          "look",
          "age",
          "build",
          "wardrobe",
          "personality",
          "voiceNotes",
        ] as const) {
          const value = fields[key]?.trim();
          if (value) sheetPatch[key] = value;
        }
      }
      if (
        Object.keys(sheetPatch).length === 0 &&
        !fields.description?.trim()
      ) {
        throw new Error("Model returned no sheet fields");
      }

      let savedSheet: SheetDocument;
      if (Object.keys(sheetPatch).length > 0) {
        const saved = await ctx.runAction(api.entities.saveSheet, {
          entityId: args.entityId,
          patch: sheetPatch,
        });
        savedSheet = saved.sheet;
      } else {
        const refreshed = await ctx.runQuery(
          internal.entities.getEntityInternal,
          { entityId: args.entityId },
        );
        savedSheet = await loadSheetDoc(ctx, refreshed!);
      }

      if (fields.description?.trim()) {
        await ctx.runMutation(internal.entities.patchDescriptionInternal, {
          entityId: args.entityId,
          description: fields.description.trim(),
        });
      }

      const actualCostCredits = useMock ? 0 : estimatedCostCredits;
      await ctx.runMutation(internal.credits.settle, {
        workspaceId: project.workspaceId,
        userId: userId as Id<"users">,
        projectId: entity.projectId,
        jobId,
        estimated: estimatedCostCredits,
        actual: actualCostCredits,
      });
      await ctx.runMutation(internal.generation.markSucceeded, {
        jobId,
        actualCostCredits,
        outputAssetIds: [],
      });

      return {
        sheet: savedSheet,
        description: fields.description?.trim() || entity.description,
        estimatedCostCredits,
        actualCostCredits,
      };
    } catch (err) {
      await ctx.runMutation(internal.credits.refund, {
        workspaceId: project.workspaceId,
        userId: userId as Id<"users">,
        projectId: entity.projectId,
        jobId,
        amount: estimatedCostCredits,
      });
      await ctx.runMutation(internal.generation.markFailed, {
        jobId,
        errorMessage: err instanceof Error ? err.message : "Autofill failed",
      });
      throw err;
    }
  },
});

export const getProjectInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectId);
  },
});

export const getTipScriptInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const versions = await ctx.db
      .query("scriptVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    if (versions.length === 0) return null;
    return versions.sort((a, b) => b.createdAt - a.createdAt)[0]!;
  },
});

export const patchDescriptionInternal = internalMutation({
  args: {
    entityId: v.id("entities"),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.entityId, {
      description: args.description,
      updatedAt: Date.now(),
    });
  },
});

type AutofillKind = "character" | "creature" | "location" | "prop";

type AutofillFields = {
  description?: string;
  look?: string;
  age?: string;
  build?: string;
  wardrobe?: string;
  personality?: string;
  voiceNotes?: string;
  notes?: string;
};

function mockAutofillFields(
  kind: AutofillKind,
  name: string,
  description?: string,
): AutofillFields {
  if (kind === "location") {
    return {
      description: description ?? `${name} — key story location`,
      notes: `${name} at story-relevant time of day. Terrain, architecture, and atmosphere for image prompts. Distinctive landmarks, light direction, and color palette. No readable text or logos.`,
    };
  }
  if (kind === "prop") {
    return {
      description: description ?? `${name} — story prop`,
      notes: `${name}: materials, silhouette, wear, and signature detail. Readable hero object for close-ups.`,
    };
  }
  if (kind === "creature") {
    return {
      description: description ?? `A story-driven ${name}`,
      look: `${name}: powerful silhouette, distinctive markings, readable from a distance.`,
      age: "adult",
      build: "large, athletic, built for speed",
      wardrobe:
        "Simple riding gear — harness, saddle blanket, scabbard fittings.",
      personality: "Alert, loyal, explosive when the chase begins.",
      voiceNotes: "Low chuff and breath; no anthropomorphic speech.",
    };
  }
  return {
    description: description ?? `${name}, a lead character in the film`,
    look: `${name}: distinctive face and silhouette; story-readable costume accents.`,
    age: "teen",
    build: "lean and athletic",
    wardrobe: "Practical layered outfit with one signature accessory.",
    personality: "Focused, quiet resolve; speaks little, acts decisively.",
    voiceNotes: "Sparse dialogue; measured, grounded delivery.",
  };
}

async function llmAutofillFields(args: {
  kind: AutofillKind;
  name: string;
  description?: string;
  brief: { logline: string; audience?: string; tone?: string } | null;
  rules: string[];
  scriptSummary: string;
}): Promise<AutofillFields> {
  const briefLine = args.brief
    ? `Logline: ${args.brief.logline}${args.brief.tone ? ` Tone: ${args.brief.tone}.` : ""}`
    : "No brief yet.";
  const rulesLine =
    args.rules.length > 0
      ? `Project rules:\n- ${args.rules.join("\n- ")}`
      : "Project rules: (none).";

  const isPlaceOrProp =
    args.kind === "location" || args.kind === "prop";
  const system = isPlaceOrProp
    ? "You fill Look Dev sheet fields for Cinakey. Return ONLY a single JSON object with keys: description, notes. Each value is a concise string. No markdown fences."
    : "You fill Look Dev sheet fields for Cinakey. Return ONLY a single JSON object with keys: description, look, age, build, wardrobe, personality, voiceNotes. Each value is a concise string. No markdown fences.";
  const userHint = isPlaceOrProp
    ? args.kind === "location"
      ? "Describe place, time of day, land, sky/light, and color palette in notes — concrete and visual for environment image prompts. No readable text or logos."
      : "Describe materials, silhouette, wear, and signature detail in notes — concrete for product/prop image prompts."
    : "Keep details concrete and visual (usable for image prompts). Age/build short; look and wardrobe richer.";

  const result = await completeChat({
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          `Fill Look Dev fields for ${args.kind} "${args.name}".`,
          args.description ? `Current summary: ${args.description}` : "",
          briefLine,
          rulesLine,
          `Script context:\n${args.scriptSummary}`,
          userHint,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    toolChoice: "none",
  });

  const raw = result.content.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Model did not return JSON fields");
  }
  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  const pick = (key: string) =>
    typeof parsed[key] === "string" ? (parsed[key] as string) : undefined;
  return {
    description: pick("description"),
    look: pick("look"),
    age: pick("age"),
    build: pick("build"),
    wardrobe: pick("wardrobe"),
    personality: pick("personality"),
    voiceNotes: pick("voiceNotes"),
    notes: pick("notes"),
  };
}