/**
 * Sequences (Seedance generation units) + materializing script / blockout sheets.
 */

import {
  blockoutSheetSchema,
  blockoutSheetToDocuments,
  parseScriptPromptText,
  scriptPromptSchema,
  scriptShotFingerprint,
  type BlockoutSheetData,
  type ScriptPromptData,
} from "@cinakey/shared";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { requireProjectAccess } from "./lib/access";
import { markBlockoutStaleForScriptPrompt } from "./lib/promptSheetDeps";
import { loadJson } from "./storage";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    return await ctx.db
      .query("sequences")
      .withIndex("by_project_order", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const getInternal = internalQuery({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => ctx.db.get(args.sequenceId),
});

export const upsertFromScriptPrompt = internalMutation({
  args: {
    projectId: v.id("projects"),
    scriptPromptId: v.optional(v.id("promptSheets")),
    title: v.string(),
    durationSec: v.number(),
    order: v.number(),
    existingSequenceId: v.optional(v.id("sequences")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.existingSequenceId) {
      await ctx.db.patch(args.existingSequenceId, {
        title: args.title,
        durationSec: args.durationSec,
        ...(args.scriptPromptId
          ? { scriptPromptId: args.scriptPromptId }
          : {}),
        updatedAt: now,
      });
      return args.existingSequenceId;
    }
    return await ctx.db.insert("sequences", {
      projectId: args.projectId,
      order: args.order,
      title: args.title,
      durationSec: args.durationSec,
      scriptPromptId: args.scriptPromptId,
      shotIds: [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const setShotIds = internalMutation({
  args: {
    sequenceId: v.id("sequences"),
    shotIds: v.array(v.id("shots")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sequenceId, {
      shotIds: args.shotIds,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Accept a script prompt: create/update sequence, scene, and shots from
 * structured SHOTS data.
 */
export const applyScriptPrompt = action({
  args: {
    projectId: v.id("projects"),
    promptSheetId: v.id("promptSheets"),
    title: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    sequenceId: Id<"sequences">;
    sceneId: Id<"scenes">;
    shotIds: Id<"shots">[];
    shotCount: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: args.projectId,
      userId,
    });

    const sheet: Doc<"promptSheets"> | null = await ctx.runQuery(
      internal.promptSheets.getInternal,
      { promptSheetId: args.promptSheetId },
    );
    if (sheet === null || sheet.type !== "script") {
      throw new Error("Script prompt sheet not found");
    }

    let structured: ScriptPromptData;
    if (sheet.renderedText?.trim()) {
      structured = parseScriptPromptText(sheet.renderedText);
    } else if (sheet.renderedFileId) {
      const text = String(await loadJson(ctx, sheet.renderedFileId));
      structured = parseScriptPromptText(text);
    } else {
      structured = scriptPromptSchema.parse(
        await loadJson(ctx, sheet.structuredFileId),
      ) as ScriptPromptData;
    }

    const title =
      args.title ??
      `Sequence ${(structured.shots[0]?.n ?? 1)}–${structured.shots[structured.shots.length - 1]?.n ?? 1}`;

    const sequenceId: Id<"sequences"> = await ctx.runMutation(
      internal.sequences.upsertFromScriptPrompt,
      {
        projectId: args.projectId,
        scriptPromptId: sheet._id,
        title,
        durationSec: structured.totalDurationSec,
        order: 0,
        existingSequenceId: sheet.sequenceId,
      },
    );

    const sceneElementId = `seq-${sequenceId}`;
    const sceneId: Id<"scenes"> = await ctx.runMutation(
      internal.sequences.ensureScene,
      {
        projectId: args.projectId,
        elementId: sceneElementId,
        heading: title.toUpperCase(),
        synopsis: `From script prompt v${sheet.version}`,
      },
    );

    const entityByImage = new Map(
      (sheet.referenceMap ?? []).map(
        (r: { imageN: number; entityId: Id<"entities"> }) => [
          r.imageN,
          r.entityId,
        ],
      ),
    );
    const locationRef = structured.location;
    const locationId = entityByImage.get(locationRef.imageN);

    const characterIdsFromCast = structured.castBlocks
      .map((c) => entityByImage.get(c.imageN))
      .filter((id): id is Id<"entities"> => id !== undefined);

    const shotIds: Id<"shots">[] = await ctx.runMutation(
      internal.sequences.replaceSequenceShots,
      {
        projectId: args.projectId,
        sceneId,
        sequenceId,
        shots: structured.shots.map((s) => ({
          n: s.n,
          shotType: s.shotType,
          cameraMove: s.cameraMove,
          startSec: s.startSec,
          endSec: s.endSec,
          durationSec: s.endSec - s.startSec,
          notes: s.action,
          scriptLineKey: scriptShotFingerprint({
            n: s.n,
            startSec: s.startSec,
            endSec: s.endSec,
            shotType: s.shotType,
            cameraMove: s.cameraMove,
            action: s.action,
          }),
          characterIds: characterIdsFromCast,
          locationId,
        })),
      },
    );

    await ctx.runMutation(internal.sequences.setShotIds, {
      sequenceId,
      shotIds,
    });

    await ctx.runMutation(internal.promptSheets.patchStatus, {
      promptSheetId: sheet._id,
      status: "approved",
    });

    await ctx.runMutation(internal.sequences.linkSequenceOnSheet, {
      promptSheetId: sheet._id,
      sequenceId,
    });

    await ctx.runMutation(internal.promptSheets.markScriptDependentsStale, {
      promptSheetId: sheet._id,
    });

    return { sequenceId, sceneId, shotIds, shotCount: shotIds.length };
  },
});

export const linkSequenceOnSheet = internalMutation({
  args: {
    promptSheetId: v.id("promptSheets"),
    sequenceId: v.id("sequences"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.promptSheetId, {
      sequenceId: args.sequenceId,
      updatedAt: Date.now(),
    });
  },
});

export const ensureScene = internalMutation({
  args: {
    projectId: v.id("projects"),
    elementId: v.string(),
    heading: v.string(),
    synopsis: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("scenes")
      .withIndex("by_project_element", (q) =>
        q.eq("projectId", args.projectId).eq("elementId", args.elementId),
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        heading: args.heading,
        synopsis: args.synopsis,
        updatedAt: now,
      });
      return existing._id;
    }
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const order = scenes.length;
    return await ctx.db.insert("scenes", {
      projectId: args.projectId,
      elementId: args.elementId,
      order,
      heading: args.heading,
      synopsis: args.synopsis,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const replaceSequenceShots = internalMutation({
  args: {
    projectId: v.id("projects"),
    sceneId: v.id("scenes"),
    sequenceId: v.id("sequences"),
    shots: v.array(
      v.object({
        n: v.number(),
        shotType: v.string(),
        cameraMove: v.optional(v.string()),
        startSec: v.number(),
        endSec: v.number(),
        durationSec: v.number(),
        notes: v.optional(v.string()),
        scriptLineKey: v.optional(v.string()),
        characterIds: v.array(v.id("entities")),
        locationId: v.optional(v.id("entities")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = (
      await ctx.db
        .query("shots")
        .withIndex("by_sequence", (q) => q.eq("sequenceId", args.sequenceId))
        .collect()
    ).sort((a, b) => a.order - b.order);

    const now = Date.now();
    const ids: Id<"shots">[] = [];
    const used = new Set<Id<"shots">>();

    for (const [i, shot] of args.shots.entries()) {
      const lineKey =
        shot.scriptLineKey ??
        [
          shot.n,
          shot.startSec,
          shot.endSec,
          shot.shotType.trim(),
          (shot.cameraMove ?? "").trim(),
          (shot.notes ?? "").trim(),
        ].join("|");
      const prev = existing[i];
      if (prev) {
        used.add(prev._id);
        await ctx.db.patch(prev._id, {
          sceneId: args.sceneId,
          order: i,
          shotType: shot.shotType,
          cameraMove: shot.cameraMove,
          durationSec: shot.durationSec,
          startSec: shot.startSec,
          endSec: shot.endSec,
          characterIds: shot.characterIds,
          locationId: shot.locationId,
          notes: shot.notes,
          scriptLineKey: lineKey,
          outdated: false,
          updatedAt: now,
        });
        ids.push(prev._id);
      } else {
        const id = await ctx.db.insert("shots", {
          projectId: args.projectId,
          sceneId: args.sceneId,
          sequenceId: args.sequenceId,
          order: i,
          shotType: shot.shotType,
          cameraMove: shot.cameraMove,
          durationSec: shot.durationSec,
          startSec: shot.startSec,
          endSec: shot.endSec,
          characterIds: shot.characterIds,
          locationId: shot.locationId,
          status: "planned",
          outdated: false,
          notes: shot.notes,
          scriptLineKey: lineKey,
          createdAt: now,
          updatedAt: now,
        });
        ids.push(id);
      }
    }

    for (const s of existing) {
      if (!used.has(s._id)) {
        await ctx.db.delete(s._id);
      }
    }

    return ids;
  },
});

/**
 * Accept a blockout sheet: build per-shot cinakey.blockout documents.
 */
export const applyBlockoutSheet = action({
  args: {
    projectId: v.id("projects"),
    promptSheetId: v.id("promptSheets"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: args.projectId,
      userId,
    });

    const sheet = await ctx.runQuery(internal.promptSheets.getInternal, {
      promptSheetId: args.promptSheetId,
    });
    if (sheet === null || sheet.type !== "blockout") {
      throw new Error("Blockout sheet not found");
    }

    const structured = blockoutSheetSchema.parse(
      await loadJson(ctx, sheet.structuredFileId),
    ) as BlockoutSheetData;

    const project = await ctx.runQuery(internal.generation.getProjectWorkspace, {
      projectId: args.projectId,
    });

    const sequenceId = sheet.sequenceId;
    if (!sequenceId) throw new Error("Blockout sheet has no sequence");

    const sequence = await ctx.runQuery(internal.sequences.getInternal, {
      sequenceId,
    });
    if (sequence === null) throw new Error("Sequence not found");

    const liveShots = [];
    for (const shotId of sequence.shotIds) {
      const shot = await ctx.runQuery(internal.sequences.getShotInternal, {
        shotId,
      });
      if (shot) {
        liveShots.push({
          id: shot._id,
          sceneId: shot.sceneId,
          order: shot.order,
          durationSec: shot.durationSec,
          shotType: shot.shotType,
          lensMm: shot.lensMm,
          cameraMove: shot.cameraMove,
          notes: shot.notes,
          characterIds: shot.characterIds as string[],
          n: shot.order + 1,
        });
      }
    }

    // Prefer shot numbers from structured data
    for (const bs of structured.shots) {
      const match = liveShots.find((s) => s.n === bs.n || s.order === bs.n - 1);
      if (match) {
        bs.liveShotId = match.id;
        match.n = bs.n;
      }
    }

    const docs = blockoutSheetToDocuments(
      structured,
      {
        id: args.projectId,
        title: project.title,
        aspectRatio: project.aspectRatio,
        fps: project.fps,
      },
      liveShots,
    );

    const saved: string[] = [];
    let keptCount = 0;
    for (const [shotId, document] of docs) {
      const shotDoc = await ctx.runQuery(internal.sequences.getShotInternal, {
        shotId: shotId as Id<"shots">,
      });
      const lineKey = shotDoc?.scriptLineKey;
      const canKeep =
        Boolean(shotDoc?.blockoutFileId) &&
        Boolean(lineKey) &&
        shotDoc?.blockoutScriptLineKey === lineKey;
      if (canKeep) {
        keptCount += 1;
        continue;
      }
      await ctx.runAction(api.blockouts.save, {
        shotId: shotId as Id<"shots">,
        document,
      });
      if (lineKey) {
        await ctx.runMutation(internal.sequences.markShotBlockoutSynced, {
          shotId: shotId as Id<"shots">,
          blockoutScriptLineKey: lineKey,
        });
      }
      saved.push(shotId);
    }

    await ctx.runMutation(internal.promptSheets.patchStatus, {
      promptSheetId: sheet._id,
      status: "done",
    });

    return {
      savedShotIds: saved,
      count: saved.length,
      rebuiltCount: saved.length,
      keptCount,
    };
  },
});

export const markShotBlockoutSynced = internalMutation({
  args: {
    shotId: v.id("shots"),
    blockoutScriptLineKey: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.shotId, {
      blockoutScriptLineKey: args.blockoutScriptLineKey,
      updatedAt: Date.now(),
    });
  },
});

export const setPrevizAssetId = internalMutation({
  args: {
    sequenceId: v.id("sequences"),
    previzAssetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sequenceId, {
      previzAssetId: args.previzAssetId,
      updatedAt: Date.now(),
    });
  },
});

export const setPrevizAsset = action({
  args: {
    sequenceId: v.id("sequences"),
    previzAssetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const seq = await ctx.runQuery(internal.sequences.getInternal, {
      sequenceId: args.sequenceId,
    });
    if (!seq) throw new Error("Sequence not found");
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: seq.projectId,
      userId,
    });
    await ctx.runMutation(internal.sequences.setPrevizAssetId, {
      sequenceId: args.sequenceId,
      previzAssetId: args.previzAssetId,
    });
  },
});

export const getShotInternal = internalQuery({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args) => ctx.db.get(args.shotId),
});

/** Re-render script SHOTS when a live shot is edited (non-custom sheets). */
export const syncScriptShotsFromList = action({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const sequence = await ctx.runQuery(internal.sequences.getInternal, {
      sequenceId: args.sequenceId,
    });
    if (sequence === null || !sequence.scriptPromptId) return { updated: false };

    const sheet = await ctx.runQuery(internal.promptSheets.getInternal, {
      promptSheetId: sequence.scriptPromptId,
    });
    if (sheet === null || sheet.isCustom || !sheet.isTip) {
      return { updated: false };
    }

    const structured = scriptPromptSchema.parse(
      await loadJson(ctx, sheet.structuredFileId),
    ) as ScriptPromptData;

    const liveShots = [];
    for (const shotId of sequence.shotIds) {
      const shot = await ctx.runQuery(internal.sequences.getShotInternal, {
        shotId,
      });
      if (shot) liveShots.push(shot);
    }
    liveShots.sort((a, b) => a.order - b.order);

    structured.shots = liveShots.map((s, i) => ({
      n: i + 1,
      startSec: s.startSec ?? structured.shots[i]?.startSec ?? 0,
      endSec:
        s.endSec ??
        structured.shots[i]?.endSec ??
        (s.startSec ?? 0) + s.durationSec,
      shotType: s.shotType,
      cameraMove: s.cameraMove,
      action: s.notes ?? structured.shots[i]?.action ?? "",
    }));

    await ctx.runAction(api.promptSheets.createOrUpdateDraft, {
      projectId: sequence.projectId,
      type: "script",
      structured,
      sequenceId: sequence._id,
      referenceMap: sheet.referenceMap,
      sourceAssetSheetIds: sheet.sourceAssetSheetIds,
      replaceTipId: sheet._id,
    });

    await ctx.runMutation(internal.sequences.markBlockoutStale, {
      sequenceId: sequence._id,
    });

    return { updated: true };
  },
});

export const syncScriptShotsJob = internalAction({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => {
    await ctx.runAction(api.sequences.syncScriptShotsFromList, {
      sequenceId: args.sequenceId,
    });
  },
});

export const writeBackBlockoutFromShot = action({
  args: {
    shotId: v.id("shots"),
    document: v.any(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const shot = await ctx.runQuery(internal.sequences.getShotInternal, {
      shotId: args.shotId,
    });
    if (!shot?.sequenceId) return { updated: false };

    const tips: Doc<"promptSheets">[] = await ctx.runQuery(
      internal.promptSheets.listTipsInternal,
      { projectId: shot.projectId, type: "blockout" },
    );
    const sheet = tips.find(
      (t: Doc<"promptSheets">) =>
        t.sequenceId === shot.sequenceId && t.isTip && !t.isCustom,
    );
    if (!sheet) return { updated: false };

    const { blockoutDocumentToSheetShotPatch, blockoutSheetSchema } =
      await import("@cinakey/shared");
    const structured = blockoutSheetSchema.parse(
      await loadJson(ctx, sheet.structuredFileId),
    );
    const patch = blockoutDocumentToSheetShotPatch(
      args.document as never,
      (shot.order ?? 0) + 1,
    );
    if (!patch) return { updated: false };
    structured.shots = structured.shots.map((s) =>
      s.n === patch.n ? { ...s, ...patch } : s,
    );
    await ctx.runAction(api.promptSheets.createOrUpdateDraft, {
      projectId: shot.projectId,
      type: "blockout",
      structured,
      sequenceId: shot.sequenceId,
      sourceScriptPromptId: sheet.sourceScriptPromptId,
      replaceTipId: sheet._id,
    });
    return { updated: true };
  },
});

export const markBlockoutStale = internalMutation({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => {
    const seq = await ctx.db.get(args.sequenceId);
    if (seq?.scriptPromptId) {
      await markBlockoutStaleForScriptPrompt(ctx, seq.scriptPromptId);
    }
  },
});

/**
 * Rewrite blockout sheet from current script tip and selectively rebuild 3D.
 * Browser still refreshes guides / encodes pre-viz after this returns.
 */
export const updateBlockoutFromScript = action({
  args: {
    projectId: v.id("projects"),
    sequenceId: v.id("sequences"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    blockoutSheetId: Id<"promptSheets">;
    rebuiltCount: number;
    keptCount: number;
    savedShotIds: string[];
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: args.projectId,
      userId,
    });

    const sequence = await ctx.runQuery(internal.sequences.getInternal, {
      sequenceId: args.sequenceId,
    });
    if (!sequence) throw new Error("Sequence not found");
    if (!sequence.scriptPromptId) {
      throw new Error("Sequence has no script prompt");
    }

    const scriptSheet = await ctx.runQuery(internal.promptSheets.getInternal, {
      promptSheetId: sequence.scriptPromptId,
    });
    if (!scriptSheet || scriptSheet.type !== "script") {
      throw new Error("Script prompt not found");
    }

    let script: ScriptPromptData;
    if (scriptSheet.renderedText?.trim()) {
      script = parseScriptPromptText(scriptSheet.renderedText);
    } else if (scriptSheet.renderedFileId) {
      script = parseScriptPromptText(
        String(await loadJson(ctx, scriptSheet.renderedFileId)),
      );
    } else {
      script = scriptPromptSchema.parse(
        await loadJson(ctx, scriptSheet.structuredFileId),
      ) as ScriptPromptData;
    }

    // Ensure live shots match script before building blockout.
    await ctx.runAction(api.sequences.applyScriptPrompt, {
      projectId: args.projectId,
      promptSheetId: scriptSheet._id,
      title: sequence.title,
    });

    const project = await ctx.runQuery(internal.generation.getProjectWorkspace, {
      projectId: args.projectId,
    });

    const { buildBlockoutSheetFromScript } = await import("@cinakey/shared");
    const structured = buildBlockoutSheetFromScript(script, {
      sequenceTitle: sequence.title,
      scriptPromptVersion: scriptSheet.version,
      aspectRatio: project.aspectRatio,
      fps: project.fps,
    });

    const tips: Doc<"promptSheets">[] = await ctx.runQuery(
      internal.promptSheets.listTipsInternal,
      { projectId: args.projectId, type: "blockout" },
    );
    const existingBlockout = tips.find(
      (t) => t.sequenceId === args.sequenceId && t.isTip,
    );

    const draft = await ctx.runAction(api.promptSheets.createOrUpdateDraft, {
      projectId: args.projectId,
      type: "blockout",
      structured,
      sequenceId: args.sequenceId,
      sourceScriptPromptId: scriptSheet._id,
      replaceTipId: existingBlockout?._id,
    });

    const applied = await ctx.runAction(api.sequences.applyBlockoutSheet, {
      projectId: args.projectId,
      promptSheetId: draft.promptSheetId,
    });

    return {
      blockoutSheetId: draft.promptSheetId,
      rebuiltCount: applied.rebuiltCount ?? applied.count,
      keptCount: applied.keptCount ?? 0,
      savedShotIds: applied.savedShotIds,
    };
  },
});
