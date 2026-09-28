import {
  assertTimelineDocument,
  type TimelineDocument,
} from "@cinakey/shared";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { insertVersion } from "./lib/versioning";
import { loadJson } from "./storage";

async function requireActionUser(ctx: ActionCtx) {
  const { getAuthUserId } = await import("@convex-dev/auth/server");
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not authenticated");
  }
  return userId as Id<"users">;
}

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
    const versions = await ctx.db
      .query("timelineVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    if (versions.length === 0) return null;
    return versions.sort((a, b) => b.createdAt - a.createdAt)[0]!;
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
    const versions = await ctx.db
      .query("timelineVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    if (versions.length === 0) return null;
    return versions.sort((a, b) => b.createdAt - a.createdAt)[0]!;
  },
});

export const getVersionInternal = internalQuery({
  args: { versionId: v.id("timelineVersions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.versionId);
  },
});

/** Load timeline JSON for a version (or tip if omitted). */
export const getContent = action({
  args: {
    projectId: v.id("projects"),
    versionId: v.optional(v.id("timelineVersions")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    version: Doc<"timelineVersions"> | null;
    document: TimelineDocument | null;
  }> => {
    const userId = await requireActionUser(ctx);
    await ctx.runQuery(internal.timelineVersions.assertAccess, {
      projectId: args.projectId,
      userId,
    });

    const version: Doc<"timelineVersions"> | null = args.versionId
      ? await ctx.runQuery(internal.timelineVersions.getVersionInternal, {
          versionId: args.versionId,
        })
      : await ctx.runQuery(internal.timelineVersions.getTipInternal, {
          projectId: args.projectId,
        });

    if (!version) {
      return { version: null, document: null };
    }
    if (version.projectId !== args.projectId) {
      throw new Error("Version does not belong to project");
    }

    const document = assertTimelineDocument(
      await loadJson(ctx, version.timelineFileId),
    );
    return { version, document };
  },
});
