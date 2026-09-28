/**
 * Browser export completion records + notifications.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { trackEvent } from "./lib/analytics";
import { RATE_LIMITS } from "./lib/limits";
import { assertRateLimit } from "./lib/rateLimit";
import { insertNotification } from "./notifications";

export const record = mutation({
  args: {
    projectId: v.id("projects"),
    durationSec: v.number(),
    width: v.number(),
    height: v.number(),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await requireProjectAccess(ctx, args.projectId);
    await assertRateLimit(
      ctx,
      `recordExport:${user._id}`,
      RATE_LIMITS.recordExport.limit,
      RATE_LIMITS.recordExport.windowMs,
    );

    if (
      !Number.isFinite(args.durationSec) ||
      args.durationSec < 0 ||
      args.width <= 0 ||
      args.height <= 0
    ) {
      throw new Error("Invalid export dimensions or duration");
    }

    const project = await ctx.db.get(args.projectId);
    if (project === null) throw new Error("Project not found");

    const exportId = await ctx.db.insert("exports", {
      projectId: args.projectId,
      userId: user._id,
      durationSec: args.durationSec,
      width: args.width,
      height: args.height,
      status: args.status,
      errorMessage: args.errorMessage,
      createdAt: Date.now(),
    });

    if (args.status === "succeeded") {
      await trackEvent(ctx, {
        name: "export.finished_minutes",
        userId: user._id,
        workspaceId: project.workspaceId,
        projectId: args.projectId,
        value: args.durationSec / 60,
      });
      await trackEvent(ctx, {
        name: "activation.export_completed",
        userId: user._id,
        workspaceId: project.workspaceId,
        projectId: args.projectId,
      });
    }

    const kind =
      args.status === "succeeded" ? "export_succeeded" : "export_failed";
    const title =
      args.status === "succeeded" ? "Export finished" : "Export failed";
    const body =
      args.status === "succeeded"
        ? `${Math.round(args.durationSec)}s at ${args.width}×${args.height}`
        : (args.errorMessage ?? "Export failed");

    await insertNotification(ctx, {
      userId: user._id,
      projectId: args.projectId,
      kind,
      title,
      body,
      href: `/projects/${args.projectId}/edit`,
    });

    if (args.status === "succeeded") {
      const approxBytes = Math.round(args.durationSec * 0.5 * 1024 * 1024);
      await ctx.db.insert("egressEvents", {
        userId: user._id,
        workspaceId: project.workspaceId,
        projectId: args.projectId,
        bytes: approxBytes,
        kind: "export",
        createdAt: Date.now(),
      });
    }

    return { exportId };
  },
});

export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    return await ctx.db
      .query("exports")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(20);
  },
});

export const hasSucceededExport = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const rows = await ctx.db
      .query("exports")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return rows.some((r) => r.status === "succeeded");
  },
});
