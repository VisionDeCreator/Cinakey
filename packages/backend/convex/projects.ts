import { requireProjectUnpausedAccess } from "./lib/access";
import {
  generationDefaults,
  generationResolution,
  generationAspectRatio,
} from "./lib/generationSettings";
import { requireProjectWrite } from "./lib/access";
import { assertPaymentProduction } from "./lib/paymentAccess";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import {
  requireWorkspaceMembership,
  accessibleWorkspaceIds,
  canAccessProject,
  requireWorkspaceAccess,
  workspaceRole,
  projectAssets,
  projectCanUseAsset,
  requireProjectAccess,
  requireUser,
} from "./lib/access";
import { RATE_LIMITS } from "./lib/limits";
import { markSheetsStaleForStyleChange } from "./lib/promptSheetDeps";
import { assertRateLimit } from "./lib/rateLimit";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";
import { getFileUrl } from "./storage";

const briefValidator = v.object({
  logline: v.string(),
  audience: v.optional(v.string()),
  tone: v.optional(v.string()),
});

const aspectRatioValidator = v.union(
  v.literal("16:9"),
  v.literal("9:16"),
  v.literal("1:1"),
);

export type StageStatus = "empty" | "started";

export type PipelineProgress = {
  assets: StageStatus;
  script: StageStatus;
  blockout: StageStatus;
  video: StageStatus;
  edit: StageStatus;
};

export async function computeProgress(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<PipelineProgress> {
  const [scripts, staging, assets, timeline] = await Promise.all([
    ctx.db
      .query("workspaceScripts")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect(),
    ctx.db
      .query("workspaceStaging")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first(),
    projectAssets(ctx, projectId),
    ctx.db
      .query("timelineVersions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first(),
  ]);
  return {
    assets: assets.length ? "started" : "empty",
    script: scripts.some(
      (script) => script.isTip && (script.text?.trim() || script.contentFileId),
    )
      ? "started"
      : "empty",
    blockout: staging ? "started" : "empty",
    video: assets.some((asset) => asset.type === "video") ? "started" : "empty",
    edit: timeline ? "started" : "empty",
  };
}

async function resolveThumbnailUrl(
  ctx: QueryCtx,
  project: Doc<"projects">,
): Promise<string | null> {
  if (project.thumbnailAssetId !== undefined) {
    const asset = await ctx.db.get(project.thumbnailAssetId);
    if (asset !== null) {
      return await getFileUrl(ctx, asset.storageId);
    }
  }

  const assets = (await projectAssets(ctx, project._id)).filter(
    (a) => a.type === "image",
  );
  const first = assets.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (first === undefined) {
    return null;
  }
  return await getFileUrl(ctx, first.storageId);
}

export const listMine = query({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const includeArchived = args.includeArchived === true;
    if (args.workspaceId)
      await requireWorkspaceMembership(ctx, args.workspaceId);
    const workspaceIds = args.workspaceId
      ? [args.workspaceId]
      : await accessibleWorkspaceIds(ctx, user);
    const allProjects = (
      await Promise.all(
        workspaceIds.map((workspaceId) =>
          ctx.db
            .query("projects")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
            .collect(),
        ),
      )
    ).flat();
    const projects = [];
    for (const project of allProjects)
      if (await canAccessProject(ctx, project, user)) projects.push(project);

    const visible = projects
      .filter(
        (p) =>
          p.purpose !== "genjutsu" &&
          (includeArchived || p.archivedAt === undefined),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return await Promise.all(
      visible.map(async (project) => ({
        project,
        thumbnailUrl: await resolveThumbnailUrl(ctx, project),
        progress: await computeProgress(ctx, project._id),
      })),
    );
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    try {
      const project = await requireProjectAccess(ctx, args.projectId);
      return project.purpose === "genjutsu" ? null : project;
    } catch {
      return null;
    }
  },
});

export const create = mutation({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    title: v.string(),
    brief: v.optional(briefValidator),
    aspectRatio: v.optional(aspectRatioValidator),
    fps: v.optional(v.number()),
    targetLengthSec: v.optional(v.number()),
    styleNotes: v.optional(v.string()),
    rules: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await assertRateLimit(
      ctx,
      `createProject:${user._id}`,
      RATE_LIMITS.createProject.limit,
      RATE_LIMITS.createProject.windowMs,
    );
    const workspaceId =
      args.workspaceId ?? (await ensurePersonalWorkspaceForUser(ctx, user._id));
    const role = await workspaceRole(ctx, workspaceId, user._id);
    if (!role || role === "reviewer")
      throw new Error("Workspace access denied");
    await assertPaymentProduction(ctx, workspaceId);
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      workspaceId,
      title: args.title.trim(),
      brief: args.brief,
      aspectRatio: args.aspectRatio ?? "16:9",
      fps: args.fps ?? 24,
      targetLengthSec: args.targetLengthSec,
      styleNotes: args.styleNotes,
      rules: args.rules ?? [],
      createdAt: now,
      updatedAt: now,
    });
    if (role === "creator")
      await ctx.db.insert("productionAssignments", {
        workspaceId,
        userId: user._id,
        projectId,
        manageReviews: false,
      });
    return projectId;
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.optional(v.string()),
    brief: v.optional(briefValidator),
    aspectRatio: v.optional(aspectRatioValidator),
    fps: v.optional(v.number()),
    targetLengthSec: v.optional(v.number()),
    styleNotes: v.optional(v.string()),
    rules: v.optional(v.array(v.string())),
    thumbnailAssetId: v.optional(v.id("assets")),
    styleReferenceAssetId: v.optional(v.union(v.id("assets"), v.null())),
    spendCapUsdMicros: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectWrite(ctx, args.projectId);
    if (args.spendCapUsdMicros !== undefined) {
      await requireWorkspaceAccess(ctx, project.workspaceId);
      if (
        args.spendCapUsdMicros !== null &&
        (!Number.isSafeInteger(args.spendCapUsdMicros) ||
          args.spendCapUsdMicros < 0)
      )
        throw new Error("Budget must be a non-negative integer");
    }
    for (const assetId of [args.thumbnailAssetId, args.styleReferenceAssetId]) {
      if (assetId && !(await projectCanUseAsset(ctx, args.projectId, assetId)))
        throw new Error("Reference is not available in this project");
    }
    const patch: {
      title?: string;
      brief?: {
        logline: string;
        audience?: string;
        tone?: string;
      };
      aspectRatio?: string;
      fps?: number;
      targetLengthSec?: number;
      styleNotes?: string;
      rules?: string[];
      thumbnailAssetId?: Id<"assets">;
      styleReferenceAssetId?: Id<"assets"> | undefined;
      spendCapUsdMicros?: number | undefined;
      updatedAt: number;
    } = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.brief !== undefined) patch.brief = args.brief;
    if (args.aspectRatio !== undefined) patch.aspectRatio = args.aspectRatio;
    if (args.fps !== undefined) patch.fps = args.fps;
    if (args.targetLengthSec !== undefined) {
      patch.targetLengthSec = args.targetLengthSec;
    }
    if (args.styleNotes !== undefined) patch.styleNotes = args.styleNotes;
    if (args.rules !== undefined) patch.rules = args.rules;
    if (args.thumbnailAssetId !== undefined) {
      patch.thumbnailAssetId = args.thumbnailAssetId;
    }
    if (args.styleReferenceAssetId !== undefined) {
      patch.styleReferenceAssetId =
        args.styleReferenceAssetId === null
          ? undefined
          : args.styleReferenceAssetId;
    }
    if (args.spendCapUsdMicros !== undefined) {
      patch.spendCapUsdMicros =
        args.spendCapUsdMicros === null ? undefined : args.spendCapUsdMicros;
    }
    await ctx.db.patch(args.projectId, patch);

    if (
      args.styleReferenceAssetId !== undefined &&
      args.styleReferenceAssetId !== null
    ) {
      await markSheetsStaleForStyleChange(ctx, args.projectId);
    }
  },
});

export const archive = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectUnpausedAccess(ctx, args.projectId);
    const now = Date.now();
    await ctx.db.patch(args.projectId, {
      archivedAt: now,
      updatedAt: now,
    });
  },
});

export const unarchive = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectUnpausedAccess(ctx, args.projectId);
    await ctx.db.patch(args.projectId, {
      archivedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const duplicate = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const source = await requireProjectWrite(ctx, args.projectId);
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      workspaceId: source.workspaceId,
      title: `${source.title} (copy)`,
      generationSettings: {
        ...generationDefaults(source),
        stagingId: undefined,
        useStaging: false,
      },
      brief: source.brief,
      aspectRatio: source.aspectRatio,
      fps: source.fps,
      targetLengthSec: source.targetLengthSec,
      styleNotes: source.styleNotes,
      rules: [...source.rules],
      createdAt: now,
      updatedAt: now,
    });
    const user = await requireUser(ctx);
    if ((await workspaceRole(ctx, source.workspaceId, user._id)) === "creator")
      await ctx.db.insert("productionAssignments", {
        workspaceId: source.workspaceId,
        userId: user._id,
        projectId,
        manageReviews: false,
      });
    return projectId;
  },
});

/** Reading preferences never writes defaults into legacy projects. */
export const generationSettings = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await requireProjectAccess(ctx, projectId);
    return { ...generationDefaults(project), revision: project.updatedAt };
  },
});

/** Patch only changed preferences so concurrent edits to unrelated fields survive. */
export const saveGenerationSettings = mutation({
  args: {
    projectId: v.id("projects"),
    resolution: v.optional(generationResolution),
    durationSec: v.optional(v.number()),
    aspectRatio: v.optional(generationAspectRatio),
    stagingId: v.optional(v.union(v.id("workspaceStaging"), v.null())),
    useStaging: v.optional(v.boolean()),
  },
  handler: async (ctx, { projectId, ...changes }) => {
    const project = await requireProjectWrite(ctx, projectId);
    const settings = { ...generationDefaults(project) };
    if (changes.resolution !== undefined)
      settings.resolution = changes.resolution;
    if (changes.durationSec !== undefined)
      settings.durationSec = changes.durationSec;
    if (changes.aspectRatio !== undefined)
      settings.aspectRatio = changes.aspectRatio;
    if (changes.useStaging !== undefined)
      settings.useStaging = changes.useStaging;
    if (changes.stagingId !== undefined) {
      if (changes.stagingId === null) {
        delete settings.stagingId;
        settings.useStaging = false;
      } else settings.stagingId = changes.stagingId;
    }
    if (
      !Number.isInteger(settings.durationSec) ||
      settings.durationSec < 4 ||
      settings.durationSec > 30
    )
      throw new Error(
        "Generation duration must be a whole number from 4 to 30 seconds.",
      );
    if (settings.stagingId) {
      const staging = await ctx.db.get(settings.stagingId);
      if (!staging || staging.projectId !== projectId)
        throw new Error("Staging is not available in this project.");
      if (settings.useStaging && !staging.previzAssetId)
        throw new Error("Export staging to a previsualization video first");
    } else if (settings.useStaging)
      throw new Error("Choose a staging reference first.");
    const revision = Math.max(Date.now(), project.updatedAt + 1);
    await ctx.db.patch(projectId, {
      generationSettings: settings,
      updatedAt: revision,
    });
    return { ...settings, revision };
  },
});
