/**
 * Takes: list, select, rate, attach proxy, purge rejected.
 */

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { TAKE_PURGE_AFTER_MS } from "./lib/limits";
import { deleteFile, getFileUrl } from "./storage";
import type { Id } from "./_generated/dataModel";

export const listByShot = query({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) return [];
    await requireProjectAccess(ctx, shot.projectId);
    const takes = await ctx.db
      .query("takes")
      .withIndex("by_shot", (q) => q.eq("shotId", args.shotId))
      .collect();
    takes.sort((a, b) => b.createdAt - a.createdAt);

    return await Promise.all(
      takes.map(async (take) => {
        const asset = await ctx.db.get(take.assetId);
        const proxy = take.proxyAssetId
          ? await ctx.db.get(take.proxyAssetId)
          : null;
        const assetUrl = asset
          ? await getFileUrl(ctx, asset.storageId)
          : null;
        const proxyUrl = proxy
          ? await getFileUrl(ctx, proxy.storageId)
          : null;
        return {
          ...take,
          asset,
          proxy,
          assetUrl,
          proxyUrl,
          playbackUrl: proxyUrl ?? assetUrl,
        };
      }),
    );
  },
});

export const listBySequence = query({
  args: { sequenceId: v.id("sequences") },
  handler: async (ctx, args) => {
    const sequence = await ctx.db.get(args.sequenceId);
    if (sequence === null) return [];
    await requireProjectAccess(ctx, sequence.projectId);
    const shots = await ctx.db
      .query("shots")
      .withIndex("by_sequence", (q) => q.eq("sequenceId", args.sequenceId))
      .collect();
    const results = [];
    for (const shot of shots) {
      const takes = await ctx.db
        .query("takes")
        .withIndex("by_shot", (q) => q.eq("shotId", shot._id))
        .collect();
      for (const take of takes) {
        results.push({ ...take, shotOrder: shot.order, shotId: shot._id });
      }
    }
    return results;
  },
});

export const getSelectedForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const shots = await ctx.db
      .query("shots")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const out: Array<{
      shotId: Id<"shots">;
      takeId: Id<"takes">;
      thumbUrl: string | null;
    }> = [];
    for (const shot of shots) {
      if (!shot.selectedTakeId) continue;
      const take = await ctx.db.get(shot.selectedTakeId);
      if (!take) continue;
      const assetId = take.proxyAssetId ?? take.assetId;
      const asset = await ctx.db.get(assetId);
      const thumbUrl = asset ? await getFileUrl(ctx, asset.storageId) : null;
      out.push({ shotId: shot._id, takeId: take._id, thumbUrl });
    }
    return out;
  },
});

/**
 * Selected takes enriched for "assemble from shot list" and linked clip swap.
 */
export const listSelectedForAssemble = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const sceneOrder = new Map(
      scenes.map((s) => [s._id, s.order] as const),
    );
    const shots = await ctx.db
      .query("shots")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const out: Array<{
      shotId: Id<"shots">;
      sceneId: Id<"scenes">;
      sceneOrder: number;
      shotOrder: number;
      durationSec: number;
      dialogueLineId?: string;
      dialogue?: string;
      selectedTakeId: Id<"takes">;
      take: {
        takeId: Id<"takes">;
        assetId: Id<"assets">;
        proxyAssetId?: Id<"assets">;
        trimStartSec?: number;
        trimEndSec?: number;
        mediaDurationSec?: number;
        assetUrl: string | null;
        proxyUrl: string | null;
        playbackUrl: string | null;
      };
    }> = [];

    for (const shot of shots) {
      if (!shot.selectedTakeId) continue;
      const take = await ctx.db.get(shot.selectedTakeId);
      if (!take) continue;
      const asset = await ctx.db.get(take.assetId);
      const proxy = take.proxyAssetId
        ? await ctx.db.get(take.proxyAssetId)
        : null;
      const assetUrl = asset
        ? await getFileUrl(ctx, asset.storageId)
        : null;
      const proxyUrl = proxy
        ? await getFileUrl(ctx, proxy.storageId)
        : null;
      out.push({
        shotId: shot._id,
        sceneId: shot.sceneId,
        sceneOrder: sceneOrder.get(shot.sceneId) ?? 0,
        shotOrder: shot.order,
        durationSec: shot.durationSec,
        dialogueLineId: shot.dialogueLineId,
        dialogue: shot.dialogue,
        selectedTakeId: take._id,
        take: {
          takeId: take._id,
          assetId: take.assetId,
          proxyAssetId: take.proxyAssetId,
          trimStartSec: take.trimStartSec,
          trimEndSec: take.trimEndSec,
          mediaDurationSec: asset?.durationSec,
          assetUrl,
          proxyUrl,
          playbackUrl: proxyUrl ?? assetUrl,
        },
      });
    }

    out.sort((a, b) => {
      if (a.sceneOrder !== b.sceneOrder) return a.sceneOrder - b.sceneOrder;
      return a.shotOrder - b.shotOrder;
    });
    return out;
  },
});
export const selectTake = mutation({
  args: { takeId: v.id("takes") },
  handler: async (ctx, args) => {
    const take = await ctx.db.get(args.takeId);
    if (take === null) throw new Error("Take not found");
    await requireProjectAccess(ctx, take.projectId);

    const siblings = await ctx.db
      .query("takes")
      .withIndex("by_shot", (q) => q.eq("shotId", take.shotId))
      .collect();
    for (const sib of siblings) {
      if (sib.selected && sib._id !== take._id) {
        await ctx.db.patch(sib._id, { selected: false });
      }
    }
    await ctx.db.patch(take._id, { selected: true });
    const now = Date.now();
    await ctx.db.patch(take.shotId, {
      selectedTakeId: take._id,
      status: "selected",
      updatedAt: now,
    });
    return take._id;
  },
});

export const rateTake = mutation({
  args: {
    takeId: v.id("takes"),
    rating: v.number(),
  },
  handler: async (ctx, args) => {
    const take = await ctx.db.get(args.takeId);
    if (take === null) throw new Error("Take not found");
    await requireProjectAccess(ctx, take.projectId);
    const rating = Math.max(1, Math.min(5, Math.round(args.rating)));
    await ctx.db.patch(take._id, { rating });
  },
});

export const attachTakeProxy = mutation({
  args: {
    takeId: v.id("takes"),
    proxyAssetId: v.id("assets"),
    clippedAssetId: v.optional(v.id("assets")),
  },
  handler: async (ctx, args) => {
    const take = await ctx.db.get(args.takeId);
    if (take === null) throw new Error("Take not found");
    await requireProjectAccess(ctx, take.projectId);
    const proxy = await ctx.db.get(args.proxyAssetId);
    if (proxy === null || proxy.projectId !== take.projectId) {
      throw new Error("Proxy asset not found");
    }
    const patch: {
      proxyAssetId: Id<"assets">;
      assetId?: Id<"assets">;
    } = { proxyAssetId: args.proxyAssetId };
    if (args.clippedAssetId !== undefined) {
      const clipped = await ctx.db.get(args.clippedAssetId);
      if (clipped === null || clipped.projectId !== take.projectId) {
        throw new Error("Clipped asset not found");
      }
      patch.assetId = args.clippedAssetId;
    }
    await ctx.db.patch(take._id, patch);
  },
});

export const starTakeAsset = mutation({
  args: {
    takeId: v.id("takes"),
    starred: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const take = await ctx.db.get(args.takeId);
    if (take === null) throw new Error("Take not found");
    await requireProjectAccess(ctx, take.projectId);
    await ctx.db.patch(take.assetId, {
      starred: args.starred,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Purge unselected, unstarred takes older than TAKE_PURGE_AFTER_MS.
 * Starred assets and selected takes are kept.
 */
export const purgeRejectedTakes = internalMutation({
  args: {
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const cutoff = now - TAKE_PURGE_AFTER_MS;
    const limit = Math.min(args.limit ?? 50, 200);

    const candidates = await ctx.db
      .query("takes")
      .withIndex("by_created")
      .order("asc")
      .take(500);

    let purged = 0;
    for (const take of candidates) {
      if (purged >= limit) break;
      if (take.createdAt >= cutoff) continue;
      if (take.selected) continue;

      const shot = await ctx.db.get(take.shotId);
      if (shot?.selectedTakeId === take._id) continue;

      const asset = await ctx.db.get(take.assetId);
      if (asset?.starred === true) continue;

      const proxyId = take.proxyAssetId;
      await ctx.db.delete(take._id);

      if (proxyId !== undefined) {
        const proxy = await ctx.db.get(proxyId);
        if (proxy !== null && proxy.starred !== true) {
          await deleteFile(ctx, proxy.storageId);
          await ctx.db.delete(proxyId);
        }
      }

      if (asset !== null) {
        const otherTakes = await ctx.db
          .query("takes")
          .filter((q) => q.eq(q.field("assetId"), asset._id))
          .first();
        if (otherTakes === null) {
          await deleteFile(ctx, asset.storageId);
          await ctx.db.delete(asset._id);
        }
      }

      purged += 1;
    }

    return { purged };
  },
});
