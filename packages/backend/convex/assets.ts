import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { buildSearchText } from "./lib/assetSearch";
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
    .filter((p) => p.archivedAt === undefined)
    .map((p) => p._id);
}

export const list = query({
  args: {
    projectId: v.optional(v.id("projects")),
    type: v.optional(assetType),
    tag: v.optional(v.string()),
    characterId: v.optional(v.id("entities")),
    shotId: v.optional(v.id("shots")),
    starredOnly: v.optional(v.boolean()),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    let projectIds: Id<"projects">[];
    if (args.projectId !== undefined) {
      await requireProjectAccess(ctx, args.projectId);
      projectIds = [args.projectId];
    } else if (user.personalWorkspaceId === undefined) {
      return [];
    } else {
      projectIds = await workspaceProjectIds(ctx, user.personalWorkspaceId);
    }

    if (projectIds.length === 0) {
      return [];
    }

    let characterShotIds: Set<Id<"shots">> | null = null;
    if (args.characterId !== undefined) {
      characterShotIds = new Set();
      for (const pid of projectIds) {
        const shots = await ctx.db
          .query("shots")
          .withIndex("by_project", (q) => q.eq("projectId", pid))
          .collect();
        for (const shot of shots) {
          if (shot.characterIds.includes(args.characterId)) {
            characterShotIds.add(shot._id);
          }
        }
      }
    }

    const searchQuery = args.query?.trim();
    let collected: Doc<"assets">[] = [];

    if (searchQuery && searchQuery.length > 0) {
      for (const pid of projectIds) {
        const hits = await ctx.db
          .query("assets")
          .withSearchIndex("search_name_tags", (sq) => {
            let s = sq.search("searchText", searchQuery).eq("projectId", pid);
            if (args.type !== undefined) {
              s = s.eq("type", args.type);
            }
            if (args.starredOnly === true) {
              s = s.eq("starred", true);
            }
            return s;
          })
          .collect();
        collected.push(...hits);
      }
    } else {
      for (const pid of projectIds) {
        const rows =
          args.type !== undefined
            ? await ctx.db
                .query("assets")
                .withIndex("by_project_type", (q) =>
                  q.eq("projectId", pid).eq("type", args.type!),
                )
                .collect()
            : await ctx.db
                .query("assets")
                .withIndex("by_project", (q) => q.eq("projectId", pid))
                .collect();
        collected.push(...rows);
      }
    }

    if (args.starredOnly === true && !(searchQuery && searchQuery.length > 0)) {
      collected = collected.filter((a) => a.starred);
    }
    if (args.tag !== undefined && args.tag.length > 0) {
      const tag = args.tag.toLowerCase();
      collected = collected.filter((a) =>
        a.tags.some((t) => t.toLowerCase() === tag),
      );
    }
    if (args.shotId !== undefined) {
      collected = collected.filter((a) => a.shotId === args.shotId);
    }
    if (characterShotIds !== null) {
      collected = collected.filter(
        (a) => a.shotId !== undefined && characterShotIds.has(a.shotId),
      );
    }

    collected.sort((a, b) => b.updatedAt - a.updatedAt);
    return collected;
  },
});

export const filterOptions = query({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    let projectIds: Id<"projects">[];
    if (args.projectId !== undefined) {
      await requireProjectAccess(ctx, args.projectId);
      projectIds = [args.projectId];
    } else if (user.personalWorkspaceId === undefined) {
      return { characters: [], shots: [], tags: [] as string[] };
    } else {
      projectIds = await workspaceProjectIds(ctx, user.personalWorkspaceId);
    }

    const characters: {
      _id: Id<"entities">;
      name: string;
      projectId: Id<"projects">;
    }[] = [];
    const shots: {
      _id: Id<"shots">;
      shotType: string;
      order: number;
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
      const projectShots = await ctx.db
        .query("shots")
        .withIndex("by_project", (q) => q.eq("projectId", pid))
        .collect();
      for (const s of projectShots) {
        shots.push({
          _id: s._id,
          shotType: s.shotType,
          order: s.order,
          projectId: pid,
        });
      }
      const assets = await ctx.db
        .query("assets")
        .withIndex("by_project", (q) => q.eq("projectId", pid))
        .collect();
      for (const a of assets) {
        for (const t of a.tags) tags.add(t);
      }
    }

    return {
      characters,
      shots,
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
    await requireProjectAccess(ctx, asset.projectId);

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
    await requireProjectAccess(ctx, asset.projectId);
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
    await requireProjectAccess(ctx, asset.projectId);
    await deleteFile(ctx, asset.storageId);
    await ctx.db.delete(args.assetId);
  },
});
