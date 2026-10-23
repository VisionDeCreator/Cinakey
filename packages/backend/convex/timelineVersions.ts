import { projectCanUseAsset } from "./lib/access";
import { v, ConvexError } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { insertVersion } from "./lib/versioning";

/**
 * Create a new timeline version. Never overwrites — inserts with parentId.
 */
export const createVersion = internalMutation({
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

    const latest = await ctx.db
      .query("timelineVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    if ((latest?._id ?? null) !== (args.parentId ?? null))
      throw new Error("Timeline conflict: a newer version exists");
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

export const commitSnapshot = internalMutation({
  args: {
    projectId: v.id("projects"),
    parentId: v.union(v.id("timelineVersions"), v.null()),
    timelineFileId: v.id("_storage"),
    mediaAssetIds: v.array(v.id("assets")),
    requestId: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await requireProjectAccess(ctx, args.projectId);
    const versions = await ctx.db
      .query("timelineVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
    const prior = versions.find(
      (version) => version.saveRequestId === args.requestId,
    );
    if (prior) return prior._id;
    if ((versions[0]?._id ?? null) !== args.parentId)
      throw new ConvexError({
        code: "TIMELINE_CONFLICT",
        message:
          "A newer timeline was saved elsewhere. Your local edits are preserved; reopen to resolve the conflict.",
      });
    for (const assetId of args.mediaAssetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset || !(await projectCanUseAsset(ctx, args.projectId, asset._id)))
        throw new Error("Timeline references missing or inaccessible media");
    }
    return ctx.db.insert("timelineVersions", {
      projectId: args.projectId,
      parentId: args.parentId ?? undefined,
      timelineFileId: args.timelineFileId,
      mediaAssetIds: args.mediaAssetIds,
      saveRequestId: args.requestId,
      label: args.label,
      createdBy: user._id,
      createdAt: Date.now(),
    });
  },
});
