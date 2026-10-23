import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  requireAssetAccess,
  requireProjectAccess,
  requireSeriesAccess,
  requireUser,
  projectCanUseAsset,
} from "./lib/access";
import { buildSearchText } from "./lib/assetSearch";
import {
  generateUploadUrl,
  getFileUrl,
  getStorageMeta,
  validateAssetUpload,
  registerMediaFile,
} from "./storage";
const kind = v.union(
  v.literal("media"),
  v.literal("character"),
  v.literal("creature"),
  v.literal("location"),
  v.literal("prop"),
  v.literal("style"),
);
const type = v.union(
  v.literal("image"),
  v.literal("video"),
  v.literal("audio"),
  v.literal("music"),
  v.literal("logo"),
);
export const list = query({
  args: {
    seriesId: v.id("series"),
    includeArchived: v.optional(v.boolean()),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSeriesAccess(ctx, args.seriesId);
    const page = await ctx.db
      .query("libraryResources")
      .withIndex("by_series", (q) => q.eq("seriesId", args.seriesId))
      .order("desc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: Math.max(1, Math.min(48, Math.floor(args.limit ?? 24))),
      });
    const rows = page.page;
    const items = await Promise.all(
      rows
        .filter((r) => args.includeArchived || !r.archivedAt)
        .map(async (resource) => ({
          resource,
          version: resource.currentVersionId
            ? await ctx.db.get(resource.currentVersionId)
            : null,
        })),
    );
    return { items, cursor: page.continueCursor, isDone: page.isDone };
  },
});
export const versions = query({
  args: { resourceId: v.id("libraryResources") },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) throw new Error("Resource not found");
    await requireSeriesAccess(ctx, resource.seriesId);
    return ctx.db
      .query("resourceVersions")
      .withIndex("by_resource", (q) => q.eq("resourceId", args.resourceId))
      .order("desc")
      .collect();
  },
});
/** Versions are immutable. Updating the series library never modifies an episode's bindings. */
export const publish = mutation({
  args: {
    seriesId: v.id("series"),
    resourceId: v.optional(v.id("libraryResources")),
    kind,
    name: v.string(),
    description: v.string(),
    sourceEntityId: v.optional(v.id("entities")),
    assetIds: v.array(v.id("assets")),
    expectedVersionId: v.optional(v.id("resourceVersions")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const series = await requireSeriesAccess(ctx, args.seriesId);
    if (series.archivedAt) throw new Error("Restore this series first");
    const name = args.name.trim();
    if (
      !name ||
      name.length > 200 ||
      args.description.length > 50_000 ||
      args.assetIds.length > 32
    )
      throw new Error("Provide a name and at most 32 references");
    if (args.kind === "media" && args.assetIds.length === 0)
      throw new Error("Media resources need a file");
    for (const id of args.assetIds) {
      const asset = await requireAssetAccess(ctx, id);
      const workspaceId =
        asset.workspaceId ??
        (asset.projectId
          ? (await ctx.db.get(asset.projectId))?.workspaceId
          : undefined);
      if (workspaceId !== series.workspaceId)
        throw new Error("Cross-workspace sharing is not allowed");
      if (args.kind !== "media" && asset.type !== "image")
        throw new Error("Entity references must be images");
    }
    const sourceEntity = args.sourceEntityId
      ? await ctx.db.get(args.sourceEntityId)
      : null;
    if (args.sourceEntityId) {
      if (!sourceEntity || sourceEntity.kind !== args.kind)
        throw new Error("Source entity kind does not match");
      const sourceProject = await requireProjectAccess(
        ctx,
        sourceEntity.projectId,
      );
      if (
        sourceProject.workspaceId !== series.workspaceId ||
        sourceEntity.lockedReferenceAssetIds.some(
          (id) => !args.assetIds.includes(id),
        )
      )
        throw new Error(
          "Keep the source entity's pinned references when publishing its sheet",
        );
    }
    let resource = args.resourceId ? await ctx.db.get(args.resourceId) : null;
    if (
      args.resourceId &&
      (!resource ||
        resource.seriesId !== series._id ||
        resource.kind !== args.kind)
    )
      throw new Error("Resource scope or kind does not match");
    if (resource?.archivedAt) throw new Error("Restore this resource first");
    if (resource && resource.currentVersionId !== args.expectedVersionId)
      throw new Error("This resource changed; reload before publishing");
    const now = Date.now();
    const resourceId =
      resource?._id ??
      (await ctx.db.insert("libraryResources", {
        seriesId: series._id,
        kind: args.kind,
        name,
        createdAt: now,
        updatedAt: now,
      }));
    resource = resource ?? (await ctx.db.get(resourceId));
    const current = resource?.currentVersionId
      ? await ctx.db.get(resource.currentVersionId)
      : null;
    const retainedSheet = sourceEntity?.sheetFileId ?? current?.sheetFileId;
    if (
      !sourceEntity &&
      retainedSheet &&
      current?.assetIds.some((id) => !args.assetIds.includes(id))
    )
      throw new Error(
        "Keep pinned sheet references or publish a new source entity snapshot",
      );
    const assetIds = [...new Set(args.assetIds)];
    const versionId = await ctx.db.insert("resourceVersions", {
      resourceId,
      version: (current?.version ?? 0) + 1,
      name,
      description: args.description,
      assetIds,
      sheetFileId: sourceEntity?.sheetFileId ?? current?.sheetFileId,
      createdBy: user._id,
      createdAt: now,
    });
    for (const assetId of assetIds)
      await ctx.db.insert("resourceAssetUses", { versionId, assetId });
    await ctx.db.patch(resourceId, {
      currentVersionId: versionId,
      name,
      updatedAt: now,
    });
    return resourceId;
  },
});
export const useInProject = mutation({
  args: { projectId: v.id("projects"), versionId: v.id("resourceVersions") },
  handler: async (ctx, args) => {
    const project = await requireProjectAccess(ctx, args.projectId);
    const version = await ctx.db.get(args.versionId);
    const resource = version ? await ctx.db.get(version.resourceId) : null;
    if (!version || !resource || project.seriesId !== resource.seriesId)
      throw new Error("This resource is not in the project's series");
    const series = await requireSeriesAccess(ctx, resource.seriesId);
    if (series.workspaceId !== project.workspaceId)
      throw new Error("Workspace mismatch");
    const existing = await ctx.db
      .query("projectResources")
      .withIndex("by_project_version", (q) =>
        q.eq("projectId", project._id).eq("versionId", version._id),
      )
      .first();
    if (existing) return existing._id;
    if (resource.archivedAt || series.archivedAt)
      throw new Error("Restore the series/resource before adopting it");
    for (const assetId of version.assetIds) {
      if (!(await ctx.db.get(assetId)))
        throw new Error("Resource file is missing");
      if (!(await projectCanUseAsset(ctx, project._id, assetId)))
        await ctx.db.insert("projectAssetLinks", {
          projectId: project._id,
          assetId,
        });
    }
    const now = Date.now();
    const entityId =
      resource.kind === "media"
        ? undefined
        : await ctx.db.insert("entities", {
            projectId: project._id,
            sourceResourceVersionId: version._id,
            sheetFileId: version.sheetFileId,
            kind: resource.kind,
            name: version.name,
            description: version.description,
            lockedReferenceAssetIds: version.assetIds,
            createdAt: now,
            updatedAt: now,
          });
    if (resource.kind === "style" && entityId)
      await ctx.db.patch(project._id, {
        activeStyleEntityId: entityId,
        styleReferenceAssetId: version.assetIds[0],
        styleNotes: version.description,
        updatedAt: now,
      });
    return ctx.db.insert("projectResources", {
      projectId: project._id,
      resourceId: resource._id,
      versionId: version._id,
      entityId,
      createdAt: now,
    });
  },
});
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const rows = await ctx.db
      .query("projectResources")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return Promise.all(
      rows.map(async (binding) => ({
        binding,
        version: await ctx.db.get(binding.versionId),
        resource: await ctx.db.get(binding.resourceId),
      })),
    );
  },
});
export const setArchived = mutation({
  args: { resourceId: v.id("libraryResources"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) throw new Error("Resource not found");
    await requireSeriesAccess(ctx, resource.seriesId);
    await ctx.db.patch(resource._id, {
      archivedAt: args.archived ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
  },
});
export const createUploadUrl = mutation({
  args: { seriesId: v.id("series") },
  handler: async (ctx, args) => {
    const series = await requireSeriesAccess(ctx, args.seriesId);
    if (series.archivedAt) throw new Error("Restore this series first");
    return generateUploadUrl(ctx);
  },
});
export const completeUpload = mutation({
  args: {
    seriesId: v.id("series"),
    storageId: v.id("_storage"),
    name: v.string(),
    type,
    containsLikeness: v.optional(v.boolean()),
    likenessConsent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const series = await requireSeriesAccess(ctx, args.seriesId);
    if (series.archivedAt) throw new Error("Restore this series first");
    if (!args.name.trim()) throw new Error("File name required");
    if (args.containsLikeness && !args.likenessConsent)
      throw new Error("Likeness consent required");
    const meta = await getStorageMeta(ctx, args.storageId);
    if (!meta) throw new Error("Upload not found");
    validateAssetUpload(args.type, meta.size, meta.contentType);
    const format = meta.contentType ?? "application/octet-stream";
    const mediaFileId = await registerMediaFile(
      ctx,
      series.workspaceId,
      args.storageId,
      user._id,
      format,
      meta.size,
    );
    const registered = await ctx.db
      .query("assets")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .collect();
    for (const asset of registered) {
      const uses = await ctx.db
        .query("resourceAssetUses")
        .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
        .collect();
      for (const use of uses) {
        const version = await ctx.db.get(use.versionId);
        const resource = version ? await ctx.db.get(version.resourceId) : null;
        if (resource?.seriesId === series._id) return resource._id;
      }
    }
    const now = Date.now();
    const assetId = await ctx.db.insert("assets", {
      workspaceId: series.workspaceId,
      mediaFileId,
      storageId: args.storageId,
      type: args.type,
      name: args.name.trim(),
      searchText: buildSearchText(args.name, []),
      format,
      sizeBytes: meta.size,
      tags: [],
      starred: false,
      likenessConsent: args.likenessConsent,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    const resourceId = await ctx.db.insert("libraryResources", {
      seriesId: series._id,
      name: args.name.trim(),
      kind: "media",
      createdAt: now,
      updatedAt: now,
    });
    const versionId = await ctx.db.insert("resourceVersions", {
      resourceId,
      version: 1,
      name: args.name.trim(),
      description: "",
      assetIds: [assetId],
      createdBy: user._id,
      createdAt: now,
    });
    await ctx.db.insert("resourceAssetUses", { versionId, assetId });
    await ctx.db.patch(resourceId, { currentVersionId: versionId });
    await ctx.db.insert("egressEvents", {
      userId: user._id,
      workspaceId: series.workspaceId,
      bytes: meta.size,
      kind: "storage_write",
      createdAt: now,
    });
    return resourceId;
  },
});
export const assetUrls = query({
  args: { versionId: v.id("resourceVersions") },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    const resource = version ? await ctx.db.get(version.resourceId) : null;
    if (!resource || !version) throw new Error("Resource not found");
    await requireSeriesAccess(ctx, resource.seriesId);
    return Promise.all(
      version.assetIds.map(async (id) => {
        const asset = await ctx.db.get(id);
        return asset
          ? { ...asset, url: await getFileUrl(ctx, asset.storageId) }
          : null;
      }),
    );
  },
});
