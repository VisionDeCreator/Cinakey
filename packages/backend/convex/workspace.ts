import {
  generationDefaults,
  segmentSettingsDefaults,
} from "./lib/generationSettings";
import { requireProjectWrite } from "./lib/access";
import { projectUsage } from "./lib/budgets";
import { estimateStagingTokens, resolveReferences } from "@dirrio/shared";
import { stagingUsdMicros, stagingUsesLlm } from "./staging";
/** Project-owned creative documents. */
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  requireProjectAccessForUser,
  projectAssets,
  projectCanUseAsset,
  requireProjectAccess,
} from "./lib/access";
import { deleteFile, getFileUrl } from "./storage";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

async function projectSegments(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
) {
  return (
    await ctx.db
      .query("scriptSegments")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
  )
    .filter((segment) => !segment.deletedAt)
    .sort((a, b) => a.order - b.order);
}
async function segmentFor(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  segmentId?: Id<"scriptSegments">,
) {
  const segment = segmentId
    ? await ctx.db.get(segmentId)
    : (await projectSegments(ctx, projectId)).find((s) => !s.archivedAt);
  if (
    segmentId &&
    (!segment ||
      segment.projectId !== projectId ||
      segment.archivedAt ||
      segment.deletedAt)
  )
    throw new Error("Segment not found in project");
  return segment;
}
async function initializeSegments(ctx: MutationCtx, projectId: Id<"projects">) {
  const segments = await projectSegments(ctx, projectId);
  const project = await ctx.db.get(projectId);
  if (!project) throw new Error("Project not found");
  // An intentionally emptied project stays empty until the user adds a segment.
  if (
    !segments.length &&
    (await ctx.db
      .query("scriptSegments")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first())
  )
    return;
  const segmentId =
    segments[0]?._id ??
    (await ctx.db.insert("scriptSegments", {
      projectId,
      title: "Segment 1",
      order: 0,
      durationSec: 30,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
  const scripts = await ctx.db
    .query("workspaceScripts")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const script of scripts)
    if (!script.segmentId) await ctx.db.patch(script._id, { segmentId });
  for (const staging of await ctx.db
    .query("workspaceStaging")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect()) {
    if (!staging.segmentId)
      await ctx.db.patch(staging._id, {
        segmentId:
          scripts.find((s) => s._id === staging.scriptVersionId)?.segmentId ??
          segmentId,
      });
  }
  for (const segment of await projectSegments(ctx, projectId)) {
    if (segment.generationSettings) continue;
    const defaults = generationDefaults(project);
    const settings: import("./lib/generationSettings").GenerationSettings = {
      ...segmentSettingsDefaults(project),
      durationSec: segment.durationSec,
    };
    if (defaults.stagingId) {
      const staging = await ctx.db.get(defaults.stagingId);
      if (
        staging?.projectId === projectId &&
        staging.segmentId === segment._id
      ) {
        settings.stagingId = defaults.stagingId;
        settings.useStaging =
          defaults.useStaging && Boolean(staging.previzAssetId);
      }
    }
    const stored = {
      resolution: settings.resolution,
      aspectRatio: settings.aspectRatio,
      stagingId: settings.stagingId,
      useStaging: settings.useStaging,
    };
    await ctx.db.patch(segment._id, {
      generationSettings: stored,
      settingsRevision: 1,
    });
  }
  if (!scripts.some((s) => s.isTip))
    await ctx.db.insert("workspaceScripts", {
      projectId,
      segmentId,
      text: "",
      label: "Project script",
      isTip: true,
      createdAt: Date.now(),
    });
}
const projectArgs = { projectId: v.id("projects") };
export const list = query({
  args: { ...projectArgs, segmentId: v.optional(v.id("scriptSegments")) },
  handler: async (ctx, { projectId, segmentId }) => {
    await requireProjectAccess(ctx, projectId);
    const scripts = await ctx.db
      .query("workspaceScripts")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const staging = await ctx.db
      .query("workspaceStaging")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const segments = await projectSegments(ctx, projectId);
    const segment = await segmentFor(ctx, projectId, segmentId);
    const selected = scripts.filter((s) => s.segmentId === segment?._id);
    return {
      archivedSegments: segments
        .filter((segment) => segment.archivedAt)
        .map((segment) => ({
          ...segment,
          versionCount: scripts.filter(
            (script) => script.segmentId === segment._id,
          ).length,
        })),
      segments: segments
        .filter((s) => !s.archivedAt)
        .map((segment) => ({
          ...segment,
          versionCount: scripts.filter((s) => s.segmentId === segment._id)
            .length,
        })),
      migrated: scripts.some((script) => script.isTip),
      script: selected.find((s) => s.isTip) ?? null,
      scripts: selected
        .sort(
          (a, b) =>
            b.createdAt - a.createdAt || b._creationTime - a._creationTime,
        )
        .map((script, index) => ({
          version: selected.length - index,
          _id: script._id,
          label: script.label,
          createdAt: script.createdAt,
          isTip: script.isTip,
        })),
      staging: staging
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((row) => ({
          ...row,
          segmentId:
            row.segmentId ??
            scripts.find((s) => s._id === row.scriptVersionId)?.segmentId,
        })),
    };
  },
});

export const saveScript = mutation({
  args: {
    ...projectArgs,
    segmentId: v.optional(v.id("scriptSegments")),
    text: v.string(),
    expectedId: v.optional(v.id("workspaceScripts")),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectWrite(ctx, args.projectId);
    if (args.text.length > 200000)
      throw new Error("Script exceeds 200,000 characters");
    const rows = await ctx.db
      .query("workspaceScripts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const segment = await segmentFor(ctx, args.projectId, args.segmentId);
    const tip = rows.find((r) => r.isTip && r.segmentId === segment?._id);
    if (tip?._id !== args.expectedId)
      throw new Error(
        "Script changed in another window. Your local draft is preserved; reload before saving.",
      );
    const assets = await projectAssets(ctx, args.projectId);
    const resolved = resolveReferences(
      args.text,
      project.referenceBindings ?? [],
      assets.map((asset) => ({
        assetId: asset._id,
        name: asset.name,
        type: asset.type,
      })),
    );
    const bindings = [...(project.referenceBindings ?? [])];
    for (const ref of resolved.resolved)
      if (!bindings.some((binding) => binding.alias === ref.alias))
        bindings.push({
          alias: ref.alias,
          assetId: ref.assetId as import("./_generated/dataModel").Id<"assets">,
        });
    await ctx.db.patch(args.projectId, { referenceBindings: bindings });
    if (tip?.text === args.text) return tip._id;
    if (tip) await ctx.db.patch(tip._id, { isTip: false });
    return ctx.db.insert("workspaceScripts", {
      projectId: args.projectId,
      segmentId: segment?._id,
      text: args.text,
      parentId: tip?._id,
      label: "Script",
      isTip: true,
      createdAt: Date.now(),
    });
  },
});
export const stagingRecord = query({
  args: { id: v.id("workspaceStaging") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    await requireProjectAccess(ctx, row.projectId);
    return row;
  },
});
export const commitStaging = internalMutation({
  args: {
    ...projectArgs,
    segmentId: v.optional(v.id("scriptSegments")),
    id: v.optional(v.id("workspaceStaging")),
    name: v.string(),
    contentFileId: v.id("_storage"),
    mediaAssetIds: v.optional(v.array(v.id("assets"))),
    planFileId: v.optional(v.id("_storage")),
    scriptVersionId: v.optional(v.id("workspaceScripts")),
    expectedFileId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { id, expectedFileId, ...args }) => {
    await requireProjectWrite(ctx, args.projectId);
    if (id) {
      const row = await ctx.db.get(id);
      if (!row || row.projectId !== args.projectId)
        throw new Error("Staging not found");
      if (expectedFileId !== row.contentFileId)
        throw new Error(
          "Staging changed in another window; reload before saving",
        );
      await ctx.db.patch(id, {
        ...args,
        planHistory: [
          ...(row.planHistory ?? []),
          {
            contentFileId: row.contentFileId,
            planFileId: row.planFileId,
            scriptVersionId: row.scriptVersionId,
          },
        ],
        mediaAssetIds: [
          ...new Set([
            ...(row.mediaAssetIds ?? []),
            ...(args.mediaAssetIds ?? []),
          ]),
        ],
        updatedAt: Date.now(),
      });
      return id;
    }
    return ctx.db.insert("workspaceStaging", {
      ...args,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
export const setPreviz = mutation({
  args: { id: v.id("workspaceStaging"), assetId: v.id("assets") },
  handler: async (ctx, { id, assetId }) => {
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Staging not found");
    await requireProjectWrite(ctx, row.projectId);
    if (!(await projectCanUseAsset(ctx, row.projectId, assetId)))
      throw new Error("Asset unavailable");
    const asset = await ctx.db.get(assetId);
    if (asset?.type !== "video") throw new Error("Expected a video");
    await ctx.db.patch(id, { previzAssetId: assetId, updatedAt: Date.now() });
  },
});
export const videos = query({
  args: projectArgs,
  handler: async (ctx, { projectId }) => {
    await requireProjectAccess(ctx, projectId);
    const assets = await projectAssets(ctx, projectId);
    const jobs = await ctx.db
      .query("generationJobs")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const scripts = await ctx.db
      .query("workspaceScripts")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const versionNumbers = new Map<string, number>();
    const counts = new Map<string | undefined, number>();
    for (const script of scripts.sort(
      (a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime,
    )) {
      const version = (counts.get(script.segmentId) ?? 0) + 1;
      counts.set(script.segmentId, version);
      versionNumbers.set(script._id, version);
    }
    return {
      videos: await Promise.all(
        assets
          .filter((a) => a.type === "video")
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(async (asset) => ({
            assetId: asset._id,
            name: asset.name,
            url: await getFileUrl(ctx, asset.storageId),
            durationSec: asset.durationSec ?? null,
            createdAt: asset.createdAt,
            starred: asset.starred,
            segmentId: jobs.find(
              (j) =>
                j._id === asset.jobId || j.outputAssetIds.includes(asset._id),
            )?.segmentId,
            scriptVersionId: jobs.find(
              (j) =>
                j._id === asset.jobId || j.outputAssetIds.includes(asset._id),
            )?.scriptVersionId,
            scriptVersion: versionNumbers.get(
              jobs.find(
                (j) =>
                  j._id === asset.jobId || j.outputAssetIds.includes(asset._id),
              )?.scriptVersionId ?? "",
            ),
            generated: Boolean(
              asset.jobId ||
              jobs.some((j) => j.outputAssetIds.includes(asset._id)),
            ),
          })),
      ),
      jobs: jobs
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((j) => ({
          jobId: j._id,
          segmentId: j.segmentId,
          scriptVersionId: j.scriptVersionId,
          model: j.model,
          status: j.status,
          errorMessage: j.errorMessage,
          submissionState: j.submissionState,
          createdAt: j.createdAt,
          estimatedCostUsdMicros: j.estimatedCostUsdMicros,
        })),
    };
  },
});
export const estimateStaging = query({
  args: {
    ...projectArgs,
    segmentId: v.optional(v.id("scriptSegments")),
    durationSec: v.number(),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const scripts = await ctx.db
      .query("workspaceScripts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const segment = await segmentFor(ctx, args.projectId, args.segmentId);
    const tip = scripts.find((s) => s.isTip && s.segmentId === segment?._id);
    const tokens = estimateStagingTokens(
      tip?.text ?? " ".repeat(80000),
      Math.max(1, Math.ceil(args.durationSec / 5)),
    );
    return {
      llm: stagingUsesLlm(),
      usdMicros: stagingUsesLlm() ? stagingUsdMicros(tokens) : 0,
    };
  },
});

export const spend = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await requireProjectAccess(ctx, args.projectId);
    return projectUsage(ctx, project._id);
  },
});
/** Read-only operator audit. Counts and missing mappings only; no media is fetched. */

export const scriptRecord = query({
  args: { id: v.id("workspaceScripts") },
  handler: async (ctx, { id }) => {
    const script = await ctx.db.get(id);
    if (!script) return null;
    await requireProjectAccess(ctx, script.projectId);
    return script;
  },
});

export const assertAccess = internalQuery({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireProjectAccessForUser(ctx, args.projectId, args.userId);
    return true;
  },
});
export const initialize = internalMutation({
  args: projectArgs,
  handler: async (ctx, { projectId }) => {
    await initializeSegments(ctx, projectId);
  },
});

/** Administrative integrity inventory; never exposed as a public HTTP operation. */
export const auditAll = internalQuery({
  args: {},
  handler: async (ctx) => ({
    projects: await ctx.db.query("projects").collect(),
    scripts: await ctx.db.query("workspaceScripts").collect(),
    staging: await ctx.db.query("workspaceStaging").collect(),
    timelines: await ctx.db.query("timelineVersions").collect(),
    assets: await ctx.db.query("assets").collect(),
    jobs: await ctx.db.query("generationJobs").collect(),
  }),
});

export const createSegment = mutation({
  args: { ...projectArgs, title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireProjectWrite(ctx, args.projectId);
    await initializeSegments(ctx, args.projectId);
    const segments = await projectSegments(ctx, args.projectId);
    const title = args.title?.trim() || `Segment ${segments.length + 1}`;
    if (title.length > 120)
      throw new Error("Segment title exceeds 120 characters");
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");
    const id = await ctx.db.insert("scriptSegments", {
      projectId: args.projectId,
      title,
      order: Math.max(-1, ...segments.map((s) => s.order)) + 1,
      durationSec: generationDefaults(project).durationSec,
      generationSettings: segmentSettingsDefaults(project),
      settingsRevision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("workspaceScripts", {
      projectId: args.projectId,
      segmentId: id,
      text: "",
      label: "Script",
      isTip: true,
      createdAt: Date.now(),
    });
    return id;
  },
});
export const updateSegment = mutation({
  args: {
    ...projectArgs,
    segmentId: v.id("scriptSegments"),
    title: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    archive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireProjectWrite(ctx, args.projectId);
    const segment = await segmentFor(ctx, args.projectId, args.segmentId);
    if (
      args.title !== undefined &&
      (!args.title.trim() || args.title.trim().length > 120)
    )
      throw new Error("Use a title of 1–120 characters");
    if (
      args.durationSec !== undefined &&
      (!Number.isInteger(args.durationSec) ||
        args.durationSec < 4 ||
        args.durationSec > 30)
    )
      throw new Error("Segment duration must be 4–30 seconds");
    if (
      args.archive &&
      (await projectSegments(ctx, args.projectId)).filter((s) => !s.archivedAt)
        .length <= 1
    )
      throw new Error("Keep at least one segment");
    await ctx.db.patch(args.segmentId, {
      ...(args.title !== undefined ? { title: args.title.trim() } : {}),
      ...(args.durationSec !== undefined
        ? {
            durationSec: args.durationSec,
            settingsRevision: (segment?.settingsRevision ?? 0) + 1,
          }
        : {}),
      ...(args.archive ? { archivedAt: Date.now() } : {}),
      updatedAt: Date.now(),
    });
  },
});
export const reorderSegments = mutation({
  args: { ...projectArgs, segmentIds: v.array(v.id("scriptSegments")) },
  handler: async (ctx, args) => {
    await requireProjectWrite(ctx, args.projectId);
    const segments = (await projectSegments(ctx, args.projectId)).filter(
      (s) => !s.archivedAt,
    );
    if (
      args.segmentIds.length !== segments.length ||
      new Set(args.segmentIds).size !== segments.length ||
      segments.some((s) => !args.segmentIds.includes(s._id))
    )
      throw new Error("Include each active segment exactly once");
    for (const [order, id] of args.segmentIds.entries())
      await ctx.db.patch(id, { order, updatedAt: Date.now() });
  },
});

/** Remove scripts permanently; retain a tombstone for generated-media provenance. */
export const deleteSegment = mutation({
  args: { ...projectArgs, segmentId: v.id("scriptSegments") },
  handler: async (ctx, { projectId, segmentId }) => {
    await requireProjectWrite(ctx, projectId);
    const segment = await segmentFor(ctx, projectId, segmentId);
    if (!segment) throw new Error("Segment not found in project");
    const scripts = (
      await ctx.db
        .query("workspaceScripts")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect()
    ).filter((script) => script.segmentId === segmentId);
    const files = new Set(
      scripts.flatMap((script) =>
        script.contentFileId ? [script.contentFileId] : [],
      ),
    );
    for (const file of files) await deleteFile(ctx, file);
    for (const script of scripts) await ctx.db.delete(script._id);
    await ctx.db.patch(segmentId, {
      deletedAt: Date.now(),
      generationSettings: undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Restore the original script chain and preferences, appending to active segments. */
export const restoreSegment = mutation({
  args: { ...projectArgs, segmentId: v.id("scriptSegments") },
  handler: async (ctx, { projectId, segmentId }) => {
    await requireProjectWrite(ctx, projectId);
    const segment = await ctx.db.get(segmentId);
    if (!segment || segment.projectId !== projectId || segment.deletedAt)
      throw new Error("Segment not found in project");
    if (!segment.archivedAt) return segmentId;
    const segments = await projectSegments(ctx, projectId);
    await ctx.db.patch(segmentId, {
      archivedAt: undefined,
      order:
        Math.max(
          -1,
          ...segments.filter((s) => !s.archivedAt).map((s) => s.order),
        ) + 1,
      updatedAt: Date.now(),
    });
    return segmentId;
  },
});
