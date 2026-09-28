/**
 * Bytes served / stored tracking for R2 migration decisions.
 */

import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { RATE_LIMITS } from "./lib/limits";
import { assertRateLimit } from "./lib/rateLimit";

export const recordStorageWrite = internalMutation({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    projectId: v.optional(v.id("projects")),
    bytes: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.bytes <= 0) return;
    await ctx.db.insert("egressEvents", {
      userId: args.userId,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      bytes: args.bytes,
      kind: "storage_write",
      createdAt: Date.now(),
    });
  },
});

export const report = mutation({
  args: {
    projectId: v.id("projects"),
    bytes: v.number(),
    kind: v.union(
      v.literal("playback"),
      v.literal("download"),
      v.literal("export"),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await requireProjectAccess(ctx, args.projectId);
    await assertRateLimit(
      ctx,
      `reportEgress:${user._id}`,
      RATE_LIMITS.reportEgress.limit,
      RATE_LIMITS.reportEgress.windowMs,
    );
    if (!Number.isFinite(args.bytes) || args.bytes <= 0) {
      throw new Error("bytes must be a positive number");
    }
    const project = await ctx.db.get(args.projectId);
    if (project === null) throw new Error("Project not found");

    await ctx.db.insert("egressEvents", {
      userId: user._id,
      workspaceId: project.workspaceId,
      projectId: args.projectId,
      bytes: Math.round(args.bytes),
      kind: args.kind,
      createdAt: Date.now(),
    });
  },
});
