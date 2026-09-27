import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireProjectAccess } from "./lib/access";

/**
 * Point a shot at a newly uploaded blockout JSON file.
 * Never overwrites the previous storage blob — callers upload a new file
 * first (via storage.createUploadUrl), then pass the new storageId here.
 * The prior blockoutFileId remains in storage for rollback until GC.
 */
export const saveBlockout = mutation({
  args: {
    shotId: v.id("shots"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) {
      throw new Error("Shot not found");
    }
    await requireProjectAccess(ctx, shot.projectId);
    await ctx.db.patch(args.shotId, {
      blockoutFileId: args.storageId,
      updatedAt: Date.now(),
    });
    return args.storageId;
  },
});
