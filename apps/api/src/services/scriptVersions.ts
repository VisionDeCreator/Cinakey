import {
  assertScriptDocument,
  diffScripts,
  scriptToPlainText,
  withRuntimeEstimates,
  type ScriptDiffOp,
  type ScriptDocument,
  type ScriptFormat,
} from "@cinakey/shared";
import { v } from "convex/values";
import { internal } from "../operations";
import type {
  Doc,
  Id,
} from "../../../../packages/backend/convex/_generated/dataModel";
import { action, internalAction, type ActionCtx } from "../runtime/operation";
import { loadJson } from "../../../../packages/backend/convex/storage";
import { saveJson } from "./storage";

async function requireActionUser(ctx: ActionCtx) {
  const { getAuthUserId } = await import("@convex-dev/auth/server");
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not authenticated");
  }
  return userId as Id<"users">;
}

async function commitFromAction(
  ctx: ActionCtx,
  args: {
    projectId: Id<"projects">;
    userId: Id<"users">;
    document: unknown;
    label?: string;
    parentId?: Id<"scriptVersions">;
  },
): Promise<{
  versionId: Id<"scriptVersions">;
  document: ScriptDocument;
  sceneIds: Id<"scenes">[];
  entityIds: Id<"entities">[];
}> {
  await ctx.runQuery(internal.scriptVersions.assertAccess, {
    projectId: args.projectId,
    userId: args.userId,
  });

  const document = withRuntimeEstimates(assertScriptDocument(args.document));
  const tip: Doc<"scriptVersions"> | null = await ctx.runQuery(
    internal.scriptVersions.getTipInternal,
    { projectId: args.projectId },
  );

  let previousDocument: ScriptDocument | null = null;
  if (tip) {
    previousDocument = assertScriptDocument(
      await loadJson(ctx, tip.contentFileId),
    );
  }

  const parentId: Id<"scriptVersions"> | undefined = args.parentId ?? tip?._id;
  const { storageId } = await saveJson(ctx, document);

  return await ctx.runMutation(internal.scriptVersions.commitDocument, {
    projectId: args.projectId,
    userId: args.userId,
    contentFileId: storageId,
    format: document.format as ScriptFormat,
    label: args.label,
    parentId,
    document,
    previousDocument: previousDocument ?? undefined,
  });
}

/**
 * Save a new script version from a document, materialize live records.
 */
export const commit = action({
  args: {
    projectId: v.id("projects"),
    document: v.any(),
    label: v.optional(v.string()),
    parentId: v.optional(v.id("scriptVersions")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    versionId: Id<"scriptVersions">;
    document: ScriptDocument;
    sceneIds: Id<"scenes">[];
    entityIds: Id<"entities">[];
  }> => {
    const userId = await requireActionUser(ctx);
    return await commitFromAction(ctx, {
      projectId: args.projectId,
      userId,
      document: args.document,
      label: args.label,
      parentId: args.parentId,
    });
  },
});

/** Load script JSON for a version (or tip if omitted). */
export const getContent = action({
  args: {
    projectId: v.id("projects"),
    versionId: v.optional(v.id("scriptVersions")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    version: Doc<"scriptVersions"> | null;
    document: ScriptDocument | null;
  }> => {
    const userId = await requireActionUser(ctx);
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: args.projectId,
      userId,
    });

    const version: Doc<"scriptVersions"> | null = args.versionId
      ? await ctx.runQuery(internal.scriptVersions.getVersionInternal, {
          versionId: args.versionId,
        })
      : await ctx.runQuery(internal.scriptVersions.getTipInternal, {
          projectId: args.projectId,
        });

    if (!version) {
      return { version: null, document: null };
    }
    if (version.projectId !== args.projectId) {
      throw new Error("Version does not belong to project");
    }

    const document = assertScriptDocument(
      await loadJson(ctx, version.contentFileId),
    );
    return { version, document };
  },
});

/** Structural diff between two versions. */
export const diffVersions = action({
  args: {
    projectId: v.id("projects"),
    leftVersionId: v.id("scriptVersions"),
    rightVersionId: v.id("scriptVersions"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    left: Doc<"scriptVersions">;
    right: Doc<"scriptVersions">;
    ops: ScriptDiffOp[];
    leftText: string;
    rightText: string;
    leftDocument: ScriptDocument;
    rightDocument: ScriptDocument;
  }> => {
    const userId = await requireActionUser(ctx);
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: args.projectId,
      userId,
    });

    const left: Doc<"scriptVersions"> | null = await ctx.runQuery(
      internal.scriptVersions.getVersionInternal,
      { versionId: args.leftVersionId },
    );
    const right: Doc<"scriptVersions"> | null = await ctx.runQuery(
      internal.scriptVersions.getVersionInternal,
      { versionId: args.rightVersionId },
    );
    if (!left || !right) throw new Error("Version not found");
    if (
      left.projectId !== args.projectId ||
      right.projectId !== args.projectId
    ) {
      throw new Error("Versions must belong to the project");
    }

    const leftDoc = assertScriptDocument(
      await loadJson(ctx, left.contentFileId),
    );
    const rightDoc = assertScriptDocument(
      await loadJson(ctx, right.contentFileId),
    );
    const ops = diffScripts(leftDoc, rightDoc);
    return {
      left,
      right,
      ops,
      leftText: scriptToPlainText(leftDoc),
      rightText: scriptToPlainText(rightDoc),
      leftDocument: leftDoc,
      rightDocument: rightDoc,
    };
  },
});

/**
 * Restore an older version by creating a new tip parented to the current tip.
 */
export const restore = action({
  args: {
    projectId: v.id("projects"),
    versionId: v.id("scriptVersions"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    versionId: Id<"scriptVersions">;
    document: ScriptDocument;
    sceneIds: Id<"scenes">[];
    entityIds: Id<"entities">[];
  }> => {
    const userId = await requireActionUser(ctx);
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: args.projectId,
      userId,
    });

    const source: Doc<"scriptVersions"> | null = await ctx.runQuery(
      internal.scriptVersions.getVersionInternal,
      { versionId: args.versionId },
    );
    if (!source || source.projectId !== args.projectId) {
      throw new Error("Version not found");
    }

    const document = assertScriptDocument(
      await loadJson(ctx, source.contentFileId),
    );

    return await commitFromAction(ctx, {
      projectId: args.projectId,
      userId,
      document,
      label: `Restored from ${new Date(source.createdAt).toISOString()}`,
    });
  },
});

/** Used by proposal accept to commit without re-fetching auth. */
export const commitAsInternal = internalAction({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    document: v.any(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await commitFromAction(ctx, {
      projectId: args.projectId,
      userId: args.userId,
      document: args.document,
      label: args.label,
    });
  },
});
