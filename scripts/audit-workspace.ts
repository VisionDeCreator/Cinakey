import { loadRootEnvironment } from "../apps/api/src/config/load-root-env";
loadRootEnvironment();
const { registry } = await import("../apps/api/src/registry");
const { createContext } = await import("../apps/api/src/runtime/context");
const { internal } = await import("../apps/api/src/operations");
const { loadJson } = await import("../packages/backend/convex/storage");
const { assertTimelineDocument, assertBlockoutDocument } =
  await import("../packages/shared/src/index");
const ctx = createContext(registry);
const state = await ctx.runQuery(internal.workspace.auditAll, {});
const assetIds = new Set(state.assets.map((a) => a._id));
let files = 0;
let legacyGuideKeys = 0;
await check(state.timelines, async (version) => {
  const doc = assertTimelineDocument(
    await loadJson(ctx, version.timelineFileId),
  );
  if (doc.project.id !== version.projectId)
    throw new Error("Timeline ownership mismatch");
  for (const track of doc.tracks)
    for (const clip of track.clips) {
      if (clip.source.type === "text") continue;
      if (!assetIds.has(clip.source.assetId as any))
        throw new Error("Missing timeline asset");
      if (
        clip.source.proxyAssetId &&
        !assetIds.has(clip.source.proxyAssetId as any)
      )
        throw new Error("Missing proxy");
    }
  files++;
});
await check(state.staging, async (staging) => {
  let id: string | undefined = staging.contentFileId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const doc = assertBlockoutDocument(await loadJson(ctx, id));
    if (Object.keys(doc.guides ?? {}).some((key) => !/^n\d+$/.test(key)))
      legacyGuideKeys++;
    if (doc.sequenceId || doc.shots.some((c) => c.shotId))
      throw new Error("Old production IDs in staging file");
    id = doc.parentFileId;
    files++;
  }
  for (const plan of staging.planHistory ?? [])
    if (!seen.has(plan.contentFileId))
      throw new Error("Orphan plan provenance");
});
await check(state.scripts, async (script) => {
  if (script.contentFileId) {
    if (typeof (await loadJson(ctx, script.contentFileId)) !== "string")
      throw new Error("Script is not text");
    files++;
  }
});
if (legacyGuideKeys) throw new Error("Unmapped staging guides");
for (const project of state.projects) {
  const tips = state.scripts.filter(
    (s) => s.projectId === project._id && s.isTip,
  );
  if (tips.length !== 1) throw new Error("Invalid script tip count");
  console.log(
    JSON.stringify({
      projectId: project._id,
      assets: state.assets.filter((a) => a.projectId === project._id).length,
      jobs: state.jobs.filter((j) => j.projectId === project._id).length,
      scripts: state.scripts.filter((s) => s.projectId === project._id).length,
      staging: state.staging.filter((s) => s.projectId === project._id).length,
      timelines: state.timelines.filter((t) => t.projectId === project._id)
        .length,
    }),
  );
}
console.log(
  JSON.stringify({
    projects: state.projects.length,
    assets: state.assets.length,
    jobs: state.jobs.length,
    timelines: state.timelines.length,
    staging: state.staging.length,
    verifiedFiles: files,
    legacyGuideKeys,
  }),
);

async function check<T>(rows: T[], verify: (row: T) => Promise<void>) {
  for (let start = 0; start < rows.length; start += 8) {
    const results = await Promise.allSettled(
      rows.slice(start, start + 8).map(verify),
    );
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
  }
}
