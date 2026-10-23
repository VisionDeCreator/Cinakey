import { assertScriptDocument } from "@cinakey/shared";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { materializeScriptWithPrevious } from "./lib/scriptMaterialize";
import { insertVersion } from "./lib/versioning";

export const createVersion = mutation({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("scriptVersions")),
    format: v.union(v.literal("screenplay"), v.literal("av")),
    label: v.optional(v.string()),
    contentFileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await requireProjectAccess(ctx, args.projectId);

    if (args.parentId !== undefined) {
      const parent = await ctx.db.get(args.parentId);
      if (parent === null || parent.projectId !== args.projectId) {
        throw new Error("Invalid parent script version");
      }
    }

    return await insertVersion(ctx, "scriptVersions", {
      projectId: args.projectId,
      parentId: args.parentId,
      format: args.format,
      label: args.label,
      contentFileId: args.contentFileId,
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
      .query("scriptVersions")
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
      .query("scriptVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

export const getVersion = query({
  args: { versionId: v.id("scriptVersions") },
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
      .query("scriptVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

export const getVersionInternal = internalQuery({
  args: { versionId: v.id("scriptVersions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.versionId);
  },
});

/** Internal: insert version + materialize scenes/entities. */
export const commitDocument = internalMutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    contentFileId: v.id("_storage"),
    format: v.union(v.literal("screenplay"), v.literal("av")),
    label: v.optional(v.string()),
    parentId: v.optional(v.id("scriptVersions")),
    document: v.any(),
    previousDocument: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (project === null) throw new Error("Project not found");

    const document = assertScriptDocument(args.document);
    const previous =
      args.previousDocument !== undefined
        ? assertScriptDocument(args.previousDocument)
        : null;

    const versionId = await insertVersion(ctx, "scriptVersions", {
      projectId: args.projectId,
      parentId: args.parentId,
      format: args.format,
      label: args.label,
      contentFileId: args.contentFileId,
      createdBy: args.userId,
      createdAt: Date.now(),
    });

    const result = await materializeScriptWithPrevious(ctx, {
      projectId: args.projectId,
      document,
      previousDocument: previous,
    });

    await ctx.db.patch(args.projectId, { updatedAt: Date.now() });

    return {
      versionId,
      document: result.document,
      sceneIds: result.sceneIds,
      entityIds: result.entityIds,
    };
  },
});
