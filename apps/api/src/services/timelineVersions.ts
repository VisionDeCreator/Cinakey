import { assertTimelineDocument, type TimelineDocument } from "@cinakey/shared";
import { v } from "convex/values";
import { internal } from "../operations";
import type {
  Doc,
  Id,
} from "../../../../packages/backend/convex/_generated/dataModel";
import { action, type ActionCtx } from "../runtime/operation";
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
