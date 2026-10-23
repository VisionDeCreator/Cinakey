import {
  assertBlockoutDocument,
  emptyPartDocument,
  isBlockoutDocument,
  migrateShotsToPartDocument,
  migrateToV2,
  validateBlockoutDocument,
  type BlockoutDocument,
  type BlockoutDocumentV1,
  type BlockoutProject,
  type MigrateShotMeta,
} from "@cinakey/shared";
import { v } from "convex/values";
import { api, internal } from "../operations";
import type {
  Doc,
  Id,
} from "../../../../packages/backend/convex/_generated/dataModel";
import { action, type ActionCtx } from "../runtime/operation";
import { loadJson } from "../../../../packages/backend/convex/storage";
import { saveJson } from "./storage";

async function requireActionUser(ctx: ActionCtx): Promise<Id<"users">> {
  const { getAuthUserId } = await import("@convex-dev/auth/server");
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  return userId;
}

function projectMeta(project: Doc<"projects">): BlockoutProject {
  return {
    id: project._id,
    title: project.title,
    aspectRatio: project.aspectRatio,
    fps: project.fps,
  };
}

function ensureV2(
  raw: unknown,
  project: BlockoutProject,
  sequenceId?: string,
): BlockoutDocument {
  if (isBlockoutDocument(raw)) return raw;
  const schema = (raw as { schema?: string })?.schema;
  if (schema === "cinakey.blockout/1.0") {
    return migrateToV2(raw, { project, sequenceId });
  }
  const err = validateBlockoutDocument(raw);
  if (err) throw new Error(`Invalid cinakey.blockout document: ${err}`);
  return migrateToV2(raw, { project, sequenceId });
}

async function persistPart(
  ctx: ActionCtx,
  sequenceId: Id<"sequences">,
  incomingRaw: unknown,
): Promise<{ fileId: Id<"_storage">; document: BlockoutDocument }> {
  const userId = await requireActionUser(ctx);
  const { sequence, project } = await ctx.runQuery(
    internal.blockouts.listSequenceShotsInternal,
    { sequenceId },
  );
  if (!sequence || !project) throw new Error("Sequence not found");
  await ctx.runQuery(internal.entities.assertProjectAccess, {
    projectId: project._id,
    userId,
  });

  let version = 1;
  if (sequence.blockoutFileId) {
    try {
      const prev = ensureV2(
        await loadJson(ctx, sequence.blockoutFileId),
        projectMeta(project),
        sequence._id,
      );
      version = prev.version + 1;
    } catch {
      version = 1;
    }
  }

  const incoming = ensureV2(incomingRaw, projectMeta(project), sequence._id);
  const document: BlockoutDocument = {
    ...incoming,
    schema: "cinakey.blockout/2.0",
    version,
    parentFileId: sequence.blockoutFileId,
    project: projectMeta(project),
    sequenceId: sequence._id,
    fps: project.fps,
    aspect: project.aspectRatio,
  };
  assertBlockoutDocument(document);
  const { storageId } = await saveJson(ctx, document);
  await ctx.runMutation(internal.blockouts.applySavedPartBlockout, {
    sequenceId: sequence._id,
    storageId,
  });
  return { fileId: storageId, document };
}

async function assembleFromLegacyShots(
  ctx: ActionCtx,
  sequenceId: Id<"sequences">,
  project: Doc<"projects">,
): Promise<BlockoutDocument> {
  const { sequence, shots, scenes } = await ctx.runQuery(
    internal.blockouts.listSequenceShotsInternal,
    { sequenceId },
  );
  if (!sequence) return emptyPartDocument(projectMeta(project), sequenceId);

  const pairs: Array<{ doc: BlockoutDocumentV1; meta: MigrateShotMeta }> = [];
  const sceneById = new Map(
    (scenes as Doc<"scenes">[]).map((s) => [s._id as string, s]),
  );
  for (const shot of [...(shots as Doc<"shots">[])].sort(
    (a, b) => a.order - b.order,
  )) {
    if (!shot.blockoutFileId) continue;
    try {
      const raw = await loadJson(ctx, shot.blockoutFileId);
      if ((raw as { schema?: string })?.schema !== "cinakey.blockout/1.0")
        continue;
      const startSec = shot.startSec ?? 0;
      const endSec = shot.endSec ?? startSec + shot.durationSec;
      pairs.push({
        doc: raw as BlockoutDocumentV1,
        meta: {
          id: shot._id,
          order: shot.order,
          startSec,
          endSec,
          durationSec: shot.durationSec,
          shotType: shot.shotType,
          notes: shot.notes,
          sceneHeading: sceneById.get(shot.sceneId)?.heading,
          lensMm: shot.lensMm,
          cameraMove: shot.cameraMove,
        },
      });
    } catch {
      /* skip */
    }
  }
  if (pairs.length === 0) {
    return emptyPartDocument(projectMeta(project), sequenceId);
  }
  return migrateShotsToPartDocument(pairs, projectMeta(project), sequenceId);
}

/** Load the part-scoped blockout for a sequence (null if none). */
export const getForSequence = action({
  args: { sequenceId: v.id("sequences") },
  handler: async (
    ctx,
    args,
  ): Promise<{ document: BlockoutDocument; fileId: Id<"_storage"> } | null> => {
    const userId = await requireActionUser(ctx);
    const { sequence, project } = await ctx.runQuery(
      internal.blockouts.listSequenceShotsInternal,
      { sequenceId: args.sequenceId },
    );
    if (!sequence || !project) throw new Error("Sequence not found");
    await ctx.runQuery(internal.entities.assertProjectAccess, {
      projectId: project._id,
      userId,
    });
    if (sequence.blockoutFileId) {
      const document = ensureV2(
        await loadJson(ctx, sequence.blockoutFileId),
        projectMeta(project),
        sequence._id,
      );
      return { document, fileId: sequence.blockoutFileId };
    }
    // Try assemble from legacy per-shot files without writing
    const assembled = await assembleFromLegacyShots(ctx, sequence._id, project);
    if (assembled.camera.keys.length <= 1 && assembled.objects.length === 0) {
      return null;
    }
    return { document: assembled, fileId: "" as Id<"_storage"> };
  },
});

/** Save a part blockout as a new versioned file on the sequence. */
export const saveForSequence = action({
  args: {
    sequenceId: v.id("sequences"),
    document: v.any(),
    /** "director" = saved by Update / Regenerate, not a user edit. */
    origin: v.optional(v.literal("director")),
  },
  handler: async (ctx, args) => {
    const saved = await persistPart(ctx, args.sequenceId, args.document);
    if (args.origin !== "director")
      await scheduleEditFeedback(ctx, args.sequenceId, saved.fileId);
    return saved;
  },
});

/** Import JSON into the sequence part blockout. */
export const importToSequence = action({
  args: { sequenceId: v.id("sequences"), document: v.any() },
  handler: async (ctx, args) => {
    const saved = await persistPart(ctx, args.sequenceId, args.document);
    await scheduleEditFeedback(ctx, args.sequenceId, saved.fileId);
    return saved;
  },
});

/** User edits feed the director's learning signal (diffed in the background). */
async function scheduleEditFeedback(
  ctx: ActionCtx,
  sequenceId: Id<"sequences">,
  fileId: Id<"_storage">,
) {
  await ctx.scheduler.runAfter(0, internal.stagingFeedback.recordEdit, {
    sequenceId,
    fileId,
  });
}

/** Export the part document for a sequence. */
export const exportDocument = action({
  args: {
    projectId: v.id("projects"),
    sequenceId: v.optional(v.id("sequences")),
    sceneId: v.optional(v.id("scenes")),
    shotId: v.optional(v.id("shots")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ document: BlockoutDocument; skippedShotIds: string[] }> => {
    const userId = await requireActionUser(ctx);
    const { project } = await ctx.runQuery(
      internal.entities.assertProjectAccess,
      {
        projectId: args.projectId,
        userId,
      },
    );

    let sequenceId = args.sequenceId;
    if (!sequenceId && args.shotId) {
      const shot = await ctx.runQuery(internal.sequences.getShotInternal, {
        shotId: args.shotId,
      });
      sequenceId = shot?.sequenceId;
    }
    if (!sequenceId) {
      const sequences = await ctx.runQuery(internal.sequences.listInternal, {
        projectId: args.projectId,
      });
      sequenceId = sequences[0]?._id;
    }
    if (!sequenceId) {
      return {
        document: emptyPartDocument(projectMeta(project)),
        skippedShotIds: [],
      };
    }

    const loaded = await ctx.runAction(api.blockouts.getForSequence, {
      sequenceId,
    });
    if (loaded) return { document: loaded.document, skippedShotIds: [] };
    return {
      document: emptyPartDocument(projectMeta(project), sequenceId),
      skippedShotIds: [],
    };
  },
});

/** @deprecated Prefer getForSequence */
export const get = action({
  args: { shotId: v.id("shots") },
  handler: async (
    ctx,
    args,
  ): Promise<{ document: BlockoutDocument; fileId: Id<"_storage"> } | null> => {
    const shot = await ctx.runQuery(internal.sequences.getShotInternal, {
      shotId: args.shotId,
    });
    if (!shot?.sequenceId) return null;
    return await ctx.runAction(api.blockouts.getForSequence, {
      sequenceId: shot.sequenceId,
    });
  },
});

/** @deprecated Prefer saveForSequence */
export const save = action({
  args: { shotId: v.id("shots"), document: v.any() },
  handler: async (
    ctx,
    args,
  ): Promise<{ fileId: Id<"_storage">; document: BlockoutDocument }> => {
    const shot: Doc<"shots"> | null = await ctx.runQuery(
      internal.sequences.getShotInternal,
      { shotId: args.shotId },
    );
    if (!shot?.sequenceId) throw new Error("Shot has no sequence");
    return await persistPart(ctx, shot.sequenceId, args.document);
  },
});

/** @deprecated Prefer importToSequence */
export const importToShot = action({
  args: {
    shotId: v.id("shots"),
    document: v.any(),
    sourceShotId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ fileId: Id<"_storage">; document: BlockoutDocument }> => {
    const shot: Doc<"shots"> | null = await ctx.runQuery(
      internal.sequences.getShotInternal,
      { shotId: args.shotId },
    );
    if (!shot?.sequenceId) throw new Error("Shot has no sequence");
    return await persistPart(ctx, shot.sequenceId, args.document);
  },
});
