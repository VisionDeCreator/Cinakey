import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { insertVersion } from "./lib/versioning";

/**
 * Create a new timeline version. Never overwrites — inserts with parentId.
 */
export const createVersion = mutation({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("timelineVersions")),
    label: v.optional(v.string()),
    timelineFileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await requireProjectAccess(ctx, args.projectId);

    if (args.parentId !== undefined) {
      const parent = await ctx.db.get(args.parentId);
      if (parent === null || parent.projectId !== args.projectId) {
        throw new Error("Invalid parent timeline version");
      }
    }

    return await insertVersion(ctx, "timelineVersions", {
      projectId: args.projectId,
      parentId: args.parentId,
      label: args.label,
      timelineFileId: args.timelineFileId,
      createdBy: user._id,
      createdAt: Date.now(),
    });
  },
});

export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const versions = await ctx.db
      .query("timelineVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return versions.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getTip = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    return await ctx.db
      .query("timelineVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

export const getVersion = query({
  args: { versionId: v.id("timelineVersions") },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (version === null) return null;
    await requireProjectAccess(ctx, version.projectId);
    return version;
  },
});

export const assertAccess = internalQuery({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (project === null) throw new Error("Project not found");
    const user = await ctx.db.get(args.userId);
    if (user === null) throw new Error("User not found");
    if (user.isStaff === true) return true;
    if (user.personalWorkspaceId !== project.workspaceId) {
      throw new Error("Forbidden");
    }
    return true;
  },
});

export const getTipInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("timelineVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

export const getVersionInternal = internalQuery({
  args: { versionId: v.id("timelineVersions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.versionId);
  },
});
