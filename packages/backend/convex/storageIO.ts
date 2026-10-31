import {
  assertPaymentProduction,
  productionEntitlement,
  assertPaymentGeneration,
} from "./lib/paymentAccess";
import { appendAuditLog } from "./lib/audit";
import { mediaUnavailable, mediaControl } from "./lib/mediaControls";
import { assertUploadAllowed } from "./lib/restrictions";
import { assertRateLimit } from "./lib/rateLimit";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { getFileUrl, deleteFile } from "./storage";
export const uploadUrl = internalMutation({
  args: {},
  // Internal JSON/checkpoint uploads only; public media sessions are created by the API.
  handler: (ctx) => ctx.storage.generateUploadUrl(),
});
export const url = internalQuery({
  args: { id: v.union(v.id("_storage"), v.id("r2Files")) },
  handler: (ctx, { id }) => getFileUrl(ctx, id),
});
export const remove = internalMutation({
  args: { id: v.union(v.id("_storage"), v.id("r2Files")) },
  handler: (ctx, { id }) => deleteFile(ctx, id),
});

import {
  requireProjectGenerationWrite,
  requireSeriesWrite,
  requireUser,
} from "./lib/access";
import { enqueueTask } from "./tasks";

export const beginR2Upload = internalMutation({
  args: {
    token: v.string(),
    key: v.string(),
    projectId: v.optional(v.id("projects")),
    seriesId: v.optional(v.id("series")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await assertRateLimit(ctx, `r2Upload:${user._id}`, 120, 3600_000);
    if (!!args.projectId === !!args.seriesId)
      throw new Error("Choose a project or series");
    const scope = args.projectId
      ? await requireProjectGenerationWrite(ctx, args.projectId)
      : await requireSeriesWrite(ctx, args.seriesId!);
    if ("archivedAt" in scope && scope.archivedAt)
      throw new Error("Restore this series first");
    const id = await ctx.db.insert("r2Uploads", {
      token: args.token,
      key: args.key,
      workspaceId: scope.workspaceId,
      projectId: args.projectId,
      createdBy: user._id,
      expiresAt: Date.now() + 3600_000,
    });
    return id;
  },
});
export const r2Upload = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) =>
    ctx.db
      .query("r2Uploads")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique(),
});
export const prepareR2Upload = internalMutation({
  args: { token: v.string(), contentType: v.string(), size: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("r2Uploads")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!row || row.expiresAt < Date.now() || row.fileId || row.completing)
      throw new Error("Upload session expired or completed");
    await assertUploadAllowed(ctx, row);
    if (!(await productionEntitlement(ctx, row.workspaceId)).canWrite) {
      if (!row.projectId) await assertPaymentProduction(ctx, row.workspaceId);
      await assertPaymentGeneration(ctx, row.workspaceId);
      const contentType =
        "contentType" in args ? args.contentType : row.contentType;
      if (
        typeof contentType !== "string" ||
        !/^(image|video)\//.test(contentType)
      )
        throw new Error(
          "Purchased credits allow image and video reference uploads only.",
        );
    }
    if (
      row.contentType &&
      (row.contentType !== args.contentType || row.size !== args.size)
    )
      throw new Error("Upload metadata cannot change");
    await ctx.db.patch(row._id, {
      contentType: args.contentType,
      size: args.size,
    });
    return row;
  },
});
export const claimR2Upload = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const row = await ctx.db
      .query("r2Uploads")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!row || row.expiresAt < Date.now() || !row.contentType || !row.size)
      throw new Error("Upload session unavailable");
    await assertUploadAllowed(ctx, row);
    if (!(await productionEntitlement(ctx, row.workspaceId)).canWrite) {
      if (!row.projectId) await assertPaymentProduction(ctx, row.workspaceId);
      await assertPaymentGeneration(ctx, row.workspaceId);
      const contentType = row.contentType;
      if (
        typeof contentType !== "string" ||
        !/^(image|video)\//.test(contentType)
      )
        throw new Error(
          "Purchased credits allow image and video reference uploads only.",
        );
    }
    if (!row.fileId) {
      if (row.completing)
        throw new Error("Upload completion already in progress");
      await ctx.db.patch(row._id, { completing: true });
    }
    return row;
  },
});
export const releaseR2Upload = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const row = await ctx.db
      .query("r2Uploads")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (row && !row.fileId) await ctx.db.patch(row._id, { completing: false });
  },
});
export const completeR2Upload = internalMutation({
  args: {
    token: v.string(),
    bucket: v.string(),
    size: v.number(),
    contentType: v.string(),
    key: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("r2Uploads")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!row || !row.completing || row.expiresAt < Date.now())
      throw new Error("Upload session unavailable");
    if (row.fileId) return row.fileId;
    await assertUploadAllowed(ctx, row);
    if (!(await productionEntitlement(ctx, row.workspaceId)).canWrite) {
      if (!row.projectId) await assertPaymentProduction(ctx, row.workspaceId);
      await assertPaymentGeneration(ctx, row.workspaceId);
      const contentType =
        "contentType" in args ? args.contentType : row.contentType;
      if (
        typeof contentType !== "string" ||
        !/^(image|video)\//.test(contentType)
      )
        throw new Error(
          "Purchased credits allow image and video reference uploads only.",
        );
    }
    if (row.size !== args.size || row.contentType !== args.contentType)
      throw new Error("Uploaded file does not match the upload session");
    const id = await ctx.db.insert("r2Files", {
      key: args.key,
      bucket: args.bucket,
      size: args.size,
      contentType: args.contentType,
      workspaceId: row.workspaceId,
      createdBy: row.createdBy,
      createdAt: Date.now(),
    });
    await ctx.db.patch(row._id, { fileId: id });
    return id;
  },
});
export const registerR2File = internalMutation({
  args: {
    key: v.string(),
    bucket: v.string(),
    size: v.number(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("r2Files")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    return (
      existing?._id ??
      ctx.db.insert("r2Files", { ...args, createdAt: Date.now() })
    );
  },
});
export const r2File = internalQuery({
  args: { id: v.id("r2Files") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});
export const forgetR2File = internalMutation({
  args: { id: v.id("r2Files") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.delete(id);
    const requests = await ctx.db
      .query("storageCleanupRequests")
      .withIndex("by_file", (q) => q.eq("fileId", id))
      .take(100);
    for (const request of requests) {
      if (request.state === "completed") continue;
      await ctx.db.patch(request._id, {
        state: "completed",
        completedAt: Date.now(),
      });
      await appendAuditLog(ctx, {
        actorType: "operator",
        action: "storage.cleanup.completed",
        targetType: "media",
        targetId: id,
        requestId: request.requestId,
        after: { state: "completed" },
      });
    }
  },
});
export const cleanupR2Uploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const abandoned = await ctx.db
      .query("r2Files")
      .withIndex("by_cleanup", (q) =>
        q
          .eq("workspaceId", undefined)
          .eq("retentionProtected", undefined)
          .eq("deletedAt", undefined)
          .lt("createdAt", Date.now() - 86400_000),
      )
      .take(50);
    for (const file of abandoned)
      if (!file.deletedAt) {
        const control = await mediaControl(ctx, file._id);
        if (!control?.quarantined && !control?.retentionHold)
          await deleteFile(ctx, file._id);
      }
    const expired = await ctx.db
      .query("r2Uploads")
      .withIndex("by_retention_expiry", (q) =>
        q
          .eq("retentionProtected", undefined)
          .lt("expiresAt", Date.now() - 86400_000),
      )
      .take(50);
    for (const row of expired) {
      if (row.fileId) {
        const control = await mediaControl(ctx, row.fileId);
        if (control?.quarantined || control?.retentionHold) continue;
      }
      await enqueueTask(ctx, 0, "r2Storage:removeAbandonedUpload", {
        key: row.key,
        finalKey: row.fileId
          ? undefined
          : row.key.replace(/^staging\//, "media/"),
      });
      if (row.fileId) {
        const registered = await ctx.db
          .query("mediaFiles")
          .withIndex("by_storage", (q) => q.eq("storageId", row.fileId!))
          .first();
        if (!registered) await deleteFile(ctx, row.fileId);
      }
      await ctx.db.delete(row._id);
    }
  },
});
export const lookupR2File = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const normalized = ctx.db.normalizeId("r2Files", id);
    return normalized && !(await mediaUnavailable(ctx, normalized))
      ? ctx.db.get(normalized)
      : null;
  },
});

import { requireAssetAccess, requireProjectAccess } from "./lib/access";
/** Resolve references at the public HTTP boundary without trusting user-authored strings. */
export const authorizeR2File = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const normalized = ctx.db.normalizeId("r2Files", id);
    const file = normalized ? await ctx.db.get(normalized) : null;
    if (!file || file.deletedAt || (await mediaUnavailable(ctx, file._id)))
      return null;
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_storage", (q) => q.eq("storageId", file._id))
      .collect();
    for (const asset of assets) {
      try {
        await requireAssetAccess(ctx, asset._id);
        return file;
      } catch {
        /* Try another authorized alias. */
      }
    }
    const publication = await ctx.db
      .query("publishedExports")
      .withIndex("by_storage", (q) => q.eq("storageId", file._id))
      .first();
    if (publication?.state === "ready") {
      await requireProjectAccess(ctx, publication.projectId);
      return file;
    }
    throw new Error("Media access denied");
  },
});
