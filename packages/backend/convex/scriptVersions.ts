import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { insertVersion } from "./lib/versioning";

/**
 * Create a new script version. Never overwrites an existing version row —
 * always inserts with an optional parentId.
 */
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
    return await ctx.db
      .query("scriptVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});
