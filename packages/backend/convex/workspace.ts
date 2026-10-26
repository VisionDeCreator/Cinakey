import { estimateStagingTokens, resolveReferences } from "@cinakey/shared";
import { stagingCredits, stagingUsesLlm } from "./staging";
/** Project-owned creative documents. */
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  projectAssets,
  projectCanUseAsset,
  requireProjectAccess,
} from "./lib/access";
import { getFileUrl } from "./storage";
const projectArgs = { projectId: v.id("projects") };
export const list = query({
  args: projectArgs,
  handler: async (ctx, { projectId }) => {
    await requireProjectAccess(ctx, projectId);
    const scripts = await ctx.db
      .query("workspaceScripts")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const staging = await ctx.db
      .query("workspaceStaging")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return {
      migrated: scripts.some((script) => script.isTip),
      script: scripts.find((s) => s.isTip) ?? null,
      scripts: scripts
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((script) => ({
          _id: script._id,
          label: script.label,
          createdAt: script.createdAt,
          isTip: script.isTip,
        })),
      staging: staging.sort((a, b) => b.updatedAt - a.updatedAt),
    };
  },
});

export const saveScript = mutation({
  args: {
    ...projectArgs,
    text: v.string(),
    expectedId: v.optional(v.id("workspaceScripts")),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectAccess(ctx, args.projectId);
    if (args.text.length > 200000)
      throw new Error("Script exceeds 200,000 characters");
    const rows = await ctx.db
      .query("workspaceScripts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const tip = rows.find((r) => r.isTip);
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
    id: v.optional(v.id("workspaceStaging")),
    name: v.string(),
    contentFileId: v.id("_storage"),
    mediaAssetIds: v.optional(v.array(v.id("assets"))),
    planFileId: v.optional(v.id("_storage")),
    scriptVersionId: v.optional(v.id("workspaceScripts")),
    expectedFileId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { id, expectedFileId, ...args }) => {
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
    await requireProjectAccess(ctx, row.projectId);
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
          model: j.model,
          status: j.status,
          errorMessage: j.errorMessage,
          submissionState: j.submissionState,
          createdAt: j.createdAt,
          estimatedCostCredits: j.estimatedCostCredits,
        })),
    };
  },
});
export const estimateStaging = query({
  args: { ...projectArgs, durationSec: v.number() },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const scripts = await ctx.db
      .query("workspaceScripts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const tip = scripts.find((s) => s.isTip);
    const tokens = estimateStagingTokens(
      tip?.text ?? " ".repeat(80000),
      Math.max(1, Math.ceil(args.durationSec / 5)),
    );
    return {
      llm: stagingUsesLlm(),
      credits: stagingUsesLlm() ? stagingCredits(tokens) : 0,
    };
  },
});

export const spend = query({
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
export const markTemplate = internalMutation({
  args: projectArgs,
  handler: async (ctx, { projectId }) => {
    await ctx.db.patch(projectId, { isStarter: true });
  },
});

export const assertAccess = internalQuery({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    const user = await ctx.db.get(args.userId);
    if (!project || !user) throw new Error("Project or user not found");
    if (!user.isStaff && user.personalWorkspaceId !== project.workspaceId)
      throw new Error("Forbidden");
    return true;
  },
});
export const initialize = internalMutation({
  args: projectArgs,
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("Project not found");
    const tip = await ctx.db
      .query("workspaceScripts")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .filter((q) => q.eq(q.field("isTip"), true))
      .first();
    if (!tip)
      await ctx.db.insert("workspaceScripts", {
        projectId,
        text: "",
        label: "Project script",
        isTip: true,
        createdAt: Date.now(),
      });
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
