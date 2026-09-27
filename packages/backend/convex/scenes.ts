import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProjectAccess } from "./lib/access";

export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_project_order", (q) => q.eq("projectId", args.projectId))
      .collect();
    return scenes.sort((a, b) => a.order - b.order);
  },
});

export const get = query({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const scene = await ctx.db.get(args.sceneId);
    if (scene === null) return null;
    await requireProjectAccess(ctx, scene.projectId);
    return scene;
  },
});

export const rename = mutation({
  args: {
    sceneId: v.id("scenes"),
    heading: v.string(),
    synopsis: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scene = await ctx.db.get(args.sceneId);
    if (scene === null) throw new Error("Scene not found");
    await requireProjectAccess(ctx, scene.projectId);
    await ctx.db.patch(args.sceneId, {
      heading: args.heading.trim(),
      synopsis: args.synopsis,
      updatedAt: Date.now(),
    });
  },
});
