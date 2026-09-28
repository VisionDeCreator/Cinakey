import {
  assertSheetDocument,
  assembleShotKeyframePrompt,
  normalizeEntityName,
  type SheetDocument,
} from "@cinakey/shared";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { getFileUrl, loadJson } from "./storage";

const shotStatus = v.union(
  v.literal("planned"),
  v.literal("blocked_out"),
  v.literal("generating"),
  v.literal("selected"),
);

type DbCtx = QueryCtx | MutationCtx;

async function withKeyframeUrl(ctx: DbCtx, shot: Doc<"shots">) {
  let keyframeUrl: string | null = null;
  if (shot.keyframeAssetId) {
    const asset = await ctx.db.get(shot.keyframeAssetId);
    if (asset) {
      keyframeUrl = await getFileUrl(ctx, asset.storageId);
    }
  }
  let selectedTakeThumbUrl: string | null = null;
  if (shot.selectedTakeId) {
    const take = await ctx.db.get(shot.selectedTakeId);
    if (take) {
      const assetId = take.proxyAssetId ?? take.assetId;
      const asset = await ctx.db.get(assetId);
      if (asset) {
        selectedTakeThumbUrl = await getFileUrl(ctx, asset.storageId);
      }
    }
  }
  return { ...shot, keyframeUrl, selectedTakeThumbUrl };
}

async function reindexScene(ctx: MutationCtx, sceneId: Id<"scenes">) {
  const shots = await ctx.db
    .query("shots")
    .withIndex("by_scene_order", (q) => q.eq("sceneId", sceneId))
    .collect();
  shots.sort((a, b) => a.order - b.order);
  const now = Date.now();
  for (let i = 0; i < shots.length; i++) {
    if (shots[i]!.order !== i) {
      await ctx.db.patch(shots[i]!._id, { order: i, updatedAt: now });
    }
  }
}

async function requireActionUser(ctx: ActionCtx) {
  const { getAuthUserId } = await import("@convex-dev/auth/server");
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  return userId as Id<"users">;
}

async function loadSheetDoc(
  ctx: ActionCtx,
  sheetFileId: Id<"_storage"> | undefined,
): Promise<SheetDocument | null> {
  if (!sheetFileId) return null;
  try {
    return assertSheetDocument(await loadJson(ctx, sheetFileId));
  } catch {
    return null;
  }
}

export const listByScene = query({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const scene = await ctx.db.get(args.sceneId);
    if (scene === null) return [];
    await requireProjectAccess(ctx, scene.projectId);
    const shots = await ctx.db
      .query("shots")
      .withIndex("by_scene_order", (q) => q.eq("sceneId", args.sceneId))
      .collect();
    shots.sort((a, b) => a.order - b.order);
    return await Promise.all(shots.map((s) => withKeyframeUrl(ctx, s)));
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const shots = await ctx.db
      .query("shots")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return shots.sort((a, b) => a.order - b.order);
  },
});

export const get = query({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) return null;
    await requireProjectAccess(ctx, shot.projectId);
    return await withKeyframeUrl(ctx, shot);
  },
});

export const getInternal = internalQuery({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.shotId);
  },
});

export const listEntitiesInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("entities")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const listJobsForShot = query({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) return [];
    await requireProjectAccess(ctx, shot.projectId);
    const jobs = await ctx.db
      .query("generationJobs")
      .withIndex("by_shot", (q) => q.eq("shotId", args.shotId))
      .collect();
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getSceneRuntime = query({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const scene = await ctx.db.get(args.sceneId);
    if (scene === null) {
      return {
        shotTotalSec: 0,
        elementId: null as string | null,
      };
    }
    await requireProjectAccess(ctx, scene.projectId);
    const shots = await ctx.db
      .query("shots")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();
    const shotTotalSec = shots.reduce((sum, s) => sum + s.durationSec, 0);
    return {
      shotTotalSec,
      elementId: scene.elementId,
    };
  },
});

export const getKeyframePromptContext = action({
  args: { shotId: v.id("shots") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    shot: Doc<"shots">;
    projectRules: string[];
    styleSheet: SheetDocument | null;
    characters: Array<{
      name: string;
      description?: string;
      sheet: SheetDocument | null;
      lockedReferenceAssetIds: Id<"assets">[];
    }>;
    location: {
      name: string;
      description?: string;
      sheet: SheetDocument | null;
      lockedReferenceAssetIds: Id<"assets">[];
    } | null;
    referenceAssetIds: Id<"assets">[];
    assembledPrompt: string;
  } | null> => {
    const userId = await requireActionUser(ctx);
    const shot: Doc<"shots"> | null = await ctx.runQuery(
      internal.shots.getInternal,
      { shotId: args.shotId },
    );
    if (shot === null) return null;
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: shot.projectId,
      userId,
    });

    const project: Doc<"projects"> = await ctx.runQuery(
      internal.generation.getProjectWorkspace,
      { projectId: shot.projectId },
    );

    const entities: Doc<"entities">[] = await ctx.runQuery(
      internal.shots.listEntitiesInternal,
      { projectId: shot.projectId },
    );
    const styleEntity = entities.find((e) => e.kind === "style") ?? null;
    const characterDocs = entities.filter(
      (e) => e.kind === "character" && shot.characterIds.includes(e._id),
    );
    const locationDoc = shot.locationId
      ? (entities.find((e) => e._id === shot.locationId) ?? null)
      : null;

    const styleSheet = await loadSheetDoc(ctx, styleEntity?.sheetFileId);
    const characters = await Promise.all(
      characterDocs.map(async (c) => ({
        name: c.name,
        description: c.description,
        sheet: await loadSheetDoc(ctx, c.sheetFileId),
        lockedReferenceAssetIds: c.lockedReferenceAssetIds,
      })),
    );
    const location = locationDoc
      ? {
          name: locationDoc.name,
          description: locationDoc.description,
          sheet: await loadSheetDoc(ctx, locationDoc.sheetFileId),
          lockedReferenceAssetIds: locationDoc.lockedReferenceAssetIds,
        }
      : null;

    const referenceAssetIds: Id<"assets">[] = [];
    for (const c of characters) {
      referenceAssetIds.push(...c.lockedReferenceAssetIds);
    }
    if (location) {
      referenceAssetIds.push(...location.lockedReferenceAssetIds);
    }
    if (styleEntity) {
      referenceAssetIds.push(...styleEntity.lockedReferenceAssetIds);
    }

    const assembledPrompt = assembleShotKeyframePrompt({
      shot: {
        shotType: shot.shotType,
        lensMm: shot.lensMm,
        cameraMove: shot.cameraMove,
        durationSec: shot.durationSec,
        dialogue: shot.dialogue,
        notes: shot.notes,
      },
      styleSheet,
      characters,
      location,
      rules: project.rules,
    });

    return {
      shot,
      projectRules: project.rules,
      styleSheet,
      characters,
      location,
      referenceAssetIds: [...new Set(referenceAssetIds)],
      assembledPrompt,
    };
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    sceneId: v.id("scenes"),
    shotType: v.string(),
    lensMm: v.optional(v.number()),
    cameraMove: v.optional(v.string()),
    durationSec: v.number(),
    characterIds: v.optional(v.array(v.id("entities"))),
    locationId: v.optional(v.id("entities")),
    dialogueLineId: v.optional(v.string()),
    dialogue: v.optional(v.string()),
    status: v.optional(shotStatus),
    notes: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    await requireProjectAccess(ctx, args.projectId);
    const scene = await ctx.db.get(args.sceneId);
    if (scene === null || scene.projectId !== args.projectId) {
      throw new Error("Scene not found");
    }
    const existing = await ctx.db
      .query("shots")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();
    const order =
      args.order ??
      (existing.length === 0
        ? 0
        : Math.max(...existing.map((s) => s.order)) + 1);
    const now = Date.now();
    return await ctx.db.insert("shots", {
      projectId: args.projectId,
      sceneId: args.sceneId,
      order,
      shotType: args.shotType.trim() || "medium",
      lensMm: args.lensMm,
      cameraMove: args.cameraMove,
      durationSec: Math.max(0.5, args.durationSec),
      characterIds: args.characterIds ?? [],
      locationId: args.locationId,
      dialogueLineId: args.dialogueLineId,
      dialogue: args.dialogue,
      status: args.status ?? "planned",
      outdated: false,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    shotId: v.id("shots"),
    shotType: v.optional(v.string()),
    lensMm: v.optional(v.union(v.number(), v.null())),
    cameraMove: v.optional(v.union(v.string(), v.null())),
    durationSec: v.optional(v.number()),
    startSec: v.optional(v.number()),
    endSec: v.optional(v.number()),
    characterIds: v.optional(v.array(v.id("entities"))),
    locationId: v.optional(v.union(v.id("entities"), v.null())),
    dialogueLineId: v.optional(v.union(v.string(), v.null())),
    dialogue: v.optional(v.union(v.string(), v.null())),
    status: v.optional(shotStatus),
    notes: v.optional(v.union(v.string(), v.null())),
    outdated: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) throw new Error("Shot not found");
    await requireProjectAccess(ctx, shot.projectId);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.shotType !== undefined) patch.shotType = args.shotType.trim();
    if (args.lensMm !== undefined) {
      patch.lensMm = args.lensMm === null ? undefined : args.lensMm;
    }
    if (args.cameraMove !== undefined) {
      patch.cameraMove =
        args.cameraMove === null ? undefined : args.cameraMove;
    }
    if (args.durationSec !== undefined) {
      patch.durationSec = Math.max(0.5, args.durationSec);
    }
    if (args.startSec !== undefined) patch.startSec = args.startSec;
    if (args.endSec !== undefined) patch.endSec = args.endSec;
    if (args.characterIds !== undefined) patch.characterIds = args.characterIds;
    if (args.locationId !== undefined) {
      patch.locationId =
        args.locationId === null ? undefined : args.locationId;
    }
    if (args.dialogueLineId !== undefined) {
      patch.dialogueLineId =
        args.dialogueLineId === null ? undefined : args.dialogueLineId;
      if (args.dialogueLineId === null) {
        patch.outdated = false;
      }
    }
    if (args.dialogue !== undefined) {
      patch.dialogue = args.dialogue === null ? undefined : args.dialogue;
    }
    if (args.status !== undefined) patch.status = args.status;
    if (args.notes !== undefined) {
      patch.notes = args.notes === null ? undefined : args.notes;
    }
    if (args.outdated !== undefined) patch.outdated = args.outdated;

    if (
      args.dialogueLineId !== undefined &&
      args.dialogueLineId !== null &&
      args.dialogue !== undefined
    ) {
      patch.outdated = false;
    }

    await ctx.db.patch(args.shotId, patch);

    const affectsScript =
      args.shotType !== undefined ||
      args.cameraMove !== undefined ||
      args.durationSec !== undefined ||
      args.startSec !== undefined ||
      args.endSec !== undefined ||
      args.notes !== undefined;
    if (affectsScript && shot.sequenceId) {
      await ctx.scheduler.runAfter(0, internal.sequences.syncScriptShotsJob, {
        sequenceId: shot.sequenceId,
      });
    }
  },
});

export const remove = mutation({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) throw new Error("Shot not found");
    await requireProjectAccess(ctx, shot.projectId);
    const sceneId = shot.sceneId;
    await ctx.db.delete(args.shotId);
    await reindexScene(ctx, sceneId);
  },
});

export const reorder = mutation({
  args: {
    sceneId: v.id("scenes"),
    orderedShotIds: v.array(v.id("shots")),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const scene = await ctx.db.get(args.sceneId);
    if (scene === null) throw new Error("Scene not found");
    await requireProjectAccess(ctx, scene.projectId);
    const now = Date.now();
    for (let i = 0; i < args.orderedShotIds.length; i++) {
      const shot = await ctx.db.get(args.orderedShotIds[i]!);
      if (shot === null || shot.sceneId !== args.sceneId) {
        throw new Error("Invalid shot in reorder list");
      }
      await ctx.db.patch(args.orderedShotIds[i]!, {
        order: i,
        updatedAt: now,
      });
    }
  },
});

export const split = mutation({
  args: {
    shotId: v.id("shots"),
    firstFraction: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) throw new Error("Shot not found");
    await requireProjectAccess(ctx, shot.projectId);

    const frac = Math.min(0.9, Math.max(0.1, args.firstFraction ?? 0.5));
    const firstDur = Math.max(
      0.5,
      Math.round(shot.durationSec * frac * 10) / 10,
    );
    const secondDur = Math.max(
      0.5,
      Math.round((shot.durationSec - firstDur) * 10) / 10,
    );

    const siblings = await ctx.db
      .query("shots")
      .withIndex("by_scene", (q) => q.eq("sceneId", shot.sceneId))
      .collect();
    const now = Date.now();

    for (const s of siblings) {
      if (s.order > shot.order) {
        await ctx.db.patch(s._id, { order: s.order + 1, updatedAt: now });
      }
    }

    await ctx.db.patch(args.shotId, {
      durationSec: firstDur,
      updatedAt: now,
    });

    return await ctx.db.insert("shots", {
      projectId: shot.projectId,
      sceneId: shot.sceneId,
      order: shot.order + 1,
      shotType: shot.shotType,
      lensMm: shot.lensMm,
      cameraMove: shot.cameraMove,
      durationSec: secondDur,
      characterIds: [...shot.characterIds],
      locationId: shot.locationId,
      dialogueLineId: shot.dialogueLineId,
      dialogue: shot.dialogue,
      status: "planned",
      outdated: shot.outdated,
      notes: shot.notes,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const merge = mutation({
  args: {
    firstShotId: v.id("shots"),
    secondShotId: v.id("shots"),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const first = await ctx.db.get(args.firstShotId);
    const second = await ctx.db.get(args.secondShotId);
    if (first === null || second === null) throw new Error("Shot not found");
    if (first.sceneId !== second.sceneId) {
      throw new Error("Shots must be in the same scene");
    }
    await requireProjectAccess(ctx, first.projectId);

    const a = first.order <= second.order ? first : second;
    const b = first.order <= second.order ? second : first;

    const characterIds = [...new Set([...a.characterIds, ...b.characterIds])];
    const notes =
      [a.notes, b.notes].filter(Boolean).join("\n").trim() || undefined;
    const now = Date.now();

    await ctx.db.patch(a._id, {
      durationSec: a.durationSec + b.durationSec,
      characterIds,
      notes,
      keyframeAssetId: a.keyframeAssetId ?? b.keyframeAssetId,
      updatedAt: now,
    });
    await ctx.db.delete(b._id);
    await reindexScene(ctx, a.sceneId);
    return a._id;
  },
});

export const setKeyframe = mutation({
  args: {
    shotId: v.id("shots"),
    keyframeAssetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) throw new Error("Shot not found");
    await requireProjectAccess(ctx, shot.projectId);
    const asset = await ctx.db.get(args.keyframeAssetId);
    if (asset === null || asset.projectId !== shot.projectId) {
      throw new Error("Asset not found");
    }
    await ctx.db.patch(args.shotId, {
      keyframeAssetId: args.keyframeAssetId,
      updatedAt: Date.now(),
    });
    if (asset.shotId !== args.shotId) {
      await ctx.db.patch(args.keyframeAssetId, {
        shotId: args.shotId,
        sceneId: shot.sceneId,
        updatedAt: Date.now(),
      });
    }
  },
});

export const clearKeyframe = mutation({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) throw new Error("Shot not found");
    await requireProjectAccess(ctx, shot.projectId);
    await ctx.db.patch(args.shotId, {
      keyframeAssetId: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const replaceSceneShots = mutation({
  args: {
    projectId: v.id("projects"),
    sceneId: v.id("scenes"),
    shots: v.array(
      v.object({
        shotType: v.string(),
        lensMm: v.optional(v.number()),
        cameraMove: v.optional(v.string()),
        durationSec: v.number(),
        characterIds: v.array(v.id("entities")),
        locationId: v.optional(v.id("entities")),
        dialogueLineId: v.optional(v.string()),
        dialogue: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    await requireProjectAccess(ctx, args.projectId);
    const scene = await ctx.db.get(args.sceneId);
    if (scene === null || scene.projectId !== args.projectId) {
      throw new Error("Scene not found");
    }
    const existing = await ctx.db
      .query("shots")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();
    for (const s of existing) {
      await ctx.db.delete(s._id);
    }
    const now = Date.now();
    const ids: Id<"shots">[] = [];
    for (let i = 0; i < args.shots.length; i++) {
      const def = args.shots[i]!;
      const id = await ctx.db.insert("shots", {
        projectId: args.projectId,
        sceneId: args.sceneId,
        order: i,
        shotType: def.shotType.trim() || "medium",
        lensMm: def.lensMm,
        cameraMove: def.cameraMove,
        durationSec: Math.max(0.5, def.durationSec),
        characterIds: def.characterIds,
        locationId: def.locationId,
        dialogueLineId: def.dialogueLineId,
        dialogue: def.dialogue,
        status: "planned",
        outdated: false,
        notes: def.notes,
        createdAt: now,
        updatedAt: now,
      });
      ids.push(id);
    }
    return ids;
  },
});

export const resolveEntityNames = query({
  args: {
    projectId: v.id("projects"),
    characterNames: v.array(v.string()),
    locationName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const characterIds: Id<"entities">[] = [];
    for (const name of args.characterNames) {
      const key = normalizeEntityName(name);
      const found = entities.find(
        (e) =>
          e.kind === "character" && normalizeEntityName(e.name) === key,
      );
      if (found) characterIds.push(found._id);
    }
    let locationId: Id<"entities"> | undefined;
    if (args.locationName) {
      const key = normalizeEntityName(args.locationName);
      const found = entities.find(
        (e) =>
          e.kind === "location" && normalizeEntityName(e.name) === key,
      );
      if (found) locationId = found._id;
    }
    return { characterIds, locationId };
  },
});
