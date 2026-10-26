import { expect, it } from "vitest";
import { api } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";

it("keeps Genjutsu sessions and their media separate from production projects, series, and the global asset library", async () => {
  const t = makeTest();
  const userId = await createTestUser(t, "genjutsu@test.com");
  const user = t.withIdentity(authIdentity(userId));
  const sessionId = await user.mutation(api.genjutsu.create, {
    title: "Watercolor experiment",
  });
  const session = await user.query(api.genjutsu.get, { sessionId });
  expect(session?.title).toBe("Watercolor experiment");
  expect(await user.query(api.genjutsu.list, {})).toHaveLength(1);
  expect(await user.query(api.projects.listMine, {})).toEqual([]);
  expect(
    await user.query(api.projects.get, { projectId: session!.storageScopeId }),
  ).toBeNull();
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["fixture"])),
  );
  const sourceId = await user.mutation(api.storage.createAssetFromUpload, {
    projectId: session!.storageScopeId,
    storageId,
    type: "video",
    name: "Source",
    durationSec: 5,
  });
  await user.mutation(api.genjutsu.update, {
    sessionId,
    sourceAssetId: sourceId,
    title: "Recast experiment",
  });
  expect(await user.query(api.genjutsu.get, { sessionId })).toMatchObject({
    sourceAssetId: sourceId,
    title: "Recast experiment",
  });
  expect(await user.query(api.assets.list, {})).toEqual([]);
  expect(
    await user.query(api.assets.list, { projectId: session!.storageScopeId }),
  ).toHaveLength(1);
  await expect(
    user.mutation(api.series.setMembership, {
      projectId: session!.storageScopeId,
      seriesId: null,
    }),
  ).rejects.toThrow("cannot become series episodes");
  const projectId = await user.mutation(api.projects.create, {
    title: "Regular project",
  });
  expect(await user.query(api.projects.listMine, {})).toHaveLength(1);
  expect(await user.query(api.workspace.videos, { projectId })).toMatchObject({
    videos: [],
    jobs: [],
  });
});
it("rejects cross-session sources and unauthorized session access", async () => {
  const t = makeTest();
  const userId = await createTestUser(t, "owner@test.com");
  const user = t.withIdentity(authIdentity(userId));
  const first = await user.mutation(api.genjutsu.create, { title: "First" });
  const second = await user.mutation(api.genjutsu.create, { title: "Second" });
  const session = await user.query(api.genjutsu.get, { sessionId: first });
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["fixture"])),
  );
  const sourceId = await user.mutation(api.storage.createAssetFromUpload, {
    projectId: session!.storageScopeId,
    storageId,
    type: "video",
    name: "Source",
    durationSec: 5,
  });
  await expect(
    user.mutation(api.genjutsu.update, {
      sessionId: second,
      sourceAssetId: sourceId,
    }),
  ).rejects.toThrow("from this transformation session");
  const other = t.withIdentity(
    authIdentity(await createTestUser(t, "other@test.com")),
  );
  expect(await other.query(api.genjutsu.list, {})).toEqual([]);
  await expect(
    other.query(api.genjutsu.get, { sessionId: first }),
  ).rejects.toThrow();
  await expect(
    other.mutation(api.genjutsu.update, {
      sessionId: first,
      title: "Override",
    }),
  ).rejects.toThrow();
});

it("removes inputs without deleting generation history and requires removing the source before replacing it", async () => {
  const t = makeTest();
  const userId = await createTestUser(t, "removal@test.com");
  const user = t.withIdentity(authIdentity(userId));
  const sessionId = await user.mutation(api.genjutsu.create, {
    title: "Remove test",
  });
  const session = (await user.query(api.genjutsu.get, { sessionId }))!;
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["media fixture"])),
  );
  const first = await user.mutation(api.storage.createAssetFromUpload, {
    projectId: session.storageScopeId,
    storageId,
    name: "Source",
    type: "video",
    durationSec: 5,
    width: 1280,
    height: 720,
  });
  const second = await user.mutation(api.storage.createAssetFromUpload, {
    projectId: session.storageScopeId,
    storageId,
    name: "Another source",
    type: "video",
    durationSec: 5,
    width: 1280,
    height: 720,
  });
  const image = await user.mutation(api.storage.createAssetFromUpload, {
    projectId: session.storageScopeId,
    storageId,
    name: "Actor",
    type: "image",
    width: 1024,
    height: 1024,
  });
  await user.mutation(api.genjutsu.update, { sessionId, sourceAssetId: first });
  await expect(
    user.mutation(api.genjutsu.update, { sessionId, sourceAssetId: second }),
  ).rejects.toThrow("Remove the current source");
  await user.mutation(api.references.bind, {
    projectId: session.storageScopeId,
    alias: "actor",
    assetId: image,
  });
  const args = {
    projectId: session.storageScopeId,
    sourceAssetId: first,
    referenceAssetIds: [image],
    instruction: "Use @actor",
    frames: [0.1, 2, 4].map((timeSec) => ({
      timeSec,
      dataUrl: "data:image/jpeg;base64,/9j/AA==",
    })),
  };
  const { analysis } = await user.action(api.transforms.analyze, args);
  const queued = await user.action(api.transforms.generate, {
    projectId: args.projectId,
    sourceAssetId: first,
    referenceAssetIds: [image],
    resolution: "720p",
    requestId: "preserve-history",
    plan: {
      version: 1,
      targets: [],
      instruction: args.instruction,
      analysis,
      analysisModel: "mock",
      preserveCamera: true,
      preserveMotion: true,
      sampledFrameTimes: [0.1, 2, 4],
    },
  });
  await user.mutation(api.genjutsu.removeInput, { sessionId, assetId: image });
  await expect(user.action(api.transforms.analyze, args)).rejects.toThrow(
    "input was removed",
  );
  await user.mutation(api.genjutsu.removeInput, { sessionId, assetId: first });
  const removed = (await user.query(api.genjutsu.get, { sessionId }))!;
  expect(removed.sourceAssetId).toBeUndefined();
  expect(removed.removedInputAssetIds).toEqual([image, first]);
  expect(await t.run((ctx) => ctx.db.get(image))).not.toBeNull();
  expect(
    await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null),
  ).toBe(true);
  expect(await t.run((ctx) => ctx.db.get(queued.jobId))).toMatchObject({
    status: "queued",
  });
  await expect(
    user.mutation(api.genjutsu.update, { sessionId, sourceAssetId: first }),
  ).rejects.toThrow("removed");
  await user.mutation(api.genjutsu.update, {
    sessionId,
    sourceAssetId: second,
  });
  expect(await user.query(api.genjutsu.get, { sessionId })).toMatchObject({
    sourceAssetId: second,
  });
});
it("rejects input removal from another user's session or another session's media", async () => {
  const t = makeTest();
  const owner = t.withIdentity(
    authIdentity(await createTestUser(t, "owner-removal@test.com")),
  );
  const other = t.withIdentity(
    authIdentity(await createTestUser(t, "other-removal@test.com")),
  );
  const first = await owner.mutation(api.genjutsu.create, { title: "First" });
  const second = await owner.mutation(api.genjutsu.create, { title: "Second" });
  const session = (await owner.query(api.genjutsu.get, { sessionId: first }))!;
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["fixture"])),
  );
  const assetId = await owner.mutation(api.storage.createAssetFromUpload, {
    projectId: session.storageScopeId,
    storageId,
    type: "image",
    name: "Image",
  });
  await expect(
    other.mutation(api.genjutsu.removeInput, { sessionId: first, assetId }),
  ).rejects.toThrow();
  await expect(
    owner.mutation(api.genjutsu.removeInput, { sessionId: second, assetId }),
  ).rejects.toThrow("Input not found");
});
