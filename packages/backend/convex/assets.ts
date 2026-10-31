import { assertPaymentProduction } from "./lib/paymentAccess";
import { requireProjectGenerationWrite } from "./lib/access";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  requireWorkspaceMembership,
  canAccessProject,
  projectAssets,
  requireAssetAccess,
  requireProjectAccess,
  requireUser,
} from "./lib/access";
import { buildSearchText } from "./lib/assetSearch";
import { assertMediaRemovable } from "./lib/mediaProtection";
import { deleteFile } from "./storage";

const assetType = v.union(
  v.literal("video"),
  v.literal("image"),
  v.literal("audio"),
  v.literal("music"),
  v.literal("logo"),
  v.literal("json"),
  v.literal("other"),
);

type ListCtx = QueryCtx | MutationCtx;

async function workspaceProjectIds(
  ctx: ListCtx,
  workspaceId: Id<"workspaces">,
): Promise<Id<"projects">[]> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  return projects
    .filter((p) => p.archivedAt === undefined && p.purpose !== "genjutsu")
    .map((p) => p._id);
}

export const list = query({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    projectId: v.optional(v.id("projects")),
    type: v.optional(assetType),
    tag: v.optional(v.string()),
    characterId: v.optional(v.id("entities")),

    starredOnly: v.optional(v.boolean()),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const workspaceId = args.workspaceId ?? user.personalWorkspaceId;
    if (args.workspaceId)
      await requireWorkspaceMembership(ctx, args.workspaceId);
    let projectIds: Id<"projects">[];
    if (args.projectId !== undefined) {
      const project = await requireProjectAccess(ctx, args.projectId);
      if (args.workspaceId && project.workspaceId !== args.workspaceId)
        throw new Error("Project/workspace mismatch");
      projectIds = [args.projectId];
    } else if (workspaceId === undefined) {
      return [];
    } else {
      projectIds = [];
      for (const id of await workspaceProjectIds(ctx, workspaceId)) {
        const project = await ctx.db.get(id);
        if (project && (await canAccessProject(ctx, project, user)))
          projectIds.push(id);
      }
    }

    if (projectIds.length === 0) {
      return [];
    }

    const character = args.characterId
      ? await ctx.db.get(args.characterId)
      : null;
    if (
      args.characterId &&
      (!character || !projectIds.includes(character.projectId))
    )
      return [];
    const characterReferences = new Set(
      character?.lockedReferenceAssetIds ?? [],
    );
    const searchQuery = args.query?.trim();
    let collected: Doc<"assets">[] = [];

    for (const pid of projectIds)
      collected.push(...(await projectAssets(ctx, pid)));
    collected = [...new Map(collected.map((a) => [a._id, a])).values()];
    if (args.type) collected = collected.filter((a) => a.type === args.type);
    if (searchQuery)
      collected = collected.filter((a) =>
        a.searchText.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    if (args.starredOnly) collected = collected.filter((a) => a.starred);

    if (args.tag !== undefined && args.tag.length > 0) {
      const tag = args.tag.toLowerCase();
      collected = collected.filter((a) =>
        a.tags.some((t) => t.toLowerCase() === tag),
      );
    }
    if (args.characterId)
      collected = collected.filter(
        (asset) =>
          asset.entityId === args.characterId ||
          characterReferences.has(asset._id) ||
          asset.lineage?.referenceAssetIds?.some((id) =>
            characterReferences.has(id),
          ) ||
          asset.lineage?.parentAssetIds?.some((id) =>
            characterReferences.has(id),
          ),
      );

    collected.sort((a, b) => b.updatedAt - a.updatedAt);
    return collected;
  },
});

export const filterOptions = query({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const workspaceId = args.workspaceId ?? user.personalWorkspaceId;
    if (args.workspaceId)
      await requireWorkspaceMembership(ctx, args.workspaceId);
    let projectIds: Id<"projects">[];
    if (args.projectId !== undefined) {
      const project = await requireProjectAccess(ctx, args.projectId);
      if (args.workspaceId && project.workspaceId !== args.workspaceId)
        throw new Error("Project/workspace mismatch");
      projectIds = [args.projectId];
    } else if (workspaceId === undefined) {
      return { characters: [], tags: [] as string[] };
    } else {
      projectIds = [];
      for (const id of await workspaceProjectIds(ctx, workspaceId)) {
        const project = await ctx.db.get(id);
        if (project && (await canAccessProject(ctx, project, user)))
          projectIds.push(id);
      }
    }

    const characters: {
      _id: Id<"entities">;
      name: string;
      projectId: Id<"projects">;
    }[] = [];

    const tags = new Set<string>();

    for (const pid of projectIds) {
      const ents = await ctx.db
        .query("entities")
        .withIndex("by_project_kind", (q) =>
          q.eq("projectId", pid).eq("kind", "character"),
        )
        .collect();
      for (const e of ents) {
        characters.push({ _id: e._id, name: e.name, projectId: pid });
      }
      const assets = await projectAssets(ctx, pid);
      for (const a of assets) {
        for (const t of a.tags) tags.add(t);
      }
    }

    return {
      characters,
      tags: [...tags].sort(),
    };
  },
});

export const update = mutation({
  args: {
    assetId: v.id("assets"),
    name: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (asset === null) {
      throw new Error("Asset not found");
    }
    await requireAssetAccess(ctx, asset._id);
    if (asset.projectId) {
      const project = await requireProjectGenerationWrite(ctx, asset.projectId);
      if (args.tags !== undefined)
        await assertPaymentProduction(ctx, project.workspaceId);
    } else if (asset.workspaceId)
      await assertPaymentProduction(ctx, asset.workspaceId);
    else throw new Error("Asset workspace not found");

    const name = args.name !== undefined ? args.name.trim() : asset.name;
    if (name.length === 0) {
      throw new Error("Name cannot be empty");
    }
    const tags = args.tags ?? asset.tags;
    await ctx.db.patch(args.assetId, {
      name,
      tags,
      searchText: buildSearchText(name, tags),
      updatedAt: Date.now(),
    });
  },
});

export const setStarred = mutation({
  args: {
    assetId: v.id("assets"),
    starred: v.boolean(),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (asset === null) {
      throw new Error("Asset not found");
    }
    await requireAssetAccess(ctx, asset._id);
    const project = asset.projectId ? await ctx.db.get(asset.projectId) : null;
    const workspaceId = project?.workspaceId ?? asset.workspaceId;
    if (!workspaceId) throw new Error("Asset workspace not found");
    await assertPaymentProduction(ctx, workspaceId);
    await ctx.db.patch(args.assetId, {
      starred: args.starred,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (asset === null) {
      throw new Error("Asset not found");
    }
    await requireAssetAccess(ctx, asset._id);
    await assertMediaRemovable(ctx, asset.projectId, args.assetId);
    await deleteFile(ctx, asset.storageId);
    await ctx.db.delete(args.assetId);
  },
});
