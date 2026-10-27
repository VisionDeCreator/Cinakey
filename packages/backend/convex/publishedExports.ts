import { requireProjectWrite } from "./lib/access";
import { v, ConvexError } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireUser, requireProjectAccess } from "./lib/access";
import { assertRateLimit } from "./lib/rateLimit";
import { appendAuditLog } from "./lib/audit";
import { registerMediaFile } from "./storage";

export const MAX_EXPORT_BYTES = 200 * 1024 * 1024;
export const WORKSPACE_EXPORT_BYTES = 5 * 1024 * 1024 * 1024;
export const beginValidated = internalMutation({
  args: {
    projectId: v.id("projects"),
    versionId: v.id("timelineVersions"),
    requestId: v.string(),
    title: v.string(),
    durationSec: v.number(),
    width: v.number(),
    height: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const project = await requireProjectWrite(ctx, args.projectId);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.projectId !== project._id)
      throw new Error("Invalid saved timeline");
    if (!args.requestId || args.requestId.length > 128)
      throw new Error("Invalid publication request");
    const rows = await ctx.db
      .query("publishedExports")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const prior = rows.find(
      (row) => row.requestId === args.requestId && row.createdBy === user._id,
    );
    if (prior) {
      if (prior.versionId !== args.versionId)
        throw new Error(
          "Publication request already belongs to another version",
        );
      return prior._id;
    }
    await assertRateLimit(ctx, `publish:${user._id}`, 10, 3600_000);
    const all = await ctx.db
      .query("publishedExports")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", project.workspaceId),
      )
      .collect();
    const used = all.reduce(
      (sum, row) =>
        sum +
        (row.state === "ready"
          ? (row.sizeBytes ?? 0)
          : row.expiresAt > Date.now()
            ? row.reservedBytes
            : 0),
      0,
    );
    if (used + MAX_EXPORT_BYTES > WORKSPACE_EXPORT_BYTES)
      throw new Error("Workspace stored-export limit reached (5 GiB)");
    return ctx.db.insert("publishedExports", {
      workspaceId: project.workspaceId,
      projectId: project._id,
      versionId: args.versionId,
      createdBy: user._id,
      requestId: args.requestId,
      title: args.title.slice(0, 120),
      state: "waiting",
      reservedBytes: MAX_EXPORT_BYTES,
      expectedDurationSec: args.durationSec,
      expectedWidth: args.width,
      expectedHeight: args.height,
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600_000,
    });
  },
});

export const claimUpload = internalMutation({
  args: { publicationId: v.id("publishedExports"), attempt: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const publication = await ctx.db.get(args.publicationId);
    if (!publication) throw new Error("Publication not found");
    await requireProjectWrite(ctx, publication.projectId);
    if (publication.createdBy !== user._id)
      throw new Error("Publication access denied");
    if (publication.state === "ready") return publication;
    if (publication.expiresAt <= Date.now())
      throw new Error("Publication upload expired; create a new export");
    if (publication.leaseUntil && publication.leaseUntil > Date.now())
      throw new Error("An upload is already in progress");
    if (publication.stagedStorageId)
      await ctx.storage.delete(publication.stagedStorageId);
    await ctx.db.patch(publication._id, {
      stagedStorageId: undefined,
      state: "uploading",
      attempt: args.attempt,
      leaseUntil: Date.now() + 600_000,
    });
    return publication;
  },
});
export const finalize = internalMutation({
  args: {
    publicationId: v.id("publishedExports"),
    attempt: v.string(),
    storageId: v.id("_storage"),
    sizeBytes: v.number(),
    sha256: v.string(),
    durationSec: v.number(),
    width: v.number(),
    height: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.get(args.publicationId);
    if (!row) throw new ConvexError("Publication not found");
    await requireProjectWrite(ctx, row.projectId);
    if (
      row.state === "ready" &&
      row.createdBy === user._id &&
      row.storageId === args.storageId
    )
      return row._id;
    if (
      row.createdBy !== user._id ||
      row.state !== "uploading" ||
      row.attempt !== args.attempt ||
      row.stagedStorageId !== args.storageId ||
      !row.leaseUntil ||
      row.leaseUntil <= Date.now() ||
      row.expiresAt <= Date.now()
    )
      throw new ConvexError("Upload no longer owns this publication");
    if (
      args.sizeBytes <= 0 ||
      args.sizeBytes > MAX_EXPORT_BYTES ||
      !/^[a-f0-9]{64}$/.test(args.sha256) ||
      Math.abs(args.durationSec - row.expectedDurationSec) > 0.75 ||
      args.width !== row.expectedWidth ||
      args.height !== row.expectedHeight
    )
      throw new ConvexError("Export does not match its saved timeline");
    const metadata = await ctx.db.system.get(args.storageId);
    if (
      !metadata ||
      metadata.size !== args.sizeBytes ||
      (metadata.contentType !== undefined &&
        metadata.contentType !== "video/mp4")
    )
      throw new ConvexError("Invalid uploaded export file");
    if (
      await ctx.db
        .query("mediaFiles")
        .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
        .first()
    )
      throw new ConvexError("File is already registered");
    await registerMediaFile(
      ctx,
      row.workspaceId,
      args.storageId,
      user._id,
      "video/mp4",
      args.sizeBytes,
    );
    await ctx.db.patch(row._id, {
      state: "ready",
      storageId: args.storageId,
      sizeBytes: args.sizeBytes,
      sha256: args.sha256,
      durationSec: args.durationSec,
      width: args.width,
      height: args.height,
      completedAt: Date.now(),
      stagedStorageId: undefined,
      leaseUntil: undefined,
    });
    await appendAuditLog(ctx, {
      actorUserId: user._id,
      action: "export.published",
      targetType: "publishedExport",
      targetId: row._id,
    });
    return row._id;
  },
});
export const failUpload = internalMutation({
  args: { publicationId: v.id("publishedExports"), attempt: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.publicationId);
    if (row?.state === "uploading" && row.attempt === args.attempt) {
      if (row.stagedStorageId) await ctx.storage.delete(row.stagedStorageId);
      await ctx.db.patch(row._id, {
        state: "failed",
        stagedStorageId: undefined,
        leaseUntil: undefined,
      });
    }
  },
});
export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProjectAccess(ctx, projectId);
    const rows = await ctx.db
      .query("publishedExports")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(50);
    return rows.map(
      ({
        storageId: _file,
        stagedStorageId: _staged,
        attempt: _attempt,
        ...row
      }) => row,
    );
  },
});
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const state of ["waiting", "uploading", "failed"] as const) {
      const rows = await ctx.db
        .query("publishedExports")
        .withIndex("by_expiry", (q) =>
          q.eq("state", state).lt("expiresAt", Date.now()),
        )
        .take(100);
      for (const row of rows) {
        if (row.stagedStorageId) await ctx.storage.delete(row.stagedStorageId);
        await ctx.db.delete(row._id);
      }
    }
    const sessions = await ctx.db
      .query("exportViewerSessions")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", Date.now()))
      .take(500);
    for (const session of sessions) await ctx.db.delete(session._id);
  },
});

export const getForDelivery = internalQuery({
  args: { publicationId: v.id("publishedExports") },
  handler: async (ctx, { publicationId }) => {
    const row = await ctx.db.get(publicationId);
    if (!row || row.state !== "ready" || !row.storageId)
      throw new Error("Stored export not found");
    await requireProjectAccess(ctx, row.projectId);
    return row;
  },
});
export const recordDownload = internalMutation({
  args: { publicationId: v.id("publishedExports") },
  handler: async (ctx, { publicationId }) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.get(publicationId);
    if (!row || row.state !== "ready")
      throw new Error("Stored export not found");
    await requireProjectAccess(ctx, row.projectId);
    await assertRateLimit(ctx, `export-download:${user._id}`, 60, 60_000);
    await ctx.db.insert("egressEvents", {
      userId: user._id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      bytes: row.sizeBytes!,
      kind: "download",
      createdAt: Date.now(),
    });
  },
});
export const remove = mutation({
  args: { publicationId: v.id("publishedExports") },
  handler: async (ctx, { publicationId }) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.get(publicationId);
    if (!row) return;
    await requireProjectAccess(ctx, row.projectId);
    if (row.state === "uploading" && (row.leaseUntil ?? 0) > Date.now())
      throw new Error("Wait for the upload to finish before deleting");
    const links = await ctx.db
      .query("exportShareLinks")
      .withIndex("by_publication", (q) => q.eq("publicationId", row._id))
      .collect();
    for (const link of links) {
      const sessions = await ctx.db
        .query("exportViewerSessions")
        .withIndex("by_link", (q) => q.eq("linkId", link._id))
        .collect();
      for (const session of sessions) await ctx.db.delete(session._id);
      await ctx.db.delete(link._id);
    }
    await ctx.db.delete(row._id);
    if (row.stagedStorageId) await ctx.storage.delete(row.stagedStorageId);
    if (row.storageId) {
      const file = await ctx.db
        .query("mediaFiles")
        .withIndex("by_storage", (q) => q.eq("storageId", row.storageId!))
        .first();
      if (file) await ctx.db.delete(file._id);
      await ctx.storage.delete(row.storageId);
    }
    await appendAuditLog(ctx, {
      actorUserId: user._id,
      action: "export.deleted",
      targetType: "publishedExport",
      targetId: publicationId,
    });
  },
});

export const stageUpload = internalMutation({
  args: {
    publicationId: v.id("publishedExports"),
    attempt: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.get(args.publicationId);
    if (!row) throw new ConvexError("Publication not found");
    await requireProjectWrite(ctx, row.projectId);
    if (
      row.createdBy !== user._id ||
      row.state !== "uploading" ||
      row.attempt !== args.attempt ||
      (row.leaseUntil ?? 0) <= Date.now() ||
      row.expiresAt <= Date.now()
    )
      throw new ConvexError("Upload attempt expired");
    if (row.stagedStorageId && row.stagedStorageId !== args.storageId)
      throw new ConvexError("Upload already staged");
    const metadata = await ctx.db.system.get(args.storageId);
    if (
      !metadata ||
      metadata.size > MAX_EXPORT_BYTES ||
      (metadata.contentType !== undefined &&
        metadata.contentType !== "video/mp4")
    )
      throw new ConvexError("Invalid uploaded file");
    if (
      await ctx.db
        .query("mediaFiles")
        .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
        .first()
    )
      throw new ConvexError("File already belongs to a workspace");
    await ctx.db.patch(row._id, { stagedStorageId: args.storageId });
  },
});
