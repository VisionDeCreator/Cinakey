import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { requireProjectAccess } from "./lib/access";

export const listSequenceShotsInternal = internalQuery({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => {
    const seq = await ctx.db.get(args.sequenceId);
    if (!seq) return { sequence: null, shots: [], scenes: [], project: null };
    const project = await ctx.db.get(seq.projectId);
    const shots = [];
    for (const id of seq.shotIds) {
      const s = await ctx.db.get(id);
      if (s) shots.push(s);
    }
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_project", (q) => q.eq("projectId", seq.projectId))
      .collect();
    return { sequence: seq, shots, scenes, project };
  },
});

export const applySavedPartBlockout = internalMutation({
  args: {
    sequenceId: v.id("sequences"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const seq = await ctx.db.get(args.sequenceId);
    if (seq === null) throw new Error("Sequence not found");
    await ctx.db.patch(args.sequenceId, {
      blockoutFileId: args.storageId,
      updatedAt: Date.now(),
    });
    for (const shotId of seq.shotIds) {
      const shot = await ctx.db.get(shotId);
      if (shot && shot.status === "planned") {
        await ctx.db.patch(shotId, {
          status: "blocked_out",
          updatedAt: Date.now(),
        });
      }
    }
  },
});

/** Point a shot at a blockout file (legacy / versioning tests). */
export const saveBlockout = mutation({
  args: {
    shotId: v.id("shots"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) throw new Error("Shot not found");
    await requireProjectAccess(ctx, shot.projectId);
    await ctx.db.patch(args.shotId, {
      blockoutFileId: args.storageId,
      updatedAt: Date.now(),
    });
    return args.storageId;
  },
});
