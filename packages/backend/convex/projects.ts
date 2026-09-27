import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (user.personalWorkspaceId === undefined) {
      return [];
    }
    return await ctx.db
      .query("projects")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", user.personalWorkspaceId!),
      )
      .collect();
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await requireProjectAccess(ctx, args.projectId);
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    brief: v.optional(v.string()),
    aspectRatio: v.optional(v.string()),
    fps: v.optional(v.number()),
    targetLengthSec: v.optional(v.number()),
    styleNotes: v.optional(v.string()),
    rules: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspaceId = await ensurePersonalWorkspaceForUser(ctx, user._id);
    const now = Date.now();
    return await ctx.db.insert("projects", {
      workspaceId,
      title: args.title,
      brief: args.brief,
      aspectRatio: args.aspectRatio ?? "16:9",
      fps: args.fps ?? 24,
      targetLengthSec: args.targetLengthSec,
      styleNotes: args.styleNotes,
      rules: args.rules ?? [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.optional(v.string()),
    brief: v.optional(v.string()),
    aspectRatio: v.optional(v.string()),
    fps: v.optional(v.number()),
    targetLengthSec: v.optional(v.number()),
    styleNotes: v.optional(v.string()),
    rules: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const patch: {
      title?: string;
      brief?: string;
      aspectRatio?: string;
      fps?: number;
      targetLengthSec?: number;
      styleNotes?: string;
      rules?: string[];
      updatedAt: number;
    } = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = args.title;
    if (args.brief !== undefined) patch.brief = args.brief;
    if (args.aspectRatio !== undefined) patch.aspectRatio = args.aspectRatio;
    if (args.fps !== undefined) patch.fps = args.fps;
    if (args.targetLengthSec !== undefined) {
      patch.targetLengthSec = args.targetLengthSec;
    }
    if (args.styleNotes !== undefined) patch.styleNotes = args.styleNotes;
    if (args.rules !== undefined) patch.rules = args.rules;
    await ctx.db.patch(args.projectId, patch);
  },
});
