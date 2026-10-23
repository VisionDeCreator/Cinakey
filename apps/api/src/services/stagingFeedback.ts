import { diffBlockoutEdits, isBlockoutDocument } from "@cinakey/shared";
import { v } from "convex/values";
import { internal } from "../operations";
import { internalAction } from "../runtime/operation";
import { loadJson } from "../../../../packages/backend/convex/storage";

/**
 * A user saved the part in the 3D editor: diff it against the compiled blockout
 * of the current run (cumulative — the latest entry is the total correction).
 */
export const recordEdit = internalAction({
  args: { sequenceId: v.id("sequences"), fileId: v.id("_storage") },
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.stagingFeedback.latestRunInternal, {
      sequenceId: args.sequenceId,
    });
    if (!run?.documentFileId || run.documentFileId === args.fileId) return;
    try {
      const before = await loadJson(ctx, run.documentFileId);
      const after = await loadJson(ctx, args.fileId);
      if (!isBlockoutDocument(before) || !isBlockoutDocument(after)) return;
      const corrections = diffBlockoutEdits(before, after).map((c) => ({
        shot: c.shot,
        kind: c.kind,
        ...(c.target !== undefined ? { target: c.target.slice(0, 80) } : {}),
        ...(c.amount !== undefined ? { amount: c.amount } : {}),
      }));
      await ctx.runMutation(internal.stagingFeedback.addEdit, {
        runId: run._id,
        fileId: args.fileId,
        corrections,
      });
    } catch {
      // Feedback capture must never break saving.
    }
  },
});
