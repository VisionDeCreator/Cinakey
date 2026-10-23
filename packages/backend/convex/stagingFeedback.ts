import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireProjectAccess } from "./lib/access";

const MAX_EDITS_KEPT = 5;

async function latestRunFor(
  ctx: QueryCtx,
  sequenceId: Id<"sequences">,
): Promise<Doc<"stagingRuns"> | null> {
  return await ctx.db
    .query("stagingRuns")
    .withIndex("by_sequence_time", (q) => q.eq("sequenceId", sequenceId))
    .order("desc")
    .first();
}

/** Record a staging run; the previous run for the part is marked replaced. */
export const recordRun = internalMutation({
  args: {
    projectId: v.id("projects"),
    sequenceId: v.id("sequences"),
    userId: v.id("users"),
    scriptPromptId: v.optional(v.id("promptSheets")),
    source: v.union(
      v.literal("plan"),
      v.literal("plan_reused"),
      v.literal("rules"),
    ),
    fresh: v.boolean(),
    planFileId: v.optional(v.id("_storage")),
    documentFileId: v.optional(v.id("_storage")),
    issuesBefore: v.number(),
    issuesAfter: v.number(),
    issueSample: v.array(v.string()),
    repaired: v.boolean(),
    creditsSpent: v.number(),
    stagingNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");
    const now = Date.now();
    const prev = await latestRunFor(ctx, args.sequenceId);
    if (prev && !prev.supersededAt) {
      await ctx.db.patch(prev._id, {
        supersededAt: now,
        supersededBy: args.fresh ? "regenerate" : "update",
      });
    }
    return await ctx.db.insert("stagingRuns", {
      ...args,
      issueSample: args.issueSample.slice(0, 12),
      workspaceId: project.workspaceId,
      editCount: 0,
      edits: [],
      createdAt: now,
    });
  },
});

export const latestRunInternal = internalQuery({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => latestRunFor(ctx, args.sequenceId),
});

export const addEdit = internalMutation({
  args: {
    runId: v.id("stagingRuns"),
    fileId: v.id("_storage"),
    corrections: v.array(
      v.object({
        shot: v.union(v.number(), v.null()),
        kind: v.string(),
        target: v.optional(v.string()),
        amount: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    const at = Date.now();
    await ctx.db.patch(args.runId, {
      editCount: run.editCount + 1,
      lastEditedAt: at,
      edits: [
        ...run.edits,
        { at, fileId: args.fileId, corrections: args.corrections },
      ].slice(-MAX_EDITS_KEPT),
    });
  },
});

/** Video generation started from this part: the current staging was good enough to use. */
export const markAccepted = internalMutation({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => {
    const run = await latestRunFor(ctx, args.sequenceId);
    if (run && !run.acceptedAt)
      await ctx.db.patch(run._id, { acceptedAt: Date.now() });
  },
});

export const SHOT_FEEDBACK_REASONS = [
  "framing",
  "wrong_subject",
  "wrong_action",
  "wrong_place",
  "timing",
  "missing_cast",
  "other",
] as const;

/** Thumbs up / down on one shot of the current staging (one rating per user per shot). */
export const rateShot = mutation({
  args: {
    sequenceId: v.id("sequences"),
    shotN: v.number(),
    rating: v.union(v.literal("up"), v.literal("down"), v.null()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const seq = await ctx.db.get(args.sequenceId);
    if (!seq) throw new Error("Sequence not found");
    await requireProjectAccess(ctx, seq.projectId);
    const run = await latestRunFor(ctx, args.sequenceId);
    if (!run) throw new Error("Build the blockout first");
    const reason =
      args.reason &&
      (SHOT_FEEDBACK_REASONS as readonly string[]).includes(args.reason)
        ? args.reason
        : undefined;
    const existing = await ctx.db
      .query("stagingShotFeedback")
      .withIndex("by_run_user_shot", (q) =>
        q.eq("runId", run._id).eq("userId", userId).eq("shotN", args.shotN),
      )
      .first();
    const now = Date.now();
    if (args.rating === null) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        rating: args.rating,
        reason,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("stagingShotFeedback", {
        runId: run._id,
        sequenceId: args.sequenceId,
        projectId: seq.projectId,
        userId,
        shotN: args.shotN,
        rating: args.rating,
        reason,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

/** The current user's ratings on the part's current staging. */
export const shotRatings = query({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const seq = await ctx.db.get(args.sequenceId);
    if (!seq) return null;
    await requireProjectAccess(ctx, seq.projectId);
    const run = await latestRunFor(ctx, args.sequenceId);
    if (!run) return null;
    const rows = await ctx.db
      .query("stagingShotFeedback")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    return {
      runId: run._id,
      ratings: rows
        .filter((r) => r.userId === userId)
        .map((r) => ({ shotN: r.shotN, rating: r.rating, reason: r.reason })),
    };
  },
});
