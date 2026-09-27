import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
    return await ctx.db
      .query("timelineVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});
