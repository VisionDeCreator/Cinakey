/**
 * Storage module — the ONLY place that may call Convex file storage APIs.
 *
 * Nothing else in the codebase (queries, mutations, actions, or the frontend)
 * may call `ctx.storage.*` directly. Route all file reads/writes through this
 * module so storage can later move to Cloudflare R2 by changing this file only.
 *
 * Large JSON (blockouts, Theatre.js state, timeline snapshots) is always stored
 * as files; the database row holds only the storage ID. Documents must stay
 * well under Convex's 1 MiB limit — never embed large payloads inline.
 */

import { requireProjectAccess, requireUser } from "./lib/access";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";

type StorageCtx = MutationCtx | ActionCtx;
type ReadCtx = QueryCtx | MutationCtx | ActionCtx;

/** Soft cap for JSON blobs stored as files (not the 1 MiB document limit). */
export const MAX_JSON_BYTES = 5 * 1024 * 1024;

/** Documents must stay well under Convex's 1 MiB limit. */
export const MAX_DOCUMENT_JSON_BYTES = 512 * 1024;

export async function generateUploadUrl(ctx: StorageCtx): Promise<string> {
  return await ctx.storage.generateUploadUrl();
}

export async function saveFile(
  ctx: ActionCtx,
  blob: Blob,
): Promise<Id<"_storage">> {
  return await ctx.storage.store(blob);
}

export async function getFileUrl(
  ctx: ReadCtx,
  storageId: Id<"_storage">,
): Promise<string | null> {
  return await ctx.storage.getUrl(storageId);
}

export async function deleteFile(
  ctx: StorageCtx,
  storageId: Id<"_storage">,
): Promise<void> {
  await ctx.storage.delete(storageId);
}

export async function getStorageMeta(
  ctx: MutationCtx | QueryCtx,
  storageId: Id<"_storage">,
): Promise<{ size: number; contentType?: string } | null> {
  const meta = await ctx.db.system.get(storageId);
  if (meta === null) {
    return null;
  }
  return {
    size: meta.size,
    contentType: meta.contentType ?? undefined,
  };
}

/**
 * Serialize JSON to a Blob and store it. Rejects payloads that would be unsafe
 * to ever embed in a Convex document, and hard-caps file size.
 */
export async function saveJson(
  ctx: ActionCtx,
  value: unknown,
): Promise<{ storageId: Id<"_storage">; sizeBytes: number }> {
  const text = JSON.stringify(value);
  const sizeBytes = new TextEncoder().encode(text).byteLength;

  if (sizeBytes > MAX_JSON_BYTES) {
    throw new Error(
      `JSON payload too large (${sizeBytes} bytes; max ${MAX_JSON_BYTES})`,
    );
  }
  // Always store as a file — never put this body on a document field.
  if (sizeBytes > MAX_DOCUMENT_JSON_BYTES) {
    // Still allowed as a file; callers must only store the returned ID on docs.
  }

  const blob = new Blob([text], { type: "application/json" });
  const storageId = await ctx.storage.store(blob);
  return { storageId, sizeBytes };
}

/**
 * Load and parse a JSON file from storage.
 */
export async function loadJson<T = unknown>(
  ctx: ActionCtx,
  storageId: Id<"_storage">,
): Promise<T> {
  const blob = await ctx.storage.get(storageId);
  if (blob === null) {
    throw new Error("JSON file not found");
  }
  const text = await blob.text();
  return JSON.parse(text) as T;
}

/** Pure helper for tests: estimate UTF-8 byte length of a JSON value. */
export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Pure helper for tests: whether a payload must be stored as a file. */
export function mustStoreAsFile(sizeBytes: number): boolean {
  return sizeBytes > 0; // always store JSON payloads as files
}

export function assertJsonWithinLimits(sizeBytes: number): void {
  if (sizeBytes > MAX_JSON_BYTES) {
    throw new Error(
      `JSON payload too large (${sizeBytes} bytes; max ${MAX_JSON_BYTES})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public Convex functions (upload / assets)
// ---------------------------------------------------------------------------

const assetType = v.union(
  v.literal("video"),
  v.literal("image"),
  v.literal("audio"),
  v.literal("music"),
  v.literal("logo"),
  v.literal("json"),
  v.literal("other"),
);

/** Server-side JSON save (actions only — uses ctx.storage.store). */
export const storeJson = action({
  args: { value: v.any() },
  handler: async (ctx, args) => {
    const { getAuthUserId } = await import("@convex-dev/auth/server");
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }
    return await saveJson(ctx, args.value);
  },
});

export const createUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await generateUploadUrl(ctx);
  },
});

export const createAssetFromUpload = mutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    type: assetType,
    format: v.optional(v.string()),
    sceneId: v.optional(v.id("scenes")),
    shotId: v.optional(v.id("shots")),
    jobId: v.optional(v.id("generationJobs")),
    tags: v.optional(v.array(v.string())),
    durationSec: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    lineage: v.optional(
      v.object({
        prompt: v.optional(v.string()),
        model: v.optional(v.string()),
        modelVersion: v.optional(v.string()),
        seed: v.optional(v.number()),
        parentAssetIds: v.optional(v.array(v.id("assets"))),
        referenceAssetIds: v.optional(v.array(v.id("assets"))),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await requireProjectAccess(ctx, args.projectId);

    const meta = await getStorageMeta(ctx, args.storageId);
    if (meta === null) {
      throw new Error("Uploaded file not found");
    }

    const now = Date.now();
    const assetId = await ctx.db.insert("assets", {
      projectId: args.projectId,
      sceneId: args.sceneId,
      shotId: args.shotId,
      jobId: args.jobId,
      type: args.type,
      storageId: args.storageId,
      format: args.format ?? meta.contentType ?? "application/octet-stream",
      sizeBytes: meta.size,
      durationSec: args.durationSec,
      width: args.width,
      height: args.height,
      tags: args.tags ?? [],
      lineage: args.lineage,
      starred: false,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    return assetId;
  },
});

const lineageValidator = v.object({
  prompt: v.optional(v.string()),
  model: v.optional(v.string()),
  modelVersion: v.optional(v.string()),
  seed: v.optional(v.number()),
  parentAssetIds: v.optional(v.array(v.id("assets"))),
  referenceAssetIds: v.optional(v.array(v.id("assets"))),
});

/**
 * Internal: create an asset from a storage blob produced by a generation job.
 * Called from the job runner (no end-user auth on the action ctx).
 */
export const createAssetFromGeneration = internalMutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    type: assetType,
    format: v.string(),
    sizeBytes: v.number(),
    createdBy: v.id("users"),
    jobId: v.id("generationJobs"),
    shotId: v.optional(v.id("shots")),
    sceneId: v.optional(v.id("scenes")),
    durationSec: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    lineage: v.optional(lineageValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("assets", {
      projectId: args.projectId,
      sceneId: args.sceneId,
      shotId: args.shotId,
      jobId: args.jobId,
      type: args.type,
      storageId: args.storageId,
      format: args.format,
      sizeBytes: args.sizeBytes,
      durationSec: args.durationSec,
      width: args.width,
      height: args.height,
      tags: [],
      lineage: args.lineage,
      starred: false,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getAssetUrl = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (asset === null) {
      throw new Error("Asset not found");
    }
    await requireProjectAccess(ctx, asset.projectId);
    return await getFileUrl(ctx, asset.storageId);
  },
});

export const getAsset = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (asset === null) {
      return null;
    }
    await requireProjectAccess(ctx, asset.projectId);
    return asset;
  },
});

export const listProjectAssets = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    return await ctx.db
      .query("assets")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const deleteAsset = mutation({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (asset === null) {
      throw new Error("Asset not found");
    }
    await requireProjectAccess(ctx, asset.projectId);
    await deleteFile(ctx, asset.storageId);
    await ctx.db.delete(args.assetId);
  },
});
