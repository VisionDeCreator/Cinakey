import { normalizeEntityName } from "@cinakey/shared";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { getAdapter } from "./adapters";
import { projectCanUseAsset, requireProjectAccess } from "./lib/access";

const kindValidator = v.union(
  v.literal("character"),
  v.literal("creature"),
  v.literal("location"),
  v.literal("prop"),
  v.literal("style"),
);

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
    for (const id of entity.lockedReferenceAssetIds) {
      if (assets.some((a) => a._id === id)) continue;
      const asset = await ctx.db.get(id);
      if (asset) assets.push(asset);
    }
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
    const project = await ctx.db.get(args.projectId);
    if (
      project?.activeStyleEntityId &&
      (await ctx.db.get(project.activeStyleEntityId))
    )
      return project.activeStyleEntityId;
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
    kind: v.optional(
      v.union(
        v.literal("character"),
        v.literal("creature"),
        v.literal("location"),
        v.literal("prop"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (entity === null) throw new Error("Entity not found");
    await requireProjectAccess(ctx, entity.projectId);
    const patch: {
      kind?: "character" | "creature" | "location" | "prop";
      name?: string;
      description?: string;
      updatedAt: number;
    } = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length === 0) throw new Error("Entity name is required");
      patch.name = name;
    }
    if (args.kind !== undefined) {
      if (entity.kind === "style")
        throw new Error("Cannot change the style entity kind");
      patch.kind = args.kind;
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
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new Error("Entity not found");
    for (const assetId of args.lockedReferenceAssetIds) {
      if (!(await projectCanUseAsset(ctx, entity.projectId, assetId)))
        throw new Error("Reference is not available in this project");
    }
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
    const project = await ctx.db.get(args.projectId);
    if (project?.activeStyleEntityId) {
      const active = await ctx.db.get(project.activeStyleEntityId);
      if (active?.projectId === args.projectId && active.kind === "style")
        return active;
    }
    return await ctx.db
      .query("entities")
      .withIndex("by_project_kind", (q) =>
        q.eq("projectId", args.projectId).eq("kind", "style"),
      )
      .first();
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
      adapter?.estimateCost({ estimatedTokens: AUTOFILL_ESTIMATED_TOKENS }) ??
        2,
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
      .query("workspaceScripts")
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
