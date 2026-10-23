import {
  assembleSingleShotPrompt,
  scriptPromptSchema,
  type ScriptPromptData,
} from "@cinakey/shared";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "../operations";
import type {
  Doc,
  Id,
} from "../../../../packages/backend/convex/_generated/dataModel";
import { action, type ActionCtx } from "../runtime/operation";
import { getAdapter } from "../providers";
import {
  loadJson,
  getFileUrl,
} from "../../../../packages/backend/convex/storage";

const SEEDANCE_ID = "seedance-2.5";

/**
 * Assemble prompt text + refs for a sequence or single-shot run (action).
 */
export const assemblePromptAction = action({
  args: {
    sequenceId: v.id("sequences"),
    shotId: v.optional(v.id("shots")),
    promptOverride: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    prompt: string;
    referenceAssetIds: Id<"assets">[];
    structured: ScriptPromptData;
    promptSheetId: Id<"promptSheets">;
    durationSec: number;
    aspectRatio: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const sequence: Doc<"sequences"> | null = await ctx.runQuery(
      internal.shotGeneration.getSequenceInternal,
      { sequenceId: args.sequenceId },
    );
    if (!sequence) throw new Error("Sequence not found");
    await ctx.runQuery(internal.generation.loadStartContext, {
      projectId: sequence.projectId,
      userId,
    });

    if (!sequence.scriptPromptId) {
      throw new Error("Sequence has no approved script prompt");
    }
    const sheet: Doc<"promptSheets"> | null = await ctx.runQuery(
      internal.promptSheets.getInternal,
      { promptSheetId: sequence.scriptPromptId },
    );
    if (!sheet) throw new Error("Script prompt not found");

    const raw = await loadJson(ctx, sheet.structuredFileId);
    const structured = scriptPromptSchema.parse(raw);

    let promptData = structured;
    let durationSec = sequence.durationSec;

    if (args.shotId) {
      const shot: Doc<"shots"> | null = await ctx.runQuery(
        internal.shotGeneration.getShotInternal,
        { shotId: args.shotId },
      );
      if (!shot || shot.sequenceId !== args.sequenceId) {
        throw new Error("Shot not in this sequence");
      }
      // Match by startSec/endSec or order index
      const shotsSorted = [...structured.shots].sort(
        (a, b) => a.startSec - b.startSec,
      );
      let match = shotsSorted.find(
        (s) =>
          shot.startSec !== undefined &&
          Math.abs(s.startSec - shot.startSec) < 0.05,
      );
      if (!match && shot.order < shotsSorted.length) {
        match = shotsSorted[shot.order];
      }
      if (!match) {
        match = shotsSorted[0];
      }
      if (!match) throw new Error("No shot in script prompt");
      promptData = assembleSingleShotPrompt(structured, match);
      durationSec = promptData.totalDurationSec;

      if (shot.generationPromptOverride && !args.promptOverride) {
        // Use override as final prompt text
        const referenceAssetIds = await resolveRefAssets(
          ctx,
          sheet,
          sequence.projectId,
          args.sequenceId,
        );
        return {
          prompt: shot.generationPromptOverride,
          referenceAssetIds,
          structured: promptData,
          promptSheetId: sheet._id,
          durationSec,
          aspectRatio: promptData.aspectRatio,
        };
      }
    }

    const { renderScriptPrompt } = await import("@cinakey/shared");
    const prompt =
      args.promptOverride?.trim() || renderScriptPrompt(promptData);

    const referenceAssetIds = await resolveRefAssets(
      ctx,
      sheet,
      sequence.projectId,
      args.sequenceId,
    );

    return {
      prompt,
      referenceAssetIds,
      structured: promptData,
      promptSheetId: sheet._id,
      durationSec,
      aspectRatio: promptData.aspectRatio,
    };
  },
});

async function resolveRefAssets(
  ctx: ActionCtx,
  sheet: Doc<"promptSheets">,
  projectId: Id<"projects">,
  sequenceId: Id<"sequences">,
): Promise<Id<"assets">[]> {
  const maxRefs =
    getAdapter(SEEDANCE_ID)?.capabilities.maxReferenceImages ?? 30;
  const seen = new Set<string>();
  const ids: Id<"assets">[] = [];

  const push = (assetId: Id<"assets"> | undefined | null) => {
    if (!assetId || seen.has(assetId) || ids.length >= maxRefs) return;
    seen.add(assetId);
    ids.push(assetId);
  };

  const map = [...(sheet.referenceMap ?? [])].sort(
    (a, b) => a.imageN - b.imageN,
  );
  for (const ref of map) {
    if (ids.length >= maxRefs) break;
    const entity = await ctx.runQuery(internal.entities.getEntityInternal, {
      entityId: ref.entityId,
    });
    if (!entity || entity.projectId !== projectId) continue;
    push(entity.lockedReferenceAssetIds[0]);
  }

  const project = await ctx.runQuery(internal.entities.getProjectInternal, {
    projectId,
  });
  if (project?.styleReferenceAssetId) {
    push(project.styleReferenceAssetId);
  }

  const shots: Doc<"shots">[] = await ctx.runQuery(
    internal.shotGeneration.getShotsForSequenceInternal,
    { sequenceId },
  );
  shots.sort((a, b) => (a.startSec ?? a.order) - (b.startSec ?? b.order));
  for (const shot of shots) {
    if (ids.length >= maxRefs) break;
    const assets: Doc<"assets">[] = await ctx.runQuery(
      internal.shotGeneration.listShotAssetsInternal,
      { shotId: shot._id },
    );
    const guide = assets.find((a) => a.tags.includes("blockout-keyframe"));
    push(guide?._id);
  }

  return ids;
}

export const startSequenceGeneration = action({
  args: {
    sequenceId: v.id("sequences"),
    promptOverride: v.optional(v.string()),
    resolution: v.optional(v.string()),
    aspectRatio: v.optional(v.string()),
    cameraPreset: v.optional(v.string()),
    seed: v.optional(v.number()),
    forceFail: v.optional(v.boolean()),
    /** When true and sequence has previzAssetId, pass its URL as referenceVideoUrl. */
    usePrevizAsReference: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ jobId: Id<"generationJobs">; estimatedCostCredits: number }> => {
    const assembled = await ctx.runAction(
      api.shotGeneration.assemblePromptAction,
      {
        sequenceId: args.sequenceId,
        promptOverride: args.promptOverride,
      },
    );

    const sequence: Doc<"sequences"> | null = await ctx.runQuery(
      internal.shotGeneration.getSequenceInternal,
      { sequenceId: args.sequenceId },
    );
    if (!sequence) throw new Error("Sequence not found");

    const durationSec = Math.min(
      assembled.durationSec,
      getAdapter(SEEDANCE_ID)?.capabilities.maxDurationSec ?? 30,
    );

    const shots: Doc<"shots">[] = await ctx.runQuery(
      internal.shotGeneration.getShotsForSequenceInternal,
      { sequenceId: args.sequenceId },
    );

    let referenceVideoUrl: string | undefined;
    if (args.usePrevizAsReference && sequence.previzAssetId) {
      const asset = await ctx.runQuery(internal.storage.getAssetInternal, {
        assetId: sequence.previzAssetId,
      });
      if (asset) {
        const url = await getFileUrl(ctx, asset.storageId);
        if (url) referenceVideoUrl = url;
      }
    }

    const adapter = getAdapter(SEEDANCE_ID);
    if (!adapter) throw new Error("Seedance adapter missing");
    const estimated = adapter.estimateCost({
      kind: "text-to-video",
      durationSec,
      prompt: assembled.prompt,
    });

    const cap = await ctx.runQuery(
      internal.shotGeneration.assertSpendCapInternal,
      {
        projectId: sequence.projectId,
        estimatedCostCredits: estimated,
      },
    );
    if (!cap.ok) {
      throw new Error(cap.message);
    }

    await ctx.runMutation(internal.shotGeneration.markShotsGenerating, {
      shotIds: shots.map((s) => s._id),
    });

    try {
      const result = await ctx.runAction(api.generation.startGeneration, {
        projectId: sequence.projectId,
        adapterId: SEEDANCE_ID,
        kind: "text-to-video",
        prompt: assembled.prompt,
        seed: args.seed,
        sequenceId: args.sequenceId,
        promptSheetId: assembled.promptSheetId,
        referenceAssetIds: assembled.referenceAssetIds,
        skipSpendCapCheck: true,
        input: {
          durationSec,
          resolution: args.resolution ?? "720p",
          aspectRatio: args.aspectRatio ?? assembled.aspectRatio,
          cameraPreset: args.cameraPreset,
          forceFail: args.forceFail,
          ...(referenceVideoUrl ? { referenceVideoUrl } : {}),
        },
      });
      // The part's blockout / pre-viz was good enough to generate from.
      await ctx.runMutation(internal.stagingFeedback.markAccepted, {
        sequenceId: args.sequenceId,
      });
      return result;
    } catch (err) {
      await ctx.runMutation(internal.shotGeneration.restoreShotsAfterFail, {
        shotIds: shots.map((s) => s._id),
      });
      throw err;
    }
  },
});

export const startShotGeneration = action({
  args: {
    shotId: v.id("shots"),
    promptOverride: v.optional(v.string()),
    startFrameAssetId: v.optional(v.id("assets")),
    endFrameAssetId: v.optional(v.id("assets")),
    resolution: v.optional(v.string()),
    aspectRatio: v.optional(v.string()),
    cameraPreset: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    seed: v.optional(v.number()),
    forceFail: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ jobId: Id<"generationJobs">; estimatedCostCredits: number }> => {
    const shot: Doc<"shots"> | null = await ctx.runQuery(
      internal.shotGeneration.getShotInternal,
      { shotId: args.shotId },
    );
    if (!shot) throw new Error("Shot not found");
    if (!shot.sequenceId) {
      throw new Error(
        "Shot is not part of a sequence — link a script prompt first",
      );
    }

    const assembled = await ctx.runAction(
      api.shotGeneration.assemblePromptAction,
      {
        sequenceId: shot.sequenceId,
        shotId: args.shotId,
        promptOverride: args.promptOverride,
      },
    );

    // Default start frame: blockout-keyframe or storyboard keyframe
    let startFrameAssetId = args.startFrameAssetId;
    const guideCtx = await ctx.runQuery(
      api.shotGeneration.getShotGenerationContext,
      { shotId: args.shotId },
    );
    if (!startFrameAssetId && guideCtx?.guideKeyframeAssetId) {
      startFrameAssetId = guideCtx.guideKeyframeAssetId;
    }
    if (!startFrameAssetId && shot.keyframeAssetId) {
      startFrameAssetId = shot.keyframeAssetId;
    }

    const kind = startFrameAssetId ? "image-to-video" : "text-to-video";
    const durationSec = Math.min(
      args.durationSec ?? assembled.durationSec ?? shot.durationSec,
      getAdapter(SEEDANCE_ID)?.capabilities.maxDurationSec ?? 30,
    );

    const adapter = getAdapter(SEEDANCE_ID);
    if (!adapter) throw new Error("Seedance adapter missing");
    const estimated = adapter.estimateCost({
      kind,
      durationSec,
      prompt: assembled.prompt,
    });

    const cap = await ctx.runQuery(
      internal.shotGeneration.assertSpendCapInternal,
      {
        projectId: shot.projectId,
        estimatedCostCredits: estimated,
      },
    );
    if (!cap.ok) throw new Error(cap.message);

    await ctx.runMutation(internal.shotGeneration.markShotsGenerating, {
      shotIds: [args.shotId],
    });

    try {
      return await ctx.runAction(api.generation.startGeneration, {
        projectId: shot.projectId,
        adapterId: SEEDANCE_ID,
        kind,
        prompt: assembled.prompt,
        seed: args.seed,
        shotId: args.shotId,
        sequenceId: shot.sequenceId,
        promptSheetId: assembled.promptSheetId,
        referenceAssetIds: assembled.referenceAssetIds,
        startFrameAssetId,
        endFrameAssetId: args.endFrameAssetId,
        skipSpendCapCheck: true,
        input: {
          durationSec,
          resolution: args.resolution ?? "720p",
          aspectRatio: args.aspectRatio ?? assembled.aspectRatio,
          cameraPreset: args.cameraPreset,
          forceFail: args.forceFail,
        },
      });
    } catch (err) {
      await ctx.runMutation(internal.shotGeneration.restoreShotsAfterFail, {
        shotIds: [args.shotId],
      });
      throw err;
    }
  },
});

export const startTakeUpscale = action({
  args: {
    takeId: v.id("takes"),
    resolution: v.optional(v.string()),
    forceFail: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ jobId: Id<"generationJobs">; estimatedCostCredits: number }> => {
    const take: Doc<"takes"> | null = await ctx.runQuery(
      internal.shotGeneration.getTakeInternal,
      { takeId: args.takeId },
    );
    if (!take) throw new Error("Take not found");
    const shot: Doc<"shots"> | null = await ctx.runQuery(
      internal.shotGeneration.getShotInternal,
      { shotId: take.shotId },
    );
    if (!shot) throw new Error("Shot not found");

    const durationSec =
      take.trimEndSec !== undefined && take.trimStartSec !== undefined
        ? take.trimEndSec - take.trimStartSec
        : shot.durationSec;

    const adapter = getAdapter(SEEDANCE_ID);
    if (!adapter) throw new Error("Seedance adapter missing");
    const estimated = adapter.estimateCost({
      kind: "upscale",
      durationSec,
      prompt: "upscale",
    });

    const cap = await ctx.runQuery(
      internal.shotGeneration.assertSpendCapInternal,
      {
        projectId: take.projectId,
        estimatedCostCredits: estimated,
      },
    );
    if (!cap.ok) throw new Error(cap.message);

    await ctx.runMutation(internal.shotGeneration.markShotsGenerating, {
      shotIds: [take.shotId],
    });

    try {
      return await ctx.runAction(api.generation.startGeneration, {
        projectId: take.projectId,
        adapterId: SEEDANCE_ID,
        kind: "upscale",
        prompt: "upscale",
        shotId: take.shotId,
        sequenceId: shot.sequenceId,
        parentAssetIds: [take.assetId],
        parentTakeId: take._id,
        skipSpendCapCheck: true,
        input: {
          durationSec,
          resolution: args.resolution ?? "1080p",
          forceFail: args.forceFail,
          parentTakeId: take._id,
        },
      });
    } catch (err) {
      await ctx.runMutation(internal.shotGeneration.restoreShotsAfterFail, {
        shotIds: [take.shotId],
      });
      throw err;
    }
  },
});

export const startTakeExtend = action({
  args: {
    takeId: v.id("takes"),
    extendSec: v.optional(v.number()),
    prompt: v.optional(v.string()),
    forceFail: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ jobId: Id<"generationJobs">; estimatedCostCredits: number }> => {
    const take: Doc<"takes"> | null = await ctx.runQuery(
      internal.shotGeneration.getTakeInternal,
      { takeId: args.takeId },
    );
    if (!take) throw new Error("Take not found");
    const shot: Doc<"shots"> | null = await ctx.runQuery(
      internal.shotGeneration.getShotInternal,
      { shotId: take.shotId },
    );
    if (!shot) throw new Error("Shot not found");

    const extendSec = args.extendSec ?? 5;
    const adapter = getAdapter(SEEDANCE_ID);
    if (!adapter) throw new Error("Seedance adapter missing");
    const estimated = adapter.estimateCost({
      kind: "extend",
      durationSec: extendSec,
      prompt: args.prompt ?? "extend",
    });

    const cap = await ctx.runQuery(
      internal.shotGeneration.assertSpendCapInternal,
      {
        projectId: take.projectId,
        estimatedCostCredits: estimated,
      },
    );
    if (!cap.ok) throw new Error(cap.message);

    await ctx.runMutation(internal.shotGeneration.markShotsGenerating, {
      shotIds: [take.shotId],
    });

    try {
      return await ctx.runAction(api.generation.startGeneration, {
        projectId: take.projectId,
        adapterId: SEEDANCE_ID,
        kind: "extend",
        prompt: args.prompt ?? "Continue the motion seamlessly.",
        shotId: take.shotId,
        sequenceId: shot.sequenceId,
        parentAssetIds: [take.assetId],
        parentTakeId: take._id,
        skipSpendCapCheck: true,
        input: {
          durationSec: extendSec,
          forceFail: args.forceFail,
          parentTakeId: take._id,
        },
      });
    } catch (err) {
      await ctx.runMutation(internal.shotGeneration.restoreShotsAfterFail, {
        shotIds: [take.shotId],
      });
      throw err;
    }
  },
});

/** Upscale a sequence master → new master + trimmed takes. */
export const startMasterUpscale = action({
  args: {
    sequenceId: v.id("sequences"),
    masterAssetId: v.id("assets"),
    resolution: v.optional(v.string()),
    forceFail: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ jobId: Id<"generationJobs">; estimatedCostCredits: number }> => {
    const sequence: Doc<"sequences"> | null = await ctx.runQuery(
      internal.shotGeneration.getSequenceInternal,
      { sequenceId: args.sequenceId },
    );
    if (!sequence) throw new Error("Sequence not found");

    const shots: Doc<"shots">[] = await ctx.runQuery(
      internal.shotGeneration.getShotsForSequenceInternal,
      { sequenceId: args.sequenceId },
    );
    const durationSec = sequence.durationSec;
    const adapter = getAdapter(SEEDANCE_ID);
    if (!adapter) throw new Error("Seedance adapter missing");
    const estimated = adapter.estimateCost({
      kind: "upscale",
      durationSec,
      prompt: "upscale",
    });

    const cap = await ctx.runQuery(
      internal.shotGeneration.assertSpendCapInternal,
      {
        projectId: sequence.projectId,
        estimatedCostCredits: estimated,
      },
    );
    if (!cap.ok) throw new Error(cap.message);

    await ctx.runMutation(internal.shotGeneration.markShotsGenerating, {
      shotIds: shots.map((s) => s._id),
    });

    try {
      return await ctx.runAction(api.generation.startGeneration, {
        projectId: sequence.projectId,
        adapterId: SEEDANCE_ID,
        kind: "upscale",
        prompt: "upscale",
        sequenceId: args.sequenceId,
        parentAssetIds: [args.masterAssetId],
        skipSpendCapCheck: true,
        input: {
          durationSec,
          resolution: args.resolution ?? "1080p",
          forceFail: args.forceFail,
        },
      });
    } catch (err) {
      await ctx.runMutation(internal.shotGeneration.restoreShotsAfterFail, {
        shotIds: shots.map((s) => s._id),
      });
      throw err;
    }
  },
});

/** Extend a sequence master → new master + trimmed takes. */
export const startMasterExtend = action({
  args: {
    sequenceId: v.id("sequences"),
    masterAssetId: v.id("assets"),
    extendSec: v.optional(v.number()),
    prompt: v.optional(v.string()),
    forceFail: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ jobId: Id<"generationJobs">; estimatedCostCredits: number }> => {
    const sequence: Doc<"sequences"> | null = await ctx.runQuery(
      internal.shotGeneration.getSequenceInternal,
      { sequenceId: args.sequenceId },
    );
    if (!sequence) throw new Error("Sequence not found");

    const shots: Doc<"shots">[] = await ctx.runQuery(
      internal.shotGeneration.getShotsForSequenceInternal,
      { sequenceId: args.sequenceId },
    );
    const extendSec = args.extendSec ?? 5;
    const adapter = getAdapter(SEEDANCE_ID);
    if (!adapter) throw new Error("Seedance adapter missing");
    const estimated = adapter.estimateCost({
      kind: "extend",
      durationSec: extendSec,
      prompt: args.prompt ?? "extend",
    });

    const cap = await ctx.runQuery(
      internal.shotGeneration.assertSpendCapInternal,
      {
        projectId: sequence.projectId,
        estimatedCostCredits: estimated,
      },
    );
    if (!cap.ok) throw new Error(cap.message);

    await ctx.runMutation(internal.shotGeneration.markShotsGenerating, {
      shotIds: shots.map((s) => s._id),
    });

    try {
      return await ctx.runAction(api.generation.startGeneration, {
        projectId: sequence.projectId,
        adapterId: SEEDANCE_ID,
        kind: "extend",
        prompt: args.prompt ?? "Continue the motion seamlessly.",
        sequenceId: args.sequenceId,
        parentAssetIds: [args.masterAssetId],
        skipSpendCapCheck: true,
        input: {
          durationSec: extendSec,
          forceFail: args.forceFail,
        },
      });
    } catch (err) {
      await ctx.runMutation(internal.shotGeneration.restoreShotsAfterFail, {
        shotIds: shots.map((s) => s._id),
      });
      throw err;
    }
  },
});
