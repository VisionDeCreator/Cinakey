import { enqueueTask } from "./tasks";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { hasAdminPermission } from "@dirrio/shared";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdminPermission } from "./lib/access";
import { appendAuditLog } from "./lib/audit";
import { assertRateLimit } from "./lib/rateLimit";
import {
  mediaControl,
  assertMediaNotHeld,
  r2References,
  hasR2References,
} from "./lib/mediaControls";
import { deleteStoredFile } from "./storage";
const requests = { reason: v.string(), requestId: v.string() };
const statuses = v.union(
  v.literal("open"),
  v.literal("resolved"),
  v.literal("dismissed"),
);
function pageSize(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100)
    throw new Error("Page size must be 1 to 100");
}
async function once(
  ctx: MutationCtx,
  actorUserId: Id<"users">,
  args: { reason: string; requestId: string },
  fingerprint: string,
) {
  if (args.reason.trim().length < 10 || args.reason.length > 1000)
    throw new Error("Provide a reason of 10 to 1000 characters");
  if (!args.requestId.trim() || args.requestId.length > 128)
    throw new Error("Invalid request ID");
  const prior = await ctx.db
    .query("adminActionRequests")
    .withIndex("by_actor_request", (q) =>
      q.eq("actorUserId", actorUserId).eq("requestId", args.requestId),
    )
    .unique();
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      throw new Error("Administrative request mismatch");
    return false;
  }
  await assertRateLimit(ctx, `adminMedia:${actorUserId}`, 20, 60_000);
  await ctx.db.insert("adminActionRequests", {
    actorUserId,
    requestId: args.requestId,
    fingerprint,
    createdAt: Date.now(),
  });
  return true;
}
async function file(ctx: QueryCtx | MutationCtx, storageId: string) {
  const r2 = ctx.db.normalizeId("r2Files", storageId);
  if (r2) {
    const row = await ctx.db.get(r2);
    if (!row || row.deletedAt !== undefined)
      throw new Error("Media is missing or pending deletion");
    return {
      storageId: r2,
      contentType: row.contentType,
      size: row.size,
      workspaceId: row.workspaceId,
      r2: row,
    };
  }
  const legacy = ctx.db.system.normalizeId("_storage", storageId);
  if (!legacy) throw new Error("Invalid storage ID");
  const media = await ctx.db
    .query("mediaFiles")
    .withIndex("by_storage", (q) => q.eq("storageId", legacy))
    .first();
  const metadata = await ctx.db.system.get(legacy);
  if (!media || !metadata) throw new Error("Registered media not found");
  return {
    storageId: legacy,
    contentType: metadata.contentType ?? media.format,
    size: metadata.size,
    workspaceId: media.workspaceId,
    r2: null,
  };
}
export const flags = query({
  args: {
    status: statuses,
    stage: v.optional(v.union(v.literal("prompt"), v.literal("output"))),
    verdict: v.optional(v.union(v.literal("flagged"), v.literal("blocked"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "moderation.manage");
    pageSize(args.paginationOpts.numItems);
    const result = await ctx.db
      .query("moderationFlags")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("desc")
      .filter((q) =>
        q.and(
          args.stage ? q.eq(q.field("stage"), args.stage) : q.eq(1, 1),
          args.verdict ? q.eq(q.field("verdict"), args.verdict) : q.eq(1, 1),
        ),
      )
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 300,
        maximumBytesRead: 1000000,
      });
    return {
      ...result,
      page: result.page.map(({ snippet: _, ...row }) => ({
        ...row,
        revision: row.revision ?? 0,
      })),
    };
  },
});
export const decide = mutation({
  args: {
    flagId: v.id("moderationFlags"),
    status: statuses,
    assignedTo: v.union(v.id("users"), v.null()),
    expectedRevision: v.number(),
    ...requests,
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "moderation.manage");
    if (
      !(await once(
        ctx,
        actor._id,
        args,
        JSON.stringify({ action: "moderation.decide", ...args }),
      ))
    )
      return;
    const flag = await ctx.db.get(args.flagId);
    if (!flag) throw new Error("Flag not found");
    if ((flag.revision ?? 0) !== args.expectedRevision)
      throw new Error("Moderation flag changed; reload before deciding");
    if (args.assignedTo) {
      const assignee = await ctx.db.get(args.assignedTo);
      if (
        !assignee ||
        assignee.suspendedAt !== undefined ||
        !hasAdminPermission(assignee, "moderation.manage")
      )
        throw new Error("Assignee must be an active moderation administrator");
    }
    await ctx.db.patch(flag._id, {
      status: args.status,
      assignedTo: args.assignedTo ?? undefined,
      revision: (flag.revision ?? 0) + 1,
      resolvedAt: args.status === "open" ? undefined : Date.now(),
      resolvedBy: args.status === "open" ? undefined : actor._id,
      lastDecisionReason: args.reason.trim(),
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "moderation.decide",
      targetType: "moderationFlag",
      targetId: flag._id,
      reason: args.reason,
      requestId: args.requestId,
      before: {
        status: flag.status,
        assignedTo: flag.assignedTo,
        revision: flag.revision ?? 0,
      },
      after: {
        status: args.status,
        assignedTo: args.assignedTo,
        revision: args.expectedRevision + 1,
      },
    });
  },
});
export const evidence = mutation({
  args: { flagId: v.id("moderationFlags"), ...requests },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "moderation.content.read");
    await assertRateLimit(ctx, `moderationEvidence:${actor._id}`, 30, 60_000);
    await once(
      ctx,
      actor._id,
      args,
      JSON.stringify({ action: "moderation.evidence", ...args }),
    );
    const flag = await ctx.db.get(args.flagId);
    if (!flag) throw new Error("Flag not found");
    const job = flag.jobId ? await ctx.db.get(flag.jobId) : null,
      asset = flag.assetId ? await ctx.db.get(flag.assetId) : null;
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "moderation.evidence",
      targetType: "moderationFlag",
      targetId: flag._id,
      reason: args.reason,
      requestId: args.requestId,
    });
    return {
      snippet: flag.snippet,
      prompt: job?.prompt,
      asset: asset
        ? {
            id: asset._id,
            storageId: asset.storageId,
            type: asset.type,
            sizeBytes: asset.sizeBytes,
            projectId: asset.projectId,
            workspaceId: asset.workspaceId,
          }
        : null,
    };
  },
});
export const inventory = query({
  args: {
    source: v.optional(v.union(v.literal("r2"), v.literal("convex"))),
    workspaceId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "storage.read");
    pageSize(args.paginationOpts.numItems);
    const workspaceId = args.workspaceId
      ? ctx.db.normalizeId("workspaces", args.workspaceId)
      : undefined;
    if (args.workspaceId && !workspaceId)
      return { page: [], isDone: true, continueCursor: "" };
    if (args.source === "convex") {
      const result = await (
        workspaceId
          ? ctx.db
              .query("mediaFiles")
              .withIndex("by_workspace", (q) =>
                q.eq("workspaceId", workspaceId!),
              )
          : ctx.db.query("mediaFiles")
      )
        .order("desc")
        .paginate(args.paginationOpts);
      const page = await Promise.all(
        result.page
          .filter((row) => !ctx.db.normalizeId("r2Files", row.storageId))
          .map(async (row) => ({
            cleanup: null,
            id: row.storageId,
            workspaceId: row.workspaceId,
            createdBy: row.createdBy,
            size: row.sizeBytes,
            contentType: row.format,
            createdAt: row.createdAt,
            deletedAt: undefined as number | undefined,
            control: await mediaControl(ctx, row.storageId),
            refs: {
              asset: !!(await ctx.db
                .query("assets")
                .withIndex("by_storage", (q) =>
                  q.eq("storageId", row.storageId),
                )
                .first()),
              media: true,
              publication: !!(await ctx.db
                .query("publishedExports")
                .withIndex("by_storage", (q) =>
                  q.eq("storageId", row.storageId),
                )
                .first()),
              staged: false,
              upload: false,
            },
            cleanupEligible: false,
          })),
      );
      return { ...result, page };
    }
    const result = await (
      workspaceId
        ? ctx.db
            .query("r2Files")
            .withIndex("by_workspace_created", (q) =>
              q.eq("workspaceId", workspaceId!),
            )
        : ctx.db.query("r2Files").withIndex("by_created")
    )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (row) => {
          const control = await mediaControl(ctx, row._id),
            refs = await r2References(ctx, row._id);
          const cleanup = await ctx.db
            .query("storageCleanupRequests")
            .withIndex("by_file", (q) => q.eq("fileId", row._id))
            .first();
          const task = cleanup?.taskId
            ? await ctx.db.get(cleanup.taskId)
            : null;
          return {
            cleanup: cleanup
              ? { state: cleanup.state, taskState: task?.state ?? null }
              : null,
            id: row._id,
            workspaceId: row.workspaceId,
            createdBy: row.createdBy,
            size: row.size,
            contentType: row.contentType,
            createdAt: row.createdAt,
            deletedAt: row.deletedAt,
            control,
            refs,
            cleanupEligible:
              row.deletedAt === undefined &&
              row.createdAt < Date.now() - 48 * 3600000 &&
              !hasR2References(refs) &&
              !control?.quarantined &&
              !control?.retentionHold,
          };
        }),
      ),
    };
  },
});
export const detail = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "storage.read");
    const selected = await file(ctx, args.storageId).catch(() => null);
    if (!selected) return null;
    const control = await mediaControl(ctx, args.storageId);
    const aliases = await ctx.db
      .query("assets")
      .withIndex("by_storage", (q) => q.eq("storageId", selected.storageId))
      .take(26);
    const publications = await ctx.db
      .query("publishedExports")
      .withIndex("by_storage", (q) => q.eq("storageId", selected.storageId))
      .take(26);
    return {
      storageId: selected.storageId,
      size: selected.size,
      contentType: selected.contentType,
      workspaceId: selected.workspaceId,
      provider: selected.r2 ? "r2" : "convex",
      control,
      aliases: aliases.slice(0, 25).map((a) => ({
        id: a._id,
        projectId: a.projectId,
        workspaceId: a.workspaceId,
        jobId: a.jobId,
        type: a.type,
      })),
      publications: publications
        .slice(0, 25)
        .map((p) => ({ id: p._id, projectId: p.projectId, state: p.state })),
      truncated: aliases.length > 25 || publications.length > 25,
    };
  },
});
export const control = mutation({
  args: {
    storageId: v.string(),
    quarantined: v.boolean(),
    retentionHold: v.boolean(),
    expectedRevision: v.number(),
    ...requests,
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "moderation.manage");
    if (
      !(await once(
        ctx,
        actor._id,
        args,
        JSON.stringify({ action: "media.control", ...args }),
      ))
    )
      return;
    const selected = await file(ctx, args.storageId);
    if (selected.r2) {
      const retentionProtected =
        args.quarantined || args.retentionHold ? true : undefined;
      await ctx.db.patch(selected.r2._id, { retentionProtected });
      const uploads = await ctx.db
        .query("r2Uploads")
        .withIndex("by_file", (q) => q.eq("fileId", selected.r2!._id))
        .take(101);
      if (uploads.length > 100)
        throw new Error("Too many upload records; operator review required");
      for (const upload of uploads)
        await ctx.db.patch(upload._id, { retentionProtected });
    }
    const current = await mediaControl(ctx, args.storageId);
    if ((current?.revision ?? 0) !== args.expectedRevision)
      throw new Error("Media controls changed; reload before updating");
    const fields = {
      quarantined: args.quarantined,
      retentionHold: args.retentionHold,
      revision: args.expectedRevision + 1,
      updatedAt: Date.now(),
      updatedBy: actor._id,
    };
    if (current) await ctx.db.patch(current._id, fields);
    else
      await ctx.db.insert("mediaControls", {
        storageId: args.storageId,
        ...fields,
      });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "media.control",
      targetType: "media",
      targetId: args.storageId,
      reason: args.reason,
      requestId: args.requestId,
      before: {
        quarantined: current?.quarantined ?? false,
        retentionHold: current?.retentionHold ?? false,
        revision: current?.revision ?? 0,
      },
      after: fields,
    });
  },
});
export const cleanup = mutation({
  args: { fileId: v.id("r2Files"), ...requests },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "storage.manage");
    if (
      !(await once(
        ctx,
        actor._id,
        args,
        JSON.stringify({ action: "storage.cleanup", ...args }),
      ))
    )
      return;
    const row = await ctx.db.get(args.fileId);
    if (!row || row.deletedAt !== undefined)
      throw new Error("File is missing or already pending deletion");
    if (row.createdAt >= Date.now() - 48 * 3600000)
      throw new Error("Orphan cleanup requires a 48-hour grace period");
    await assertMediaNotHeld(ctx, row._id);
    if (hasR2References(await r2References(ctx, row._id)))
      throw new Error("File still has references; preserve its history");
    const taskId = await deleteStoredFile(ctx, row._id);
    if (!taskId) throw new Error("Cleanup task could not be queued");
    await ctx.db.insert("storageCleanupRequests", {
      taskId,
      ...args,
      actorUserId: actor._id,
      state: "pending",
      createdAt: Date.now(),
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "storage.cleanup.request",
      targetType: "media",
      targetId: row._id,
      reason: args.reason,
      requestId: args.requestId,
      after: { state: "pending", size: row.size },
    });
  },
});
export const deletionContext = internalQuery({
  args: { fileId: v.id("r2Files") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.fileId);
    if (!row) return null;
    if (row.deletedAt === undefined)
      throw new Error("File is not scheduled for deletion");
    await assertMediaNotHeld(ctx, row._id);
    const refs = await r2References(ctx, row._id);
    const cleanup = await ctx.db
      .query("storageCleanupRequests")
      .withIndex("by_file", (q) => q.eq("fileId", row._id))
      .first();
    if (
      refs.asset ||
      refs.media ||
      refs.publication ||
      refs.staged ||
      (cleanup && refs.upload)
    )
      throw new Error("Deletion blocked by a live reference");
    return { key: row.key, bucket: row.bucket };
  },
});
export const previewContext = internalMutation({
  args: { storageId: v.string(), ...requests },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "moderation.content.read");
    await assertRateLimit(ctx, `mediaPreview:${actor._id}`, 30, 60_000);
    await once(
      ctx,
      actor._id,
      args,
      JSON.stringify({ action: "media.preview", ...args }),
    );
    const selected = await file(ctx, args.storageId);
    if (!/^(image|video|audio)\//.test(selected.contentType))
      throw new Error("Only registered media can be previewed");
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "media.preview",
      targetType: "media",
      targetId: args.storageId,
      reason: args.reason,
      requestId: args.requestId,
    });
    return {
      contentType: selected.contentType,
      key: selected.r2?.key,
      bucket: selected.r2?.bucket,
      url: selected.r2
        ? null
        : await ctx.storage.getUrl(selected.storageId as Id<"_storage">),
    };
  },
});
export const retryCleanup = mutation({
  args: { fileId: v.id("r2Files"), ...requests },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "storage.manage");
    if (
      !(await once(
        ctx,
        actor._id,
        args,
        JSON.stringify({ action: "storage.cleanup.retry", ...args }),
      ))
    )
      return;
    const file = await ctx.db.get(args.fileId),
      request = await ctx.db
        .query("storageCleanupRequests")
        .withIndex("by_file", (q) => q.eq("fileId", args.fileId))
        .first();
    if (
      !file ||
      file.deletedAt === undefined ||
      !request ||
      request.state !== "pending"
    )
      throw new Error("No pending administrative cleanup request");
    await assertMediaNotHeld(ctx, file._id);
    if (hasR2References(await r2References(ctx, file._id)))
      throw new Error("File has references; cleanup requires investigation");
    const task = request.taskId ? await ctx.db.get(request.taskId) : null;
    if (task && task.state !== "failed")
      throw new Error("Cleanup is already queued or running");
    if (task) await ctx.db.delete(task._id);
    const taskId = await enqueueTask(ctx, 0, "r2Storage:deleteObject", {
      id: file._id,
      key: file.key,
      bucket: file.bucket,
    });
    await ctx.db.patch(request._id, { taskId });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "storage.cleanup.retry",
      targetType: "media",
      targetId: file._id,
      reason: args.reason,
      requestId: args.requestId,
      after: { taskId },
    });
  },
});
