import { assertTimelineDocument, type TimelineDocument } from "@cinakey/shared";
import { v, ConvexError } from "convex/values";
import { internal } from "../operations";
import type {
  Doc,
  Id,
} from "../../../../packages/backend/convex/_generated/dataModel";
import { action, type ActionCtx } from "../runtime/operation";
import { saveJson } from "./storage";
import { loadJson } from "../../../../packages/backend/convex/storage";

async function requireActionUser(ctx: ActionCtx) {
  const { getAuthUserId } = await import("@convex-dev/auth/server");
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not authenticated");
  }
  return userId as Id<"users">;
}

/** Load timeline JSON for a version (or tip if omitted). */
export const getContent = action({
  args: {
    projectId: v.id("projects"),
    versionId: v.optional(v.id("timelineVersions")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    version: Doc<"timelineVersions"> | null;
    document: TimelineDocument | null;
  }> => {
    const userId = await requireActionUser(ctx);
    await ctx.runQuery(internal.timelineVersions.assertAccess, {
      projectId: args.projectId,
      userId,
    });

    const version: Doc<"timelineVersions"> | null = args.versionId
      ? await ctx.runQuery(internal.timelineVersions.getVersionInternal, {
          versionId: args.versionId,
        })
      : await ctx.runQuery(internal.timelineVersions.getTipInternal, {
          projectId: args.projectId,
        });

    if (!version) {
      return { version: null, document: null };
    }
    if (version.projectId !== args.projectId) {
      throw new Error("Version does not belong to project");
    }

    const document = assertTimelineDocument(
      await loadJson(ctx, version.timelineFileId),
    );
    return { version, document };
  },
});

/** Parse and index all media dependencies before atomically publishing a snapshot. */
export const save = action({
  args: {
    projectId: v.id("projects"),
    parentId: v.union(v.id("timelineVersions"), v.null()),
    document: v.any(),
    requestId: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ versionId: Id<"timelineVersions"> }> => {
    const userId = await requireActionUser(ctx);
    await ctx.runQuery(internal.timelineVersions.assertAccess, {
      projectId: args.projectId,
      userId,
    });
    const document = assertTimelineDocument(args.document);
    if (document.project.id !== args.projectId)
      throw new Error("Timeline belongs to another project");
    if (!args.requestId || args.requestId.length > 128)
      throw new Error("Invalid save request ID");
    const ids = new Set<Id<"assets">>();
    for (const track of document.tracks)
      for (const clip of track.clips) {
        if (clip.source.type === "text") continue;
        ids.add(clip.source.assetId as Id<"assets">);
        if (clip.source.type === "take" && clip.source.proxyAssetId)
          ids.add(clip.source.proxyAssetId as Id<"assets">);
      }
    const { storageId } = await saveJson(ctx, document);
    let versionId: Id<"timelineVersions">;
    try {
      versionId = await ctx.runMutation(
        internal.timelineVersions.commitSnapshot,
        {
          projectId: args.projectId,
          parentId: args.parentId,
          timelineFileId: storageId,
          mediaAssetIds: [...ids],
          requestId: args.requestId,
          label: args.label,
        },
      );
    } catch (error) {
      // Only structured transaction rejection proves this file was not committed.
      // An unknown network outcome must retain the blob for safe replay/recovery.
      if (error instanceof ConvexError) await ctx.storage.delete(storageId);
      throw error;
    }
    const saved = await ctx.runQuery(
      internal.timelineVersions.getVersionInternal,
      { versionId },
    );
    if (saved && saved.timelineFileId !== storageId)
      await ctx.storage.delete(storageId);
    return { versionId };
  },
});
