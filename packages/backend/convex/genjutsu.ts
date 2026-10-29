import { requireProjectUnpausedAccess } from "./lib/access";
import { requireProjectWrite } from "./lib/access";
import { assertPaymentProduction } from "./lib/paymentAccess";
import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import {
  canAccessProject,
  requireWorkspaceMembership,
  workspaceRole,
  requireProjectAccess,
  requireUser,
} from "./lib/access";
import { RATE_LIMITS } from "./lib/limits";
import { assertRateLimit } from "./lib/rateLimit";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";

export const list = query({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspaceId = args.workspaceId ?? user.personalWorkspaceId;
    if (!workspaceId) return [];
    await requireWorkspaceMembership(ctx, workspaceId);
    const sessions = (
      await ctx.db
        .query("genjutsuSessions")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect()
    ).sort((a, b) => b.updatedAt - a.updatedAt);
    const visible = [];
    for (const session of sessions) {
      const project = await ctx.db.get(session.storageScopeId);
      if (project && (await canAccessProject(ctx, project, user)))
        visible.push(session);
    }
    return visible;
  },
});
export const get = query({
  args: { sessionId: v.id("genjutsuSessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return null;
    await requireProjectAccess(ctx, session.storageScopeId);
    return session;
  },
});
export const create = mutation({
  args: { title: v.string(), workspaceId: v.optional(v.id("workspaces")) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await assertRateLimit(
      ctx,
      `createGenjutsu:${user._id}`,
      RATE_LIMITS.createProject.limit,
      RATE_LIMITS.createProject.windowMs,
    );
    const title = args.title.trim();
    if (!title || title.length > 120)
      throw new Error("Use a session name of 1–120 characters");
    const workspaceId =
      args.workspaceId ?? (await ensurePersonalWorkspaceForUser(ctx, user._id));
    const role = await workspaceRole(ctx, workspaceId, user._id);
    if (!role || role === "reviewer")
      throw new Error("Workspace access denied");
    await assertPaymentProduction(ctx, workspaceId);
    const now = Date.now();
    // An isolated infrastructure scope reuses media/usdMicros/workers. It is never
    // presented as a production project and cannot become a series episode.
    const storageScopeId = await ctx.db.insert("projects", {
      purpose: "genjutsu",
      workspaceId,
      title,
      aspectRatio: "16:9",
      fps: 24,
      rules: [],
      createdAt: now,
      updatedAt: now,
    });
    if (role === "creator")
      await ctx.db.insert("productionAssignments", {
        workspaceId,
        userId: user._id,
        projectId: storageScopeId,
        manageReviews: false,
      });
    return ctx.db.insert("genjutsuSessions", {
      workspaceId,
      storageScopeId,
      title,
      createdAt: now,
      updatedAt: now,
    });
  },
});
export const update = mutation({
  args: {
    sessionId: v.id("genjutsuSessions"),
    title: v.optional(v.string()),
    sourceAssetId: v.optional(v.id("assets")),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Transformation session not found");
    await requireProjectWrite(ctx, session.storageScopeId);
    if (
      args.title !== undefined &&
      (!args.title.trim() || args.title.trim().length > 120)
    )
      throw new Error("Use a session name of 1–120 characters");
    if (args.sourceAssetId) {
      if (session.sourceAssetId && session.sourceAssetId !== args.sourceAssetId)
        throw new Error(
          "Remove the current source video before uploading another.",
        );
      if (session.removedInputAssetIds?.includes(args.sourceAssetId))
        throw new Error(
          "This input was removed from the transformation session.",
        );
      const asset = await ctx.db.get(args.sourceAssetId);
      if (
        !asset ||
        asset.projectId !== session.storageScopeId ||
        asset.type !== "video"
      )
        throw new Error("Select a video from this transformation session");
    }
    await ctx.db.patch(session._id, {
      ...(args.title === undefined ? {} : { title: args.title.trim() }),
      ...(args.sourceAssetId ? { sourceAssetId: args.sourceAssetId } : {}),
      updatedAt: Date.now(),
    });
  },
});

/** Removing an input hides it from the current session, preserving generation history. */
export const removeInput = mutation({
  args: { sessionId: v.id("genjutsuSessions"), assetId: v.id("assets") },
  handler: async (ctx, { sessionId, assetId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Transformation session not found");
    await requireProjectUnpausedAccess(ctx, session.storageScopeId);
    const asset = await ctx.db.get(assetId);
    if (
      !asset ||
      asset.projectId !== session.storageScopeId ||
      !["image", "video"].includes(asset.type)
    )
      throw new Error("Input not found in this transformation session");
    await ctx.db.patch(sessionId, {
      removedInputAssetIds: [
        ...new Set([...(session.removedInputAssetIds ?? []), assetId]),
      ],
      ...(session.sourceAssetId === assetId
        ? { sourceAssetId: undefined }
        : {}),
      updatedAt: Date.now(),
    });
  },
});
export const inputState = internalQuery({
  args: { scopeId: v.id("projects") },
  handler: async (ctx, { scopeId }) => {
    const session = await ctx.db
      .query("genjutsuSessions")
      .withIndex("by_scope", (q) => q.eq("storageScopeId", scopeId))
      .first();
    return session?.removedInputAssetIds ?? [];
  },
});
