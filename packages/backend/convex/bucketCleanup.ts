import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { assertMediaNotHeld } from "./lib/mediaControls";

/** Operator-only cleanup; never exported through the product API manifest. */
export const removeProjects = internalMutation({
  args: {
    bucket: v.string(),
    projectIds: v.array(v.id("projects")),
    expectedAssetIds: v.array(v.id("assets")),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      !args.bucket.trim() ||
      args.reason.trim().length < 10 ||
      !args.projectIds.length ||
      args.projectIds.length > 20
    )
      throw new Error(
        "Provide a bucket, explicit project IDs and an audit reason",
      );
    const ids = new Set(args.projectIds);
    const assets = await bounded(ctx, "assets");
    const links = await bounded(ctx, "projectAssetLinks");
    const uses = await bounded(ctx, "resourceAssetUses");
    const files = await bounded(ctx, "r2Files");
    const bucketFiles = new Set(
      files.filter((f) => f.bucket === args.bucket).map((f) => f._id),
    );
    const oldAssets = new Set(
      assets
        .filter((a) => bucketFiles.has(a.storageId as Id<"r2Files">))
        .map((a) => a._id),
    );
    const deletingAssets = assets.filter(
      (a) => a.projectId && ids.has(a.projectId),
    );
    const deletingAssetIds = new Set(deletingAssets.map((a) => a._id));
    const expectedAssets = new Set(args.expectedAssetIds);
    if (
      expectedAssets.size !== deletingAssetIds.size ||
      [...deletingAssetIds].some((id) => !expectedAssets.has(id))
    )
      throw new Error(
        "Project assets changed after backup; refresh the cleanup plan",
      );
    for (const id of ids) {
      const project = await ctx.db.get(id);
      if (!project)
        throw new Error("Project is missing; refresh the cleanup plan");
      const affected =
        assets.some((a) => a.projectId === id && oldAssets.has(a._id)) ||
        links.some((l) => l.projectId === id && oldAssets.has(l.assetId));
      if (!affected)
        throw new Error("Project has no assets in the specified bucket");
      const jobs = await ctx.db
        .query("generationJobs")
        .withIndex("by_project", (q) => q.eq("projectId", id))
        .collect();
      // Financial/job evidence needs separate reconciliation; this cleanup never removes it.
      if (jobs.length)
        throw new Error(
          "Project has generation history; reconcile and use a dedicated cleanup plan",
        );
    }
    if (
      links.some(
        (l) => deletingAssetIds.has(l.assetId) && !ids.has(l.projectId),
      ) ||
      uses.some((u) => deletingAssetIds.has(u.assetId))
    )
      throw new Error(
        "Project-owned assets are shared outside the deletion scope",
      );
    for (const asset of deletingAssets)
      await assertMediaNotHeld(ctx, asset.storageId);
    const tasks = await bounded(ctx, "apiTasks");
    for (const task of tasks) {
      const serialized = JSON.stringify(task.args);
      if ([...ids, ...deletingAssetIds].some((id) => serialized.includes(id)))
        throw new Error(
          "Project still has queued tasks; finish or reconcile them before cleanup",
        );
    }
    const counts: Record<string, number> = {};
    async function remove(table: string, rows: Array<{ _id: string }>) {
      for (const row of rows) await ctx.db.delete(row._id as Id<CleanupTable>);
      if (rows.length) counts[table] = (counts[table] ?? 0) + rows.length;
    }
    // Retain job, usage ledger, payment, moderation, egress and audit history.
    const projectTables = [
      "productionAssignments",
      "projectResources",
      "projectAssetLinks",
      "scriptSegments",
      "workspaceScripts",
      "workspaceStaging",
      "timelineVersions",
      "timelineLeases",
      "entities",
      "promptSheets",
      "copilotMessages",
      "proposals",
      "notes",
      "exports",
      "publishedExports",
    ] as const;
    for (const table of projectTables) {
      const rows = await bounded(ctx, table);
      await remove(
        table,
        rows.filter((row) => row.projectId && ids.has(row.projectId)),
      );
    }
    const shares = (await bounded(ctx, "exportShareLinks")).filter((row) =>
      ids.has(row.projectId),
    );
    const shareIds = new Set(shares.map((row) => row._id));
    await remove(
      "exportViewerSessions",
      (await bounded(ctx, "exportViewerSessions")).filter((row) =>
        shareIds.has(row.linkId),
      ),
    );
    await remove("exportShareLinks", shares);
    await remove(
      "genjutsuSessions",
      (await bounded(ctx, "genjutsuSessions")).filter((row) =>
        ids.has(row.storageScopeId),
      ),
    );
    await remove("assets", deletingAssets);
    for (const id of ids) await ctx.db.delete(id);
    counts.projects = ids.size;
    // Retain registry and physical objects for backup recovery; unreferenced old rows
    // are not resolved by project queries once their project assets have been removed.
    await ctx.db.insert("auditLog", {
      actorType: "operator",
      action: "projects.removeRetiredBucket",
      targetType: "projects",
      reason: args.reason,
      meta: JSON.stringify({
        bucket: args.bucket,
        projectIds: [...ids],
        counts,
      }),
      createdAt: Date.now(),
    });
    return { removedProjectIds: [...ids], counts };
  },
});

type CleanupTable =
  | "assets"
  | "projectAssetLinks"
  | "resourceAssetUses"
  | "r2Files"
  | "apiTasks"
  | "productionAssignments"
  | "projectResources"
  | "scriptSegments"
  | "workspaceScripts"
  | "workspaceStaging"
  | "timelineVersions"
  | "timelineLeases"
  | "entities"
  | "promptSheets"
  | "copilotMessages"
  | "proposals"
  | "notes"
  | "exports"
  | "publishedExports"
  | "exportShareLinks"
  | "exportViewerSessions"
  | "genjutsuSessions";
async function bounded<T extends CleanupTable>(ctx: MutationCtx, table: T) {
  const rows = await ctx.db.query(table).take(1001);
  if (rows.length > 1000)
    throw new Error(
      "Cleanup exceeds its small-deployment limit; use a paginated plan",
    );
  return rows;
}
