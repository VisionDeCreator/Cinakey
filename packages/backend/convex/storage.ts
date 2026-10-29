import { mediaUnavailable, assertMediaNotHeld } from "./lib/mediaControls";
import { makeFunctionReference } from "convex/server";
import { enqueueTask } from "./tasks";
import { requireProjectWrite } from "./lib/access";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  projectAssets,
  projectCanUseAsset,
  requireAssetAccess,
  requireProjectAccess,
  requireUser,
} from "./lib/access";
import { buildSearchText } from "./lib/assetSearch";
import { assertMediaRemovable } from "./lib/mediaProtection";

type StorageCtx = MutationCtx | ActionCtx;

type ReadCtx = QueryCtx | MutationCtx | ActionCtx;

/** Soft cap for JSON blobs stored as files (not the 1 MiB document limit). */
export const MAX_JSON_BYTES = 5 * 1024 * 1024;

/** Documents must stay well under Convex's 1 MiB limit. */
export const MAX_DOCUMENT_JSON_BYTES = 512 * 1024;

export type AssetTypeValue =
  "video" | "image" | "audio" | "music" | "logo" | "json" | "other";

export const ASSET_MAX_BYTES: Record<AssetTypeValue, number> = {
  image: 25 * 1024 * 1024,
  logo: 10 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  music: 50 * 1024 * 1024,
  video: 500 * 1024 * 1024,
  json: 5 * 1024 * 1024,
  other: 25 * 1024 * 1024,
};

export const ASSET_ALLOWED_MIME: Record<AssetTypeValue, readonly string[]> = {
  image: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  logo: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
  audio: ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4"],
  music: ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4"],
  json: ["application/json"],
  other: [],
};

export function validateAssetUpload(
  type: AssetTypeValue,
  sizeBytes: number,
  contentType: string | undefined,
): void {
  const max = ASSET_MAX_BYTES[type];
  if (sizeBytes > max) {
    throw new Error(
      `File too large for ${type} (${sizeBytes} bytes; max ${max})`,
    );
  }
  const allowed = ASSET_ALLOWED_MIME[type];
  if (allowed.length === 0) {
    throw new Error(`Uploads of type "${type}" are not allowed`);
  }
  if (contentType !== undefined && contentType.length > 0) {
    const normalized = contentType.split(";")[0]!.trim().toLowerCase();
    if (!allowed.includes(normalized)) {
      throw new Error(
        `Unsupported content type "${contentType}" for ${type}. Allowed: ${allowed.join(", ")}`,
      );
    }
  }
}

export async function saveFile(
  ctx: ActionCtx,
  blob: Blob,
): Promise<Id<"_storage" | "r2Files">> {
  return await ctx.storage.store(blob);
}

export async function getFileUrl(
  ctx: ReadCtx,
  storageId: Id<"_storage" | "r2Files">,
): Promise<string | null> {
  if ("db" in ctx) {
    if (await mediaUnavailable(ctx, storageId)) return null;
    const id = ctx.db.normalizeId("r2Files", storageId);
    if (id) {
      const file = await ctx.db.get(id);
      return file && !file.deletedAt ? `r2://${id}` : null;
    }
  }
  return await ctx.storage.getUrl(storageId as Id<"_storage">);
}

export async function registerMediaFile(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  storageId: Id<"_storage" | "r2Files">,
  createdBy: Id<"users">,
  format: string,
  sizeBytes: number,
) {
  if (await mediaUnavailable(ctx, storageId))
    throw new Error("Media is quarantined");
  const r2Id = ctx.db.normalizeId("r2Files", storageId);
  if (r2Id) {
    const file = await ctx.db.get(r2Id);
    if (!file || file.deletedAt) throw new Error("File not found");
    if (file.workspaceId && file.workspaceId !== workspaceId)
      throw new Error("File belongs to another workspace");
    if (!file.workspaceId) await ctx.db.patch(r2Id, { workspaceId, createdBy });
  }
  const existing = await ctx.db
    .query("mediaFiles")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  if (existing) {
    if (existing.workspaceId !== workspaceId)
      throw new Error("File belongs to another workspace");
    return existing._id;
  }
  const aliases = await ctx.db
    .query("assets")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .collect();
  for (const asset of aliases) {
    const owner =
      asset.workspaceId ??
      (asset.projectId
        ? (await ctx.db.get(asset.projectId))?.workspaceId
        : undefined);
    if (owner !== workspaceId)
      throw new Error("File belongs to another workspace");
  }
  return ctx.db.insert("mediaFiles", {
    workspaceId,
    storageId,
    createdBy,
    format,
    sizeBytes,
    createdAt: Date.now(),
  });
}

export async function deleteFile(
  ctx: StorageCtx,
  storageId: Id<"_storage" | "r2Files">,
): Promise<void> {
  if ("db" in ctx) {
    await assertMediaNotHeld(ctx, storageId);
    if (
      await ctx.db
        .query("publishedExports")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .first()
    )
      return;
    if (
      await ctx.db
        .query("publishedExports")
        .withIndex("by_staged", (q) => q.eq("stagedStorageId", storageId))
        .first()
    )
      return;
    if (
      await ctx.db
        .query("resourceVersions")
        .withIndex("by_sheet_file", (q) =>
          q.eq("sheetFileId", storageId as Id<"_storage">),
        )
        .first()
    )
      return;
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .collect();
    if (assets.length > 1) return;
    for (const asset of assets) {
      const shared = await ctx.db
        .query("resourceAssetUses")
        .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
        .first();
      const linked = await ctx.db
        .query("projectAssetLinks")
        .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
        .first();
      if (shared || linked) return;
    }
    const files = await ctx.db
      .query("mediaFiles")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .collect();
    for (const file of files) await ctx.db.delete(file._id);
  }
  await deleteStoredFile(ctx, storageId);
}

/** Raw deletion for trusted retention paths that already own the reference lifecycle. */
export async function deleteStoredFile(
  ctx: StorageCtx,
  storageId: Id<"_storage" | "r2Files">,
): Promise<Id<"apiTasks"> | void> {
  if ("db" in ctx) {
    await assertMediaNotHeld(ctx, storageId);
    const id = ctx.db.normalizeId("r2Files", storageId);
    if (id) {
      const file = await ctx.db.get(id);
      if (file && !file.deletedAt) {
        await ctx.db.patch(id, { deletedAt: Date.now() });
        return await enqueueTask(ctx, 0, "r2Storage:deleteObject", {
          id,
          key: file.key,
          bucket: file.bucket,
        });
      }
      return;
    }
    await ctx.storage.delete(storageId as Id<"_storage">);
  } else {
    await ctx.runMutation(
      makeFunctionReference<"mutation">("storageIO:remove"),
      { id: storageId },
    );
  }
}

export async function getStorageMeta(
  ctx: MutationCtx | QueryCtx,
  storageId: Id<"_storage" | "r2Files">,
): Promise<{ size: number; contentType?: string } | null> {
  const r2Id = ctx.db.normalizeId("r2Files", storageId);
  const meta = r2Id
    ? await ctx.db.get(r2Id)
    : await ctx.db.system.get(storageId as Id<"_storage">);
  if (meta && "deletedAt" in meta && meta.deletedAt) return null;
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
 * Load and parse a JSON file from storage (actions only — queries cannot read blobs).
 */
export async function loadJson<T = unknown>(
  ctx: ActionCtx,
  storageId: Id<"_storage">,
): Promise<T> {
  const blob = await ctx.storage.get(storageId as Id<"_storage">);
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

export const createUploadUrl = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProjectWrite(ctx, projectId);
    const project = await ctx.db.get(projectId);
    return project!.workspaceId;
  },
});

export const createAssetFromUpload = mutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.union(v.id("_storage"), v.id("r2Files")),
    type: assetType,
    name: v.string(),
    format: v.optional(v.string()),

    entityId: v.optional(v.id("entities")),
    jobId: v.optional(v.id("generationJobs")),
    tags: v.optional(v.array(v.string())),
    durationSec: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    /** True when the file depicts a real person's face. */
    containsLikeness: v.optional(v.boolean()),
    likenessConsent: v.optional(v.boolean()),
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
    await requireProjectWrite(ctx, args.projectId);

    const name = args.name.trim();
    if (name.length === 0) {
      throw new Error("Asset name is required");
    }

    if (args.containsLikeness === true && args.likenessConsent !== true) {
      throw new Error(
        "Likeness consent is required when uploading a real person's face",
      );
    }

    if (args.entityId !== undefined) {
      const entity = await ctx.db.get(args.entityId);
      if (entity === null || entity.projectId !== args.projectId) {
        throw new Error("Entity not found in this project");
      }
    }

    const meta = await getStorageMeta(ctx, args.storageId);
    if (meta === null) {
      throw new Error("Uploaded file not found");
    }

    const format =
      args.format ?? meta.contentType ?? "application/octet-stream";
    validateAssetUpload(args.type, meta.size, meta.contentType ?? args.format);

    const tags = args.tags ?? [];
    const now = Date.now();
    const ownerProject = await ctx.db.get(args.projectId);
    if (!ownerProject) throw new Error("Project not found");
    const mediaFileId = await registerMediaFile(
      ctx,
      ownerProject.workspaceId,
      args.storageId,
      user._id,
      format,
      meta.size,
    );
    const assetId = await ctx.db.insert("assets", {
      workspaceId: ownerProject.workspaceId,
      mediaFileId,
      projectId: args.projectId,

      entityId: args.entityId,
      jobId: args.jobId,
      type: args.type,
      name,
      searchText: buildSearchText(name, tags),
      storageId: args.storageId,
      format,
      sizeBytes: meta.size,
      durationSec: args.durationSec,
      width: args.width,
      height: args.height,
      tags,
      lineage: args.lineage,
      likenessConsent:
        args.containsLikeness === true ? true : args.likenessConsent,
      starred: false,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    const project = await ctx.db.get(args.projectId);
    if (project !== null && meta.size > 0) {
      await ctx.db.insert("egressEvents", {
        userId: user._id,
        workspaceId: project.workspaceId,
        projectId: args.projectId,
        bytes: meta.size,
        kind: "storage_write",
        createdAt: now,
      });
    }

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
    storageId: v.union(v.id("_storage"), v.id("r2Files")),
    type: assetType,
    format: v.string(),
    sizeBytes: v.number(),
    createdBy: v.id("users"),
    jobId: v.id("generationJobs"),
    outputIndex: v.optional(v.number()),

    entityId: v.optional(v.id("entities")),

    durationSec: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    lineage: v.optional(lineageValidator),
    name: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    if (args.outputIndex !== undefined) {
      const outputs = await ctx.db
        .query("assets")
        .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
        .collect();
      const existing = outputs.find(
        (asset) => asset.outputIndex === args.outputIndex,
      );
      if (existing) {
        if (existing.storageId !== args.storageId)
          await deleteFile(ctx, args.storageId);
        return existing._id;
      }
    }
    const now = Date.now();
    const name =
      args.name?.trim() ||
      `${args.lineage?.model ?? "gen"}-${args.type}-${now}`;
    const tags = args.tags ?? [];
    const ownerProject = await ctx.db.get(args.projectId);
    if (!ownerProject) throw new Error("Project not found");
    const mediaFileId = await registerMediaFile(
      ctx,
      ownerProject.workspaceId,
      args.storageId,
      args.createdBy,
      args.format,
      args.sizeBytes,
    );
    const assetId = await ctx.db.insert("assets", {
      workspaceId: ownerProject.workspaceId,
      mediaFileId,
      projectId: args.projectId,

      entityId: args.entityId,
      jobId: args.jobId,
      outputIndex: args.outputIndex,
      type: args.type,
      name,
      searchText: buildSearchText(name, tags),
      storageId: args.storageId,
      format: args.format,
      sizeBytes: args.sizeBytes,
      durationSec: args.durationSec,
      width: args.width,
      height: args.height,
      tags,
      lineage: args.lineage,
      starred: false,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });

    if (args.sizeBytes > 0) {
      const project = await ctx.db.get(args.projectId);
      if (project !== null) {
        await ctx.db.insert("egressEvents", {
          userId: args.createdBy,
          workspaceId: project.workspaceId,
          projectId: args.projectId,
          bytes: args.sizeBytes,
          kind: "storage_write",
          createdAt: now,
        });
      }
    }

    return assetId;
  },
});

export const getAssetUrl = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (asset === null) {
      throw new Error("Asset not found");
    }
    await requireAssetAccess(ctx, asset._id);
    return await getFileUrl(ctx, asset.storageId);
  },
});

/** URLs + metadata for all project assets (editor media bin / playback). */
export const listProjectAssetUrls = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const assets = await projectAssets(ctx, args.projectId);
    return await Promise.all(
      assets.map(async (asset) => ({
        assetId: asset._id,
        url: await getFileUrl(ctx, asset.storageId),
        type: asset.type,
        durationSec: asset.durationSec,
        name: asset.name,
      })),
    );
  },
});

export const getAsset = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (asset === null) {
      return null;
    }
    await requireAssetAccess(ctx, asset._id);
    return asset;
  },
});

export const getAssetInternal = internalQuery({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.assetId);
  },
});

export const listProjectAssets = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    return projectAssets(ctx, args.projectId);
  },
});

export const deleteAsset = mutation({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (asset === null) {
      throw new Error("Asset not found");
    }
    await requireAssetAccess(ctx, asset._id);
    await assertMediaRemovable(ctx, asset.projectId, args.assetId);
    await deleteFile(ctx, asset.storageId);
    await ctx.db.delete(args.assetId);
  },
});

export const canProjectUseAsset = internalQuery({
  args: { projectId: v.id("projects"), assetId: v.id("assets") },
  handler: async (ctx, args) =>
    projectCanUseAsset(ctx, args.projectId, args.assetId),
});
