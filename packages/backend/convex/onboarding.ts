import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { trackEvent } from "./lib/analytics";

export const trackStarterCreated = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    await trackEvent(ctx, {
      name: "activation.starter_created",
      userId: args.userId,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
    });
  },
});

/** Attach a sample uploaded video as a selected take for a starter shot. */

export const dismissOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { onboardingDismissedAt: Date.now() });
  },
});

export const getChecklist = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const project = await ctx.db.get(args.projectId);
    if (project === null) return null;

    const [scripts, assets, staging, timelines, exports] = await Promise.all([
      ctx.db
        .query("workspaceScripts")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .first(),
      ctx.db
        .query("assets")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect(),
      ctx.db
        .query("workspaceStaging")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .first(),
      ctx.db
        .query("timelineVersions")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .first(),
      ctx.db
        .query("exports")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .first(),
    ]);

    return {
      isStarter: project.isStarter === true,
      steps: [
        {
          id: "script",
          label: "Review the script",
          href: "script",
          done: scripts !== null,
        },
        {
          id: "assets",
          label: "Create assets",
          href: "assets",
          done: assets.length > 0,
        },
        {
          id: "blockout",
          label: "Create staging (optional)",
          href: "blockout",
          done: staging !== null,
        },
        {
          id: "videos",
          label: "Choose videos (samples are ready)",
          href: "video",
          done: assets.some((asset) => asset.type === "video"),
        },
        {
          id: "edit",
          label: "Assemble and edit the timeline",
          href: "edit",
          done: timelines !== null,
        },
        {
          id: "export",
          label: "Export your video",
          href: "edit",
          done: exports !== null && exports.status === "succeeded",
        },
      ],
    };
  },
});
