import { timelineUsesAsset } from "./lib/mediaProtection";
import { type ScriptPromptData } from "@cinakey/shared";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { getAdapter } from "./adapters";
import { requireProjectAccess } from "./lib/access";
import { getFileUrl, deleteFile } from "./storage";

const SEEDANCE_ID = "seedance-2.5";

/** Project spend: reserved net of refunds + settled actuals (approx via ledger). */
export const getProjectSpend = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await requireProjectAccess(ctx, args.projectId);
    const entries = await ctx.db
      .query("creditLedger")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", project.workspaceId),
      )
      .collect();
    let spent = 0;
    for (const e of entries) {
      if (e.projectId !== args.projectId) continue;
      // Reserves are negative; refunds positive; settle returns unused (positive).
      // Net project spend = -sum(delta) for reserve+settle+refund on this project.
      if (
        e.reason === "reserve" ||
        e.reason === "settle" ||
        e.reason === "refund"
      ) {
        spent -= e.delta;
      }
    }
    // Clamp: settle/refund never over-refund beyond reserve in practice.
    spent = Math.max(0, spent);
    return {
      spentCredits: spent,
      spendCapCredits: project.spendCapCredits ?? null,
      remaining:
        project.spendCapCredits !== undefined
          ? Math.max(0, project.spendCapCredits - spent)
          : null,
    };
  },
});

export const assertSpendCapInternal = internalQuery({
  args: {
    projectId: v.id("projects"),
    estimatedCostCredits: v.number(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (project === null) throw new Error("Project not found");
    if (project.spendCapCredits === undefined) {
      return { ok: true as const };
    }
    const entries = await ctx.db
      .query("creditLedger")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", project.workspaceId),
      )
      .collect();
    let spent = 0;
    for (const e of entries) {
      if (e.projectId !== args.projectId) continue;
      if (
        e.reason === "reserve" ||
        e.reason === "settle" ||
        e.reason === "refund"
      ) {
        spent -= e.delta;
      }
    }
    spent = Math.max(0, spent);
    if (spent + args.estimatedCostCredits > project.spendCapCredits) {
      return {
        ok: false as const,
        spent,
        cap: project.spendCapCredits,
        message: `Project spend cap reached (${spent}/${project.spendCapCredits} credits). This job needs ${args.estimatedCostCredits} more.`,
      };
    }
    return { ok: true as const };
  },
});

export const resolveScriptPromptForRun = query({
  args: {
    sequenceId: v.id("sequences"),
    shotId: v.optional(v.id("shots")),
  },
  handler: async (ctx, args) => {
    const sequence = await ctx.db.get(args.sequenceId);
    if (sequence === null) throw new Error("Sequence not found");
    await requireProjectAccess(ctx, sequence.projectId);

    if (!sequence.scriptPromptId) {
      throw new Error("Sequence has no script prompt");
    }
    const sheet = await ctx.db.get(sequence.scriptPromptId);
    if (sheet === null) throw new Error("Script prompt sheet not found");
    if (sheet.status !== "approved" && sheet.status !== "done") {
      // Allow approved or done; generation may proceed from approved tip.
      if (sheet.status === "draft" || sheet.status === "out_of_date") {
        // still allow with warning — UI shows status
      }
    }

    const referenceMap = sheet.referenceMap ?? [];
    const maxRefs =
      getAdapter(SEEDANCE_ID)?.capabilities.maxReferenceImages ?? 30;

    const orderedRefs: Array<{
      imageN: number;
      entityId: Id<"entities">;
      assetId: Id<"assets"> | null;
      entityName: string;
    }> = [];

    const sorted = [...referenceMap].sort((a, b) => a.imageN - b.imageN);
    for (const ref of sorted.slice(0, maxRefs)) {
      const entity = await ctx.db.get(ref.entityId);
      const assetId = entity?.lockedReferenceAssetIds[0] ?? null;
      orderedRefs.push({
        imageN: ref.imageN,
        entityId: ref.entityId,
        assetId,
        entityName: entity?.name ?? "?",
      });
    }

    let renderedText = sheet.renderedText ?? "";
    if (!renderedText && sheet.renderedFileId) {
      // rendered in file — client/action should load; for query leave empty hint
      renderedText = "";
    }

    const structured: ScriptPromptData | null = null;
    // Structured load needs action; expose sheet id for action path.
    const singleShotPrompt: string | null = null;
    let shotOverride: string | null = null;

    if (args.shotId) {
      const shot = await ctx.db.get(args.shotId);
      if (shot?.generationPromptOverride) {
        shotOverride = shot.generationPromptOverride;
      }
    }

    return {
      sequence,
      sheet: {
        _id: sheet._id,
        status: sheet.status,
        renderedText,
        renderedFileId: sheet.renderedFileId,
        structuredFileId: sheet.structuredFileId,
        referenceMap,
        version: sheet.version,
      },
      orderedRefs,
      referenceAssetIds: orderedRefs
        .map((r) => r.assetId)
        .filter((id): id is Id<"assets"> => id !== null),
      singleShotPrompt,
      shotOverride,
      structured,
    };
  },
});

export const listActiveJobsForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const jobs = await ctx.db
      .query("generationJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return jobs.filter(
      (j) =>
        j.status === "queued" ||
        j.status === "submitted" ||
        j.status === "running",
    );
  },
});

export const listShotsForGeneration = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_project_order", (q) => q.eq("projectId", args.projectId))
      .collect();
    scenes.sort((a, b) => a.order - b.order);

    const groups = [];
    for (const scene of scenes) {
      const shots = await ctx.db
        .query("shots")
        .withIndex("by_scene_order", (q) => q.eq("sceneId", scene._id))
        .collect();
      shots.sort((a, b) => a.order - b.order);

      const shotRows = [];
      for (const shot of shots) {
        let keyframeUrl: string | null = null;
        if (shot.keyframeAssetId) {
          const kf = await ctx.db.get(shot.keyframeAssetId);
          if (kf) keyframeUrl = await getFileUrl(ctx, kf.storageId);
        }
        let selectedTakeThumb: string | null = null;
        const selectedTakeId: Id<"takes"> | null = shot.selectedTakeId ?? null;
        if (shot.selectedTakeId) {
          const take = await ctx.db.get(shot.selectedTakeId);
          if (take) {
            const assetId = take.proxyAssetId ?? take.assetId;
            const asset = await ctx.db.get(assetId);
            if (asset) {
              selectedTakeThumb = await getFileUrl(ctx, asset.storageId);
            }
          }
        }

        const jobs = await ctx.db
          .query("generationJobs")
          .withIndex("by_shot", (q) => q.eq("shotId", shot._id))
          .collect();
        const creditsUsed = jobs
          .filter((j) => j.status === "succeeded" || j.status === "refunded")
          .reduce(
            (sum, j) =>
              sum +
              (j.actualCostCredits ??
                (j.status === "succeeded" ? j.estimatedCostCredits : 0)),
            0,
          );
        const activeJob = jobs.find(
          (j) =>
            j.status === "queued" ||
            j.status === "submitted" ||
            j.status === "running",
        );

        // Guide assets
        const assets = await ctx.db
          .query("assets")
          .withIndex("by_shot", (q) => q.eq("shotId", shot._id))
          .collect();
        const guideKeyframe = assets.find((a) =>
          a.tags.includes("blockout-keyframe"),
        );
        const guideDepth = assets.find((a) =>
          a.tags.includes("blockout-depth"),
        );

        shotRows.push({
          ...shot,
          keyframeUrl,
          selectedTakeThumb,
          selectedTakeId,
          creditsUsed,
          activeJobStatus: activeJob?.status ?? null,
          activeJobId: activeJob?._id ?? null,
          guideKeyframeAssetId: guideKeyframe?._id ?? null,
          guideDepthAssetId: guideDepth?._id ?? null,
        });
      }
      groups.push({ scene, shots: shotRows });
    }
    return groups;
  },
});

export const getShotGenerationContext = query({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) return null;
    await requireProjectAccess(ctx, shot.projectId);

    const characters = await Promise.all(
      shot.characterIds.map((id) => ctx.db.get(id)),
    );
    const location = shot.locationId ? await ctx.db.get(shot.locationId) : null;

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_shot", (q) => q.eq("shotId", shot._id))
      .collect();
    const guideKeyframe = assets.find((a) =>
      a.tags.includes("blockout-keyframe"),
    );
    const guideDepth = assets.find((a) => a.tags.includes("blockout-depth"));

    let keyframeUrl: string | null = null;
    if (shot.keyframeAssetId) {
      const kf = await ctx.db.get(shot.keyframeAssetId);
      if (kf) keyframeUrl = await getFileUrl(ctx, kf.storageId);
    }
    let guideKeyframeUrl: string | null = null;
    if (guideKeyframe) {
      guideKeyframeUrl = await getFileUrl(ctx, guideKeyframe.storageId);
    }
    let guideDepthUrl: string | null = null;
    if (guideDepth) {
      guideDepthUrl = await getFileUrl(ctx, guideDepth.storageId);
    }

    const sequence = shot.sequenceId ? await ctx.db.get(shot.sequenceId) : null;
    let scriptSheet: Doc<"promptSheets"> | null = null;
    if (sequence?.scriptPromptId) {
      scriptSheet = await ctx.db.get(sequence.scriptPromptId);
    }

    const jobs = await ctx.db
      .query("generationJobs")
      .withIndex("by_shot", (q) => q.eq("shotId", shot._id))
      .collect();
    jobs.sort((a, b) => b.createdAt - a.createdAt);

    return {
      shot,
      characters: characters.filter(Boolean),
      location,
      sequence,
      scriptSheet,
      keyframeUrl,
      guideKeyframeAssetId: guideKeyframe?._id ?? null,
      guideDepthAssetId: guideDepth?._id ?? null,
      guideKeyframeUrl,
      guideDepthUrl,
      jobs: jobs.slice(0, 20),
    };
  },
});

export const markShotsGenerating = internalMutation({
  args: {
    shotIds: v.array(v.id("shots")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const shotId of args.shotIds) {
      const shot = await ctx.db.get(shotId);
      if (!shot) continue;
      if (shot.status === "generating") continue;
      await ctx.db.patch(shotId, {
        statusBeforeGenerating: shot.status,
        status: "generating",
        updatedAt: now,
      });
    }
  },
});

export const restoreShotsAfterFail = internalMutation({
  args: {
    shotIds: v.array(v.id("shots")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const shotId of args.shotIds) {
      const shot = await ctx.db.get(shotId);
      if (!shot || shot.status !== "generating") continue;
      const restore =
        shot.statusBeforeGenerating === "planned" ||
        shot.statusBeforeGenerating === "blocked_out" ||
        shot.statusBeforeGenerating === "selected"
          ? shot.statusBeforeGenerating
          : shot.selectedTakeId
            ? ("selected" as const)
            : shot.blockoutFileId
              ? ("blocked_out" as const)
              : ("planned" as const);
      await ctx.db.patch(shotId, {
        status: restore,
        statusBeforeGenerating: undefined,
        updatedAt: now,
      });
    }
  },
});

export const clearGeneratingStatus = internalMutation({
  args: { shotIds: v.array(v.id("shots")) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const shotId of args.shotIds) {
      const shot = await ctx.db.get(shotId);
      if (!shot || shot.status !== "generating") continue;
      const next = shot.selectedTakeId
        ? ("selected" as const)
        : shot.blockoutFileId
          ? ("blocked_out" as const)
          : ("planned" as const);
      await ctx.db.patch(shotId, {
        status: next,
        statusBeforeGenerating: undefined,
        updatedAt: now,
      });
    }
  },
});

export const createSequenceTakes = internalMutation({
  args: {
    projectId: v.id("projects"),
    sequenceId: v.id("sequences"),
    masterAssetId: v.id("assets"),
    jobId: v.id("generationJobs"),
  },
  handler: async (ctx, args) => {
    const shots = await ctx.db
      .query("shots")
      .withIndex("by_sequence", (q) => q.eq("sequenceId", args.sequenceId))
      .collect();
    shots.sort((a, b) => (a.startSec ?? a.order) - (b.startSec ?? b.order));
    const master = await ctx.db.get(args.masterAssetId);
    const mediaDuration = master?.durationSec;
    const takeIds: Id<"takes">[] = [];
    const now = Date.now();
    const existing = await ctx.db
      .query("takes")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    for (const shot of shots) {
      const match = existing.find(
        (take) =>
          take.shotId === shot._id && take.assetId === args.masterAssetId,
      );
      if (match) {
        takeIds.push(match._id);
        continue;
      }
      const start = shot.startSec ?? 0;
      const plannedEnd = shot.endSec ?? start + shot.durationSec;
      if (mediaDuration !== undefined && start >= mediaDuration) continue;
      const end =
        mediaDuration === undefined
          ? plannedEnd
          : Math.min(plannedEnd, mediaDuration);
      const takeId = await ctx.db.insert("takes", {
        projectId: args.projectId,
        shotId: shot._id,
        assetId: args.masterAssetId,
        jobId: args.jobId,
        trimStartSec: start,
        trimEndSec: end,
        selected: false,
        createdAt: now,
      });
      takeIds.push(takeId);
    }
    // Tag master asset
    const asset = await ctx.db.get(args.masterAssetId);
    if (asset) {
      const tags = Array.from(
        new Set([...asset.tags, "sequence-master", "video"]),
      );
      await ctx.db.patch(args.masterAssetId, {
        tags,
        searchText: `${asset.name} ${tags.join(" ")}`.toLowerCase(),
        updatedAt: now,
      });
    }
    return takeIds;
  },
});

export const createTakeWithMeta = internalMutation({
  args: {
    projectId: v.id("projects"),
    shotId: v.id("shots"),
    assetId: v.id("assets"),
    jobId: v.id("generationJobs"),
    parentTakeId: v.optional(v.id("takes")),
    trimStartSec: v.optional(v.number()),
    trimEndSec: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("takes", {
      projectId: args.projectId,
      shotId: args.shotId,
      assetId: args.assetId,
      jobId: args.jobId,
      parentTakeId: args.parentTakeId,
      trimStartSec: args.trimStartSec,
      trimEndSec: args.trimEndSec,
      selected: false,
      createdAt: Date.now(),
    });
  },
});

export const setGenerationPromptOverride = mutation({
  args: {
    shotId: v.id("shots"),
    prompt: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) throw new Error("Shot not found");
    await requireProjectAccess(ctx, shot.projectId);
    await ctx.db.patch(args.shotId, {
      generationPromptOverride: args.prompt === null ? undefined : args.prompt,
      updatedAt: Date.now(),
    });
  },
});

export const getShotsForSequenceInternal = internalQuery({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("shots")
      .withIndex("by_sequence", (q) => q.eq("sequenceId", args.sequenceId))
      .collect();
  },
});

export const getSequenceInternal = internalQuery({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => ctx.db.get(args.sequenceId),
});

export const getTakeInternal = internalQuery({
  args: { takeId: v.id("takes") },
  handler: async (ctx, args) => ctx.db.get(args.takeId),
});

export const getShotInternal = internalQuery({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args) => ctx.db.get(args.shotId),
});

export const listShotAssetsInternal = internalQuery({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("assets")
      .withIndex("by_shot", (q) => q.eq("shotId", args.shotId))
      .collect();
  },
});

/** Gallery of sequence-master videos for a Part, newest first. */
export const listSequenceMasters = query({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => {
    const sequence = await ctx.db.get(args.sequenceId);
    if (sequence === null) return [];
    await requireProjectAccess(ctx, sequence.projectId);

    const jobs = await ctx.db
      .query("generationJobs")
      .withIndex("by_sequence", (q) => q.eq("sequenceId", args.sequenceId))
      .collect();

    const masters = [];
    for (const job of jobs) {
      if (job.shotId) continue;
      if (job.status !== "succeeded") continue;
      const assetId = job.outputAssetIds[0];
      if (!assetId) continue;
      const asset = await ctx.db.get(assetId);
      if (!asset) continue;
      if (!asset.tags.includes("sequence-master")) continue;
      const url = await getFileUrl(ctx, asset.storageId);
      masters.push({
        assetId: asset._id,
        jobId: job._id,
        url,
        durationSec: asset.durationSec ?? sequence.durationSec,
        estimatedCostCredits: job.estimatedCostCredits,
        actualCostCredits: job.actualCostCredits ?? null,
        createdAt: job.completedAt ?? job.createdAt,
        kind: job.kind,
        chosen: sequence.chosenMasterAssetId === asset._id,
      });
    }
    masters.sort((a, b) => b.createdAt - a.createdAt);
    return masters;
  },
});

/**
 * Mark a sequence-master as Chosen and select its trimmed takes on every shot.
 */
export const chooseMaster = mutation({
  args: {
    sequenceId: v.id("sequences"),
    masterAssetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    const sequence = await ctx.db.get(args.sequenceId);
    if (sequence === null) throw new Error("Sequence not found");
    await requireProjectAccess(ctx, sequence.projectId);

    const asset = await ctx.db.get(args.masterAssetId);
    if (asset === null || asset.projectId !== sequence.projectId) {
      throw new Error("Master asset not found");
    }
    if (!asset.tags.includes("sequence-master")) {
      throw new Error("Asset is not a sequence master");
    }

    const shots = await ctx.db
      .query("shots")
      .withIndex("by_sequence", (q) => q.eq("sequenceId", args.sequenceId))
      .collect();

    const now = Date.now();
    for (const shot of shots) {
      const takes = await ctx.db
        .query("takes")
        .withIndex("by_shot", (q) => q.eq("shotId", shot._id))
        .collect();
      const match = takes.find((t) => t.assetId === args.masterAssetId);
      if (!match)
        throw new Error(
          "This video does not cover every planned shot. Choose individual takes or adjust the shot timing first.",
        );
      for (const sib of takes) {
        if (sib.selected && sib._id !== match._id) {
          await ctx.db.patch(sib._id, { selected: false });
        }
      }
      await ctx.db.patch(match._id, { selected: true });
      await ctx.db.patch(shot._id, {
        selectedTakeId: match._id,
        status: "selected",
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.sequenceId, {
      chosenMasterAssetId: args.masterAssetId,
      updatedAt: now,
    });
  },
});

/** Delete a sequence-master and its per-shot takes. */
export const deleteMaster = mutation({
  args: {
    sequenceId: v.id("sequences"),
    masterAssetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    const sequence = await ctx.db.get(args.sequenceId);
    if (sequence === null) throw new Error("Sequence not found");
    await requireProjectAccess(ctx, sequence.projectId);

    const asset = await ctx.db.get(args.masterAssetId);
    if (asset === null || asset.projectId !== sequence.projectId) {
      throw new Error("Master asset not found");
    }

    const shots = await ctx.db
      .query("shots")
      .withIndex("by_sequence", (q) => q.eq("sequenceId", args.sequenceId))
      .collect();

    if (await timelineUsesAsset(ctx, sequence.projectId, args.masterAssetId))
      throw new Error(
        "This video is used by a saved timeline or its history and cannot be deleted.",
      );
    const now = Date.now();
    const proxyIds = new Set<Id<"assets">>();

    for (const shot of shots) {
      const takes = await ctx.db
        .query("takes")
        .withIndex("by_shot", (q) => q.eq("shotId", shot._id))
        .collect();
      for (const take of takes) {
        if (take.assetId !== args.masterAssetId) continue;
        if (take.proxyAssetId) {
          if (
            await timelineUsesAsset(ctx, sequence.projectId, take.proxyAssetId)
          )
            throw new Error("A saved timeline uses this video proxy");
          proxyIds.add(take.proxyAssetId);
        }
        const wasSelected = shot.selectedTakeId === take._id;
        await ctx.db.delete(take._id);
        if (wasSelected) {
          await ctx.db.patch(shot._id, {
            selectedTakeId: undefined,
            status: shot.blockoutFileId ? "blocked_out" : "planned",
            updatedAt: now,
          });
        }
      }
    }

    if (sequence.chosenMasterAssetId === args.masterAssetId) {
      await ctx.db.patch(args.sequenceId, {
        chosenMasterAssetId: undefined,
        updatedAt: now,
      });
    }

    for (const proxyId of proxyIds) {
      const proxy = await ctx.db.get(proxyId);
      if (!proxy || proxy.starred) continue;
      const stillUsed = await ctx.db
        .query("takes")
        .filter((q) => q.eq(q.field("proxyAssetId"), proxyId))
        .first();
      if (stillUsed) continue;
      await deleteFile(ctx, proxy.storageId);
      await ctx.db.delete(proxyId);
    }

    if (!asset.starred) {
      const stillUsed = await ctx.db
        .query("takes")
        .filter((q) => q.eq(q.field("assetId"), args.masterAssetId))
        .first();
      if (!stillUsed) {
        await deleteFile(ctx, asset.storageId);
        await ctx.db.delete(args.masterAssetId);
      }
    }
  },
});
