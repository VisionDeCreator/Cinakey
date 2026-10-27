import {
  assertBlockoutDocument,
  compileStagingPlan,
  emptyPartDocument,
  migrateToV2,
  parseScriptPromptText,
  parseStagingPlan,
  resolveReferences,
  type BlockoutDocument,
  type StagingPlan,
} from "@cinakey/shared";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "../../../../packages/backend/convex/_generated/dataModel";
import { loadJson } from "../../../../packages/backend/convex/storage";
import { api, internal } from "../operations";
import { action, type ActionCtx } from "../runtime/operation";
import { saveJson } from "./storage";

async function access(ctx: ActionCtx, projectId: Id<"projects">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  await ctx.runQuery(internal.workspace.assertAccess, {
    projectId,
    userId,
  });
  return userId;
}
async function initializeProject(
  ctx: ActionCtx,
  projectId: Id<"projects">,
): Promise<void> {
  await ctx.runMutation(internal.workspace.initialize, { projectId });
}
export const ensure = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }): Promise<void> => {
    await access(ctx, projectId);
    await initializeProject(ctx, projectId);
  },
});
export const script = action({
  args: {
    projectId: v.id("projects"),
    id: v.optional(v.id("workspaceScripts")),
  },
  handler: async (
    ctx,
    { projectId, id },
  ): Promise<{ id: Id<"workspaceScripts">; text: string }> => {
    await access(ctx, projectId);
    await initializeProject(ctx, projectId);
    const state = await ctx.runQuery(api.workspace.list, { projectId });
    const row = id
      ? await ctx.runQuery(api.workspace.scriptRecord, { id })
      : state.script;
    if (row && row.projectId !== projectId)
      throw new Error("Script belongs to another project");
    if (!row) throw new Error("Script not found");
    return {
      id: row._id,
      text: row.contentFileId
        ? String(await loadJson(ctx, row.contentFileId))
        : (row.text ?? ""),
    };
  },
});
export const loadStaging = action({
  args: {
    projectId: v.id("projects"),
    id: v.optional(v.id("workspaceStaging")),
    newDocument: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { projectId, id, newDocument },
  ): Promise<{
    document: BlockoutDocument;
    fileId: Id<"_storage"> | null;
    id: Id<"workspaceStaging"> | null;
  }> => {
    await access(ctx, projectId);
    await initializeProject(ctx, projectId);
    const project = await ctx.runQuery(api.projects.get, { projectId });
    if (!project) throw new Error("Project not found");
    const state = await ctx.runQuery(api.workspace.list, { projectId });
    const row = newDocument
      ? undefined
      : id
        ? state.staging.find((s) => s._id === id)
        : state.staging[0];
    if (id && !row) throw new Error("Staging not found in project");
    const meta = {
      id: projectId,
      title: project.title,
      aspectRatio: project.aspectRatio,
      fps: project.fps,
    };
    const document = row
      ? migrateToV2(await loadJson(ctx, row.contentFileId), { project: meta })
      : emptyPartDocument(meta);
    if (!row) document.name = "Staging";
    // Old shot identifiers are informational cut labels, never database lookups.
    delete document.sequenceId;
    for (const cut of document.shots) {
      if (cut.shotId && document.guides?.[cut.shotId])
        document.guides[`n${cut.n}`] = document.guides[cut.shotId]!;
      delete cut.shotId;
    }
    return {
      document,
      fileId: row?.contentFileId ?? null,
      id: row?._id ?? null,
    };
  },
});
type StagingSave = {
  clearPlan?: boolean;
  clearScript?: boolean;
  projectId: Id<"projects">;
  id?: Id<"workspaceStaging">;
  document: unknown;
  expectedFileId?: Id<"_storage">;
  planFileId?: Id<"_storage">;
  scriptVersionId?: Id<"workspaceScripts">;
};
async function persistStaging(
  ctx: ActionCtx,
  args: StagingSave,
): Promise<{ id: Id<"workspaceStaging">; fileId: Id<"_storage"> }> {
  await access(ctx, args.projectId);
  await ctx.runQuery(internal.payments.assertProjectWrite, {
    projectId: args.projectId,
  });
  await initializeProject(ctx, args.projectId);
  const project = await ctx.runQuery(api.projects.get, {
    projectId: args.projectId,
  });
  if (!project) throw new Error("Project not found");
  const row = args.id
    ? await ctx.runQuery(api.workspace.stagingRecord, { id: args.id })
    : null;
  if (args.id && (!row || row.projectId !== args.projectId))
    throw new Error("Staging not found");
  const document = assertBlockoutDocument(args.document);
  if (document.project.id !== args.projectId)
    throw new Error("Staging belongs to another project");
  delete document.sequenceId;
  document.parentFileId = row?.contentFileId;
  const previous = row
    ? await loadJson<BlockoutDocument>(ctx, row.contentFileId)
    : null;
  document.version = (previous?.version ?? 0) + 1;
  const projectAssets = await ctx.runQuery(api.assets.list, {
    projectId: args.projectId,
  });
  const references = new Set<string>();
  const collect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (/assetId$/i.test(key) && typeof child === "string")
        references.add(child);
      else collect(child);
    }
  };
  collect(document);
  const mediaAssetIds = projectAssets
    .filter((asset) => references.has(asset._id))
    .map((asset) => asset._id);
  const { storageId } = await saveJson(ctx, document);
  const id = await ctx.runMutation(internal.workspace.commitStaging, {
    mediaAssetIds,
    projectId: args.projectId,
    id: args.id,
    name: document.name || "Staging",
    contentFileId: storageId,
    expectedFileId: args.expectedFileId,
    planFileId: args.clearPlan
      ? undefined
      : (args.planFileId ?? row?.planFileId),
    scriptVersionId: args.clearScript
      ? undefined
      : (args.scriptVersionId ?? row?.scriptVersionId),
  });
  return { id, fileId: storageId };
}
export const saveStaging = action({
  args: {
    projectId: v.id("projects"),
    id: v.optional(v.id("workspaceStaging")),
    document: v.any(),
    expectedFileId: v.optional(v.id("_storage")),
  },
  handler: persistStaging,
});
export const generateStaging = action({
  args: {
    projectId: v.id("projects"),
    durationSec: v.number(),
    reuse: v.optional(v.boolean()),
    id: v.optional(v.id("workspaceStaging")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ id: Id<"workspaceStaging">; usdMicros: number }> => {
    const userId = await access(ctx, args.projectId);
    await initializeProject(ctx, args.projectId);
    if (
      !Number.isFinite(args.durationSec) ||
      args.durationSec < 1 ||
      args.durationSec > 600
    )
      throw new Error("Staging duration must be 1–600 seconds");
    const project = await ctx.runQuery(api.projects.get, {
      projectId: args.projectId,
    });
    if (!project) throw new Error("Project not found");
    const script = await ctx.runAction(api.workspace.script, {
      projectId: args.projectId,
    });
    if (!script.text.trim()) throw new Error("Write a script first");
    const existing = args.id
      ? await ctx.runQuery(api.workspace.stagingRecord, { id: args.id })
      : null;
    if (existing && existing.projectId !== args.projectId)
      throw new Error("Staging project mismatch");
    let plan: StagingPlan;
    let planFileId = existing?.planFileId;
    let usdMicros = 0;
    if (args.reuse && planFileId) {
      const parsed = parseStagingPlan(
        JSON.stringify(await loadJson(ctx, planFileId)),
      );
      if (!parsed.ok)
        throw new Error(`Saved staging plan is invalid: ${parsed.error}`);
      plan = parsed.plan;
    } else {
      const result = await ctx.runAction(internal.staging.generatePlan, {
        projectId: args.projectId,
        userId,
        scriptText: script.text,
        shotCount: Math.max(1, Math.ceil(args.durationSec / 5)),
        durationSec: args.durationSec,
        aspectRatio: project.aspectRatio,
      });
      if (!result.ok) throw new Error(result.reason);
      plan = result.plan;
      planFileId = result.planFileId;
      usdMicros = result.usdMicros;
    }
    const timing = parseScriptPromptText("");
    timing.shots = [];
    timing.totalDurationSec = args.durationSec;
    timing.aspectRatio = project.aspectRatio;
    const document = compileStagingPlan(plan, timing, {
      id: args.projectId,
      title: project.title,
      fps: project.fps,
      aspectRatio: project.aspectRatio,
    });
    delete document.sequenceId;
    const saved = await persistStaging(ctx, {
      projectId: args.projectId,
      id: args.id,
      document,
      expectedFileId: existing?.contentFileId,
      planFileId,
      scriptVersionId: script.id,
    });
    return { id: saved.id, usdMicros };
  },
});
export const generate = action({
  args: {
    projectId: v.id("projects"),
    maxCostUsdMicros: v.optional(v.number()),
    quoteId: v.optional(v.id("usageQuotes")),
    prompt: v.optional(v.string()),
    durationSec: v.number(),
    resolution: v.string(),
    stagingId: v.optional(v.id("workspaceStaging")),
    kind: v.optional(v.string()),
    parentAssetId: v.optional(v.id("assets")),
    requestId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    jobId: Id<"generationJobs">;
    estimatedCostUsdMicros: number;
  }> => {
    await access(ctx, args.projectId);
    await initializeProject(ctx, args.projectId);
    const project = await ctx.runQuery(api.projects.get, {
      projectId: args.projectId,
    });
    if (!project) throw new Error("Project not found");
    const script = await ctx.runAction(api.workspace.script, {
      projectId: args.projectId,
    });
    const assets = await ctx.runQuery(api.assets.list, {
      projectId: args.projectId,
    });
    const text = args.prompt ?? script.text;
    const resolved = resolveReferences(
      text,
      project.referenceBindings ?? [],
      assets.map((a) => ({ assetId: a._id, name: a.name, type: a.type })),
    );
    if (resolved.ambiguous.length || resolved.unresolved.length)
      throw new Error("Link all script references before generating");
    if (resolved.videoIds.length > 1)
      throw new Error("This model supports one reference video");
    let referenceVideoAssetId = resolved.videoIds[0] as
      Id<"assets"> | undefined;
    if (args.stagingId) {
      const staging = await ctx.runQuery(api.workspace.stagingRecord, {
        id: args.stagingId,
      });
      if (
        !staging ||
        staging.projectId !== args.projectId ||
        !staging.previzAssetId
      )
        throw new Error("Export staging to a previsualization video first");
      if (referenceVideoAssetId)
        throw new Error("Choose either staging or a script video reference");
      referenceVideoAssetId = staging.previzAssetId;
    }
    return ctx.runAction(api.generation.startGeneration, {
      maxCostUsdMicros: args.maxCostUsdMicros,
      quoteId: args.quoteId,
      projectId: args.projectId,
      requestId: args.requestId,
      kind: args.kind ?? "text-to-video",
      adapterId: "seedance-2.5",
      prompt: resolved.prompt,
      referenceAssetIds: [
        ...new Set([
          ...resolved.imageIds,
          ...(project.styleReferenceAssetId
            ? [project.styleReferenceAssetId]
            : []),
        ]),
      ] as Id<"assets">[],
      referenceVideoAssetId,
      parentAssetIds: args.parentAssetId ? [args.parentAssetId] : undefined,
      input: {
        durationSec: args.durationSec,
        resolution: args.resolution,
        aspectRatio: project.aspectRatio,
        scriptVersionId: script.id,
        stagingId: args.stagingId,
      },
    });
  },
});

export const createTemplate = action({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  handler: async (ctx, args): Promise<{ projectId: Id<"projects"> }> => {
    const projectId = await ctx.runMutation(api.projects.create, {
      workspaceId: args.workspaceId,
      title: "Starter: 30s Trailer",
      targetLengthSec: 30,
    });
    await initializeProject(ctx, projectId);
    await ctx.runMutation(internal.workspace.markTemplate, { projectId });
    const script = await ctx.runAction(api.workspace.script, { projectId });
    await ctx.runMutation(api.workspace.saveScript, {
      projectId,
      expectedId: script.id,
      text: "Warm morning light in a corner café. Maya waits by the window. Jordan arrives, breathless.\n\nMAYA: You're late again.\nJORDAN: Traffic. I know.\nMAYA: Walk with me.\n\nThey step onto the wet sidewalk. Rain beads on the awning.",
    });
    return { projectId };
  },
});
export const stagingHistory = action({
  args: { id: v.id("workspaceStaging") },
  handler: async (
    ctx,
    { id },
  ): Promise<
    Array<{ fileId: Id<"_storage">; version: number; name: string }>
  > => {
    const row = await ctx.runQuery(api.workspace.stagingRecord, { id });
    if (!row) throw new Error("Staging not found");
    const versions: Array<{
      fileId: Id<"_storage">;
      version: number;
      name: string;
    }> = [];
    const seen = new Set<string>();
    let cursor: Id<"_storage"> | undefined = row.contentFileId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const document = await loadJson<BlockoutDocument>(ctx, cursor);
      versions.push({
        fileId: cursor,
        version: document.version,
        name: document.name,
      });
      cursor = document.parentFileId as Id<"_storage"> | undefined;
      if (versions.length >= 1000) break;
    }
    return versions;
  },
});
export const restoreStaging = action({
  args: { id: v.id("workspaceStaging"), fileId: v.id("_storage") },
  handler: async (
    ctx,
    args,
  ): Promise<{ id: Id<"workspaceStaging">; fileId: Id<"_storage"> }> => {
    const row = await ctx.runQuery(api.workspace.stagingRecord, {
      id: args.id,
    });
    if (!row) throw new Error("Staging not found");
    const history = await ctx.runAction(api.workspace.stagingHistory, {
      id: args.id,
    });
    if (!history.some((version) => version.fileId === args.fileId))
      throw new Error("Version is not part of this staging document");
    const project = await ctx.runQuery(api.projects.get, {
      projectId: row.projectId,
    });
    if (!project) throw new Error("Project not found");
    const document = migrateToV2(await loadJson(ctx, args.fileId), {
      project: {
        id: project._id,
        title: project.title,
        aspectRatio: project.aspectRatio,
        fps: project.fps,
      },
    });
    const metadata = row.planHistory?.find(
      (version) => version.contentFileId === args.fileId,
    );
    return persistStaging(ctx, {
      clearPlan: !metadata?.planFileId,
      clearScript: !metadata?.scriptVersionId,
      planFileId: metadata?.planFileId,
      scriptVersionId: metadata?.scriptVersionId,
      projectId: row.projectId,
      id: row._id,
      document,
      expectedFileId: row.contentFileId,
    });
  },
});
