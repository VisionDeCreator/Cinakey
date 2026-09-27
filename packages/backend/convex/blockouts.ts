import {
  assertBlockoutDocument,
  extractShotForImport,
  finalizeShot,
  mergeBlockoutDocuments,
  singleShotDocument,
  tracksFromShot,
  type BlockoutDocument,
  type BlockoutProject,
  type BlockoutShot,
} from "@cinakey/shared";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
} from "./_generated/server";
import { requireProjectAccess } from "./lib/access";
import { loadJson, saveJson } from "./storage";

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

type ShotContext = {
  shot: Doc<"shots">;
  scene: Doc<"scenes"> | null;
  project: Doc<"projects">;
};

export const getShotContextInternal = internalQuery({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args): Promise<ShotContext | null> => {
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) return null;
    const project = await ctx.db.get(shot.projectId);
    if (project === null) return null;
    const scene = await ctx.db.get(shot.sceneId);
    return { shot, scene, project };
  },
});

export const listBlockedOutShotsInternal = internalQuery({
  args: {
    projectId: v.id("projects"),
    sceneId: v.optional(v.id("scenes")),
  },
  handler: async (ctx, args) => {
    const shots =
      args.sceneId !== undefined
        ? await ctx.db
            .query("shots")
            .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId!))
            .collect()
        : await ctx.db
            .query("shots")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return {
      shots: shots.filter((s) => s.projectId === args.projectId),
      scenes,
    };
  },
});

export const applySavedBlockout = internalMutation({
  args: {
    shotId: v.id("shots"),
    storageId: v.id("_storage"),
    lensMm: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) throw new Error("Shot not found");
    await ctx.db.patch(args.shotId, {
      blockoutFileId: args.storageId,
      ...(shot.status === "planned" ? { status: "blocked_out" as const } : {}),
      ...(args.lensMm !== undefined ? { lensMm: args.lensMm } : {}),
      updatedAt: Date.now(),
    });
  },
});

async function requireActionUser(ctx: ActionCtx): Promise<Id<"users">> {
  const { getAuthUserId } = await import("@convex-dev/auth/server");
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  return userId;
}

async function loadShotContext(
  ctx: ActionCtx,
  shotId: Id<"shots">,
): Promise<ShotContext> {
  const userId = await requireActionUser(ctx);
  const loaded: ShotContext | null = await ctx.runQuery(
    internal.blockouts.getShotContextInternal,
    { shotId },
  );
  if (loaded === null) throw new Error("Shot not found");
  await ctx.runQuery(internal.entities.assertProjectAccess, {
    projectId: loaded.project._id,
    userId,
  });
  return loaded;
}

function projectMeta(project: Doc<"projects">): BlockoutProject {
  return {
    id: project._id,
    title: project.title,
    aspectRatio: project.aspectRatio,
    fps: project.fps,
  };
}

async function loadStoredDocument(
  ctx: ActionCtx,
  fileId: Id<"_storage">,
): Promise<BlockoutDocument> {
  return assertBlockoutDocument(await loadJson(ctx, fileId));
}

/**
 * Re-bind a shot payload to the live shot record (metadata comes from the
 * database; scene graph and animation come from the payload) and store it as
 * a new blob. Previous blobs stay in storage (parentFileId chain).
 */
async function persistShot(
  ctx: ActionCtx,
  context: ShotContext,
  payload: BlockoutShot,
  lensMm: number,
): Promise<{ fileId: Id<"_storage">; document: BlockoutDocument }> {
  const { shot, scene, project } = context;
  let version = 1;
  if (shot.blockoutFileId) {
    try {
      version = (await loadStoredDocument(ctx, shot.blockoutFileId)).version + 1;
    } catch {
      version = 1;
    }
  }
  const tracks = tracksFromShot(payload);
  const bound = finalizeShot(
    {
      id: shot._id,
      sceneId: shot.sceneId,
      order: shot.order,
      durationSec: shot.durationSec,
      shotType: shot.shotType,
      lensMm,
      ...(shot.cameraMove ? { cameraMove: shot.cameraMove } : {}),
      ...(shot.dialogue ? { dialogue: shot.dialogue } : {}),
      ...(shot.notes ? { notes: shot.notes } : {}),
      characterIds: shot.characterIds,
      ...(shot.keyframeAssetId
        ? { keyframeImage: { assetId: shot.keyframeAssetId } }
        : {}),
      camera: { nodeId: payload.camera.nodeId },
      scene: payload.scene,
      ...(payload.guides ? { guides: payload.guides } : {}),
    },
    tracks,
    project.fps,
  );
  const document = singleShotDocument(
    projectMeta(project),
    {
      id: shot.sceneId,
      order: scene?.order ?? 0,
      ...(scene?.heading ? { heading: scene.heading } : {}),
    },
    bound,
    version,
    shot.blockoutFileId,
  );
  assertBlockoutDocument(document);
  const { storageId } = await saveJson(ctx, document);
  await ctx.runMutation(internal.blockouts.applySavedBlockout, {
    shotId: shot._id,
    storageId,
    lensMm: lensMm !== shot.lensMm ? lensMm : undefined,
  });
  return { fileId: storageId, document };
}

/** Load the current blockout document for a shot (null if none yet). */
export const get = action({
  args: { shotId: v.id("shots") },
  handler: async (
    ctx,
    args,
  ): Promise<{ document: BlockoutDocument; fileId: Id<"_storage"> } | null> => {
    const context = await loadShotContext(ctx, args.shotId);
    const fileId = context.shot.blockoutFileId;
    if (!fileId) return null;
    return { document: await loadStoredDocument(ctx, fileId), fileId };
  },
});

/** Save the editor's shot as a new versioned blockout file. */
export const save = action({
  args: { shotId: v.id("shots"), document: v.any() },
  handler: async (ctx, args) => {
    const context = await loadShotContext(ctx, args.shotId);
    const doc = assertBlockoutDocument(args.document);
    const payload = extractShotForImport(doc, {
      id: context.shot._id,
      sceneId: context.shot.sceneId,
      order: context.shot.order,
    });
    return await persistShot(ctx, context, payload, payload.lensMm);
  },
});

/** Import a shot from any cinakey.blockout document into this shot. */
export const importToShot = action({
  args: {
    shotId: v.id("shots"),
    document: v.any(),
    sourceShotId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const context = await loadShotContext(ctx, args.shotId);
    const doc = assertBlockoutDocument(args.document);
    const payload = extractShotForImport(
      doc,
      {
        id: context.shot._id,
        sceneId: context.shot.sceneId,
        order: context.shot.order,
      },
      args.sourceShotId,
    );
    return await persistShot(ctx, context, payload, payload.lensMm);
  },
});

/**
 * Combine stored shot blockouts into one export document: a single shot,
 * a scene, or the whole project. Shots without a blockout are skipped.
 */
export const exportDocument = action({
  args: {
    projectId: v.id("projects"),
    sceneId: v.optional(v.id("scenes")),
    shotId: v.optional(v.id("shots")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ document: BlockoutDocument; skippedShotIds: string[] }> => {
    const userId = await requireActionUser(ctx);
    const { project } = await ctx.runQuery(internal.entities.assertProjectAccess, {
      projectId: args.projectId,
      userId,
    });
    const { shots, scenes } = await ctx.runQuery(
      internal.blockouts.listBlockedOutShotsInternal,
      { projectId: args.projectId, sceneId: args.sceneId },
    );
    const sceneById = new Map(scenes.map((s) => [s._id, s]));
    const selected = shots
      .filter((s) => args.shotId === undefined || s._id === args.shotId)
      .sort((a, b) => {
        const sa = sceneById.get(a.sceneId)?.order ?? 0;
        const sb = sceneById.get(b.sceneId)?.order ?? 0;
        return sa - sb || a.order - b.order;
      });

    const docs: BlockoutDocument[] = [];
    const skippedShotIds: string[] = [];
    for (const shot of selected) {
      if (!shot.blockoutFileId) {
        skippedShotIds.push(shot._id);
        continue;
      }
      const doc = await loadStoredDocument(ctx, shot.blockoutFileId);
      // Stored order/heading may be stale after reorders; use live values.
      const scene = sceneById.get(shot.sceneId);
      for (const s of doc.scenes) {
        s.order = scene?.order ?? s.order;
        if (scene?.heading) s.heading = scene.heading;
        for (const sh of s.shots) sh.order = shot.order;
      }
      docs.push(doc);
    }
    return {
      document: mergeBlockoutDocuments(docs, projectMeta(project)),
      skippedShotIds,
    };
  },
});
