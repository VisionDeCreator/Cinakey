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
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { materializeScriptWithPrevious } from "./lib/scriptMaterialize";
import { insertVersion } from "./lib/versioning";
import { loadJson, saveJson } from "./storage";

async function requireActionUser(ctx: ActionCtx) {
  const { getAuthUserId } = await import("@convex-dev/auth/server");
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not authenticated");
  }
  return userId as Id<"users">;
}

export const createVersion = mutation({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("scriptVersions")),
    format: v.union(v.literal("screenplay"), v.literal("av")),
    label: v.optional(v.string()),
    contentFileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await requireProjectAccess(ctx, args.projectId);

    if (args.parentId !== undefined) {
      const parent = await ctx.db.get(args.parentId);
      if (parent === null || parent.projectId !== args.projectId) {
        throw new Error("Invalid parent script version");
      }
    }

    return await insertVersion(ctx, "scriptVersions", {
      projectId: args.projectId,
      parentId: args.parentId,
      format: args.format,
      label: args.label,
      contentFileId: args.contentFileId,
      createdBy: user._id,
      createdAt: Date.now(),
    });
  },
});

export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const versions = await ctx.db
      .query("scriptVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return versions.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getTip = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const versions = await ctx.db
      .query("scriptVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    if (versions.length === 0) return null;
    return versions.sort((a, b) => b.createdAt - a.createdAt)[0]!;
  },
});

export const getVersion = query({
  args: { versionId: v.id("scriptVersions") },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (version === null) return null;
    await requireProjectAccess(ctx, version.projectId);
    return version;
  },
});

export const assertAccess = internalQuery({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (project === null) throw new Error("Project not found");
    const user = await ctx.db.get(args.userId);
    if (user === null) throw new Error("User not found");
    if (user.isStaff === true) return true;
    if (user.personalWorkspaceId !== project.workspaceId) {
      throw new Error("Forbidden");
    }
    return true;
  },
});

export const getTipInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const versions = await ctx.db
      .query("scriptVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    if (versions.length === 0) return null;
    return versions.sort((a, b) => b.createdAt - a.createdAt)[0]!;
  },
});

export const getVersionInternal = internalQuery({
  args: { versionId: v.id("scriptVersions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.versionId);
  },
});

/** Internal: insert version + materialize scenes/entities. */
export const commitDocument = internalMutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    contentFileId: v.id("_storage"),
    format: v.union(v.literal("screenplay"), v.literal("av")),
    label: v.optional(v.string()),
    parentId: v.optional(v.id("scriptVersions")),
    document: v.any(),
    previousDocument: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (project === null) throw new Error("Project not found");

    const document = assertScriptDocument(args.document);
    const previous =
      args.previousDocument !== undefined
        ? assertScriptDocument(args.previousDocument)
        : null;

    const versionId = await insertVersion(ctx, "scriptVersions", {
      projectId: args.projectId,
      parentId: args.parentId,
      format: args.format,
      label: args.label,
      contentFileId: args.contentFileId,
      createdBy: args.userId,
      createdAt: Date.now(),
    });

    const result = await materializeScriptWithPrevious(ctx, {
      projectId: args.projectId,
      document,
      previousDocument: previous,
    });

    await ctx.db.patch(args.projectId, { updatedAt: Date.now() });

    return {
      versionId,
      document: result.document,
      sceneIds: result.sceneIds,
      entityIds: result.entityIds,
    };
  },
});

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
