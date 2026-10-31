import { requireSeriesUnpausedAccess } from "./lib/access";
import { requireProjectWrite, requireSeriesWrite } from "./lib/access";
import { startProductionTrial } from "./lib/paymentAccess";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  requireWorkspaceMembership,
  requireWorkspaceAccess,
  accessibleWorkspaceIds,
  workspaceRole,
  requireProjectAccess,
  requireSeriesAccess,
  requireUser,
} from "./lib/access";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";

const aspect = v.union(v.literal("16:9"), v.literal("9:16"), v.literal("1:1"));
function title(value: string) {
  const result = value.trim();
  if (!result || result.length > 200)
    throw new Error("Name must be 1–200 characters");
  return result;
}
export const list = query({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.workspaceId)
      await requireWorkspaceMembership(ctx, args.workspaceId);
    const rows = [];
    for (const workspaceId of args.workspaceId
      ? [args.workspaceId]
      : await accessibleWorkspaceIds(ctx, user)) {
      const role = await workspaceRole(ctx, workspaceId, user._id);
      if (role === "owner" || role === "admin")
        rows.push(
          ...(await ctx.db
            .query("series")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
            .collect()),
        );
    }
    return rows
      .filter((s) => args.includeArchived || !s.archivedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
export const get = query({
  args: { seriesId: v.id("series") },
  handler: async (ctx, args) => {
    const series = await requireSeriesAccess(ctx, args.seriesId);
    const episodes = await ctx.db
      .query("projects")
      .withIndex("by_series", (q) => q.eq("seriesId", args.seriesId))
      .collect();
    return {
      series,
      episodes: episodes.sort(
        (a, b) => (a.episodeOrder ?? 0) - (b.episodeOrder ?? 0),
      ),
    };
  },
});
export const create = mutation({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    title: v.string(),
    description: v.optional(v.string()),
    aspectRatio: v.optional(aspect),
    fps: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspaceId =
      args.workspaceId ?? (await ensurePersonalWorkspaceForUser(ctx, user._id));
    await requireWorkspaceAccess(ctx, workspaceId);
    await startProductionTrial(ctx, workspaceId, user._id);
    if (args.fps !== undefined && ![24, 25, 30, 60].includes(args.fps))
      throw new Error("Unsupported frame rate");
    const now = Date.now();
    return ctx.db.insert("series", {
      workspaceId,
      title: title(args.title),
      description: args.description ?? "",
      aspectRatio: args.aspectRatio ?? "16:9",
      fps: args.fps ?? 24,
      styleNotes: "",
      rules: [],
      settingsVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});
export const update = mutation({
  args: {
    seriesId: v.id("series"),
    title: v.string(),
    description: v.string(),
    aspectRatio: aspect,
    fps: v.number(),
    styleNotes: v.string(),
    rules: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const series = await requireSeriesWrite(ctx, args.seriesId);
    if (![24, 25, 30, 60].includes(args.fps))
      throw new Error("Unsupported frame rate");
    if (
      args.description.length > 10_000 ||
      args.styleNotes.length > 20_000 ||
      args.rules.length > 100 ||
      args.rules.some((rule) => rule.length > 1000)
    )
      throw new Error("Series settings exceed the supported size");
    const { seriesId, ...settings } = args;
    await ctx.db.patch(seriesId, {
      ...settings,
      title: title(args.title),
      settingsVersion: series.settingsVersion + 1,
      updatedAt: Date.now(),
    });
  },
});
export const setArchived = mutation({
  args: { seriesId: v.id("series"), archived: v.boolean() },
  handler: async (ctx, args) => {
    await requireSeriesUnpausedAccess(ctx, args.seriesId);
    await ctx.db.patch(args.seriesId, {
      archivedAt: args.archived ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
  },
});
export const createEpisode = mutation({
  args: {
    seriesId: v.id("series"),
    title: v.string(),
    episodeNumber: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existing = await requireSeriesAccess(ctx, args.seriesId);
    await startProductionTrial(ctx, existing.workspaceId, user._id);
    const series = await requireSeriesWrite(ctx, args.seriesId);
    if (series.archivedAt)
      throw new Error("Restore this series before creating episodes");
    const episodes = await ctx.db
      .query("projects")
      .withIndex("by_series", (q) => q.eq("seriesId", args.seriesId))
      .collect();
    const number =
      args.episodeNumber ??
      Math.max(0, ...episodes.map((e) => e.episodeNumber ?? 0)) + 1;
    if (
      !Number.isSafeInteger(number) ||
      number < 1 ||
      episodes.some((e) => e.episodeNumber === number)
    )
      throw new Error("Episode number must be a unique positive integer");
    const now = Date.now();
    return ctx.db.insert("projects", {
      workspaceId: series.workspaceId,
      seriesId: series._id,
      episodeNumber: number,
      episodeOrder:
        Math.max(0, ...episodes.map((e) => e.episodeOrder ?? 0)) + 1,
      seriesSettingsVersion: series.settingsVersion,
      title: title(args.title),
      aspectRatio: series.aspectRatio,
      fps: series.fps,
      styleNotes: series.styleNotes,
      rules: [...series.rules],
      createdAt: now,
      updatedAt: now,
    });
  },
});
export const setMembership = mutation({
  args: {
    projectId: v.id("projects"),
    seriesId: v.union(v.id("series"), v.null()),
    episodeNumber: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectWrite(ctx, args.projectId);
    if (project.purpose === "genjutsu")
      throw new Error("Transformation sessions cannot become series episodes");
    if (args.seriesId === null) {
      await ctx.db.patch(project._id, {
        seriesId: undefined,
        episodeNumber: undefined,
        episodeOrder: undefined,
        seriesSettingsVersion: undefined,
        updatedAt: Date.now(),
      });
      return;
    }
    const series = await requireSeriesWrite(ctx, args.seriesId);
    if (series.workspaceId !== project.workspaceId)
      throw new Error("Series and episode must belong to the same workspace");
    if (project.seriesId && project.seriesId !== series._id)
      throw new Error("Detach this episode before moving it to another series");
    if (series.archivedAt) throw new Error("Restore this series first");
    const episodes = await ctx.db
      .query("projects")
      .withIndex("by_series", (q) => q.eq("seriesId", series._id))
      .collect();
    const number =
      args.episodeNumber ??
      project.episodeNumber ??
      Math.max(0, ...episodes.map((e) => e.episodeNumber ?? 0)) + 1;
    if (
      !Number.isSafeInteger(number) ||
      number < 1 ||
      episodes.some((e) => e._id !== project._id && e.episodeNumber === number)
    )
      throw new Error("Episode number must be a unique positive integer");
    await ctx.db.patch(project._id, {
      seriesId: series._id,
      episodeNumber: number,
      episodeOrder:
        project.episodeOrder ??
        Math.max(0, ...episodes.map((e) => e.episodeOrder ?? 0)) + 1,
      updatedAt: Date.now(),
    });
  },
});
export const reorderEpisodes = mutation({
  args: { seriesId: v.id("series"), projectIds: v.array(v.id("projects")) },
  handler: async (ctx, args) => {
    await requireSeriesWrite(ctx, args.seriesId);
    const episodes = await ctx.db
      .query("projects")
      .withIndex("by_series", (q) => q.eq("seriesId", args.seriesId))
      .collect();
    if (
      new Set(args.projectIds).size !== episodes.length ||
      args.projectIds.length !== episodes.length ||
      episodes.some((e) => !args.projectIds.includes(e._id))
    )
      throw new Error("Provide each episode exactly once");
    for (let i = 0; i < args.projectIds.length; i++)
      await ctx.db.patch(args.projectIds[i]!, {
        episodeOrder: i + 1,
        updatedAt: Date.now(),
      });
  },
});
export const applyDefaults = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await requireProjectWrite(ctx, args.projectId);
    if (!project.seriesId) throw new Error("This is a standalone project");
    const series = await requireSeriesWrite(ctx, project.seriesId);
    // Output dimensions and frame rate stay local once an episode exists: changing them can alter edits.
    await ctx.db.patch(project._id, {
      styleNotes: series.styleNotes,
      rules: [...series.rules],
      seriesSettingsVersion: series.settingsVersion,
      updatedAt: Date.now(),
    });
  },
});

export const forProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await requireProjectAccess(ctx, args.projectId);
    if (!project.seriesId) return null;
    const user = await requireUser(ctx);
    const role = await workspaceRole(ctx, project.workspaceId, user._id);
    if (role !== "owner" && role !== "admin") return null;
    await requireWorkspaceAccess(ctx, project.workspaceId);
    const series = await ctx.db.get(project.seriesId);
    if (!series) return null;
    const episodes = await ctx.db
      .query("projects")
      .withIndex("by_series", (q) => q.eq("seriesId", series._id))
      .collect();
    return {
      series,
      episodes: episodes.sort(
        (a, b) => (a.episodeOrder ?? 0) - (b.episodeOrder ?? 0),
      ),
    };
  },
});
