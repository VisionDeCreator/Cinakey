import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireUser } from "./lib/access";
import { appendAuditLog } from "./lib/audit";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";
import { deleteFile } from "./storage";
import { enqueueTask } from "./tasks";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    try {
      return await requireUser(ctx);
    } catch {
      return null;
    }
  },
});

export const ensurePersonalWorkspace = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await ensurePersonalWorkspaceForUser(ctx, user._id);
  },
});

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    notificationEmailEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const patch: {
      name?: string;
      notificationEmailEnabled?: boolean;
    } = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length === 0) {
        throw new Error("Name cannot be empty");
      }
      if (name.length > 80) {
        throw new Error("Name is too long");
      }
      patch.name = name;
    }
    if (args.notificationEmailEnabled !== undefined) {
      patch.notificationEmailEnabled = args.notificationEmailEnabled;
    }
    if (Object.keys(patch).length === 0) {
      return user._id;
    }
    await ctx.db.patch(user._id, patch);
    return user._id;
  },
});

export const deleteAccount = mutation({
  args: { confirm: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.confirm !== "DELETE") {
      throw new Error("Type DELETE to confirm account deletion");
    }
    if (user.isStaff === true) {
      throw new Error(
        "Staff accounts cannot self-delete; contact another admin",
      );
    }

    await appendAuditLog(ctx, {
      actorUserId: user._id,
      action: "account.delete_requested",
      targetType: "users",
      targetId: user._id,
      reason: "User requested account deletion",
    });

    await enqueueTask(ctx, 0, internal.users.purgeUserData, {
      userId: user._id,
    });

    return { scheduled: true };
  },
});

export const purgeUserData = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) return;

    const workspaceId = user.personalWorkspaceId;
    if (workspaceId !== undefined) {
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();

      // Remove the workspace's library graph before purging its physical files.
      // Normal project/series archival never runs this full-account purge.
      const seriesRows = await ctx.db
        .query("series")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      for (const series of seriesRows) {
        const resources = await ctx.db
          .query("libraryResources")
          .withIndex("by_series", (q) => q.eq("seriesId", series._id))
          .collect();
        for (const resource of resources) {
          const versions = await ctx.db
            .query("resourceVersions")
            .withIndex("by_resource", (q) => q.eq("resourceId", resource._id))
            .collect();
          for (const version of versions) {
            const uses = await ctx.db
              .query("resourceAssetUses")
              .withIndex("by_version", (q) => q.eq("versionId", version._id))
              .collect();
            for (const use of uses) await ctx.db.delete(use._id);
            await ctx.db.delete(version._id);
          }
          await ctx.db.delete(resource._id);
        }
        await ctx.db.delete(series._id);
      }
      for (const project of projects) {
        const bindings = await ctx.db
          .query("projectResources")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect();
        for (const row of bindings) await ctx.db.delete(row._id);
        const links = await ctx.db
          .query("projectAssetLinks")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect();
        for (const row of links) await ctx.db.delete(row._id);
      }
      for (const project of projects) {
        await purgeProject(ctx, project._id);
      }

      const libraryAssets = await ctx.db
        .query("assets")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      for (const asset of libraryAssets) {
        await ctx.db.delete(asset._id);
        await tryDeleteStorage(ctx, asset.storageId);
      }
      const files = await ctx.db
        .query("mediaFiles")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      for (const file of files) {
        await ctx.db.delete(file._id);
        await tryDeleteStorage(ctx, file.storageId);
      }

      const ledger = await ctx.db
        .query("creditLedger")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      for (const row of ledger) {
        await ctx.db.delete(row._id);
      }

      await ctx.db.delete(workspaceId);
    }

    const notes = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const n of notes) {
      await ctx.db.delete(n._id);
    }

    await ctx.db.patch(args.userId, {
      name: "Deleted User",
      email: undefined,
      image: undefined,
      personalWorkspaceId: undefined,
      notificationEmailEnabled: false,
      isAnonymous: true,
    });
  },
});

async function tryDeleteStorage(
  ctx: MutationCtx,
  storageId: Id<"_storage"> | undefined,
) {
  if (storageId === undefined) return;
  try {
    await deleteFile(ctx, storageId);
  } catch {
    // continue
  }
}

async function purgeProject(ctx: MutationCtx, projectId: Id<"projects">) {
  const assets = await ctx.db
    .query("assets")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const a of assets) {
    await tryDeleteStorage(ctx, a.storageId);
    await ctx.db.delete(a._id);
  }

  const jobs = await ctx.db
    .query("generationJobs")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const j of jobs) {
    await tryDeleteStorage(ctx, j.inputsFileId);
    await ctx.db.delete(j._id);
  }

  const entities = await ctx.db
    .query("entities")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const e of entities) {
    await tryDeleteStorage(ctx, e.sheetFileId);
    await ctx.db.delete(e._id);
  }

  const scripts = await ctx.db
    .query("workspaceScripts")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const s of scripts) {
    await tryDeleteStorage(ctx, s.contentFileId);
    await ctx.db.delete(s._id);
  }

  for (const document of await ctx.db
    .query("workspaceStaging")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect()) {
    await tryDeleteStorage(ctx, document.contentFileId);
    await tryDeleteStorage(ctx, document.planFileId);
    await ctx.db.delete(document._id);
  }
  const timelines = await ctx.db
    .query("timelineVersions")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const t of timelines) {
    await tryDeleteStorage(ctx, t.timelineFileId);
    await ctx.db.delete(t._id);
  }

  const notes = await ctx.db
    .query("notes")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const n of notes) {
    await ctx.db.delete(n._id);
  }

  const messages = await ctx.db
    .query("copilotMessages")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const m of messages) {
    await ctx.db.delete(m._id);
  }

  const proposals = await ctx.db
    .query("proposals")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const p of proposals) {
    await tryDeleteStorage(ctx, p.payloadFileId);
    await ctx.db.delete(p._id);
  }

  const sheets = await ctx.db
    .query("promptSheets")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const s of sheets) {
    await tryDeleteStorage(ctx, s.structuredFileId);
    await tryDeleteStorage(ctx, s.renderedFileId);
    await ctx.db.delete(s._id);
  }

  const exports = await ctx.db
    .query("exports")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const e of exports) {
    await ctx.db.delete(e._id);
  }

  const flags = await ctx.db
    .query("moderationFlags")
    .filter((q) => q.eq(q.field("projectId"), projectId))
    .collect();
  for (const f of flags) {
    await ctx.db.delete(f._id);
  }

  const egress = await ctx.db
    .query("egressEvents")
    .withIndex("by_project_time", (q) => q.eq("projectId", projectId))
    .collect();
  for (const e of egress) {
    await ctx.db.delete(e._id);
  }

  await ctx.db.delete(projectId);
}
