import { createEmptyTimeline } from "@cinakey/shared";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";

async function setup() {
  const t = makeTest();
  const userId = await createTestUser(t, "series@test.com");
  const owner = t.withIdentity(authIdentity(userId));
  const seriesId = await owner.mutation(api.series.create, {
    title: "The Harbour",
    aspectRatio: "9:16",
    fps: 30,
  });
  const projectId = await owner.mutation(api.series.createEpisode, {
    seriesId,
    title: "Arrival",
  });
  async function upload(name = "reference.png") {
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["local fixture"], { type: "image/png" })),
    );
    const resourceId = await owner.mutation(api.resources.completeUpload, {
      seriesId,
      storageId,
      type: "image",
      name,
    });
    const versions = await owner.query(api.resources.versions, { resourceId });
    return {
      storageId,
      resourceId,
      version: versions[0]!,
      assetId: versions[0]!.assetIds[0]!,
    };
  }
  return { t, userId, owner, seriesId, projectId, upload };
}

describe("Series production model", () => {
  it("keeps standalone projects separate and snapshots defaults only for new episodes", async () => {
    const { owner, seriesId, projectId } = await setup();
    const standalone = await owner.mutation(api.projects.create, {
      title: "One-off",
    });
    expect(
      (await owner.query(api.projects.get, { projectId: standalone }))
        ?.seriesId,
    ).toBeUndefined();
    const first = await owner.query(api.projects.get, { projectId });
    expect(first).toMatchObject({
      seriesId,
      episodeNumber: 1,
      aspectRatio: "9:16",
      fps: 30,
      seriesSettingsVersion: 1,
    });
    await owner.mutation(api.series.update, {
      seriesId,
      title: "The Harbour",
      description: "Drama",
      aspectRatio: "16:9",
      fps: 24,
      styleNotes: "Muted colours",
      rules: ["Consistent costumes"],
    });
    expect(await owner.query(api.projects.get, { projectId })).toEqual(first);
    const second = await owner.mutation(api.series.createEpisode, {
      seriesId,
      title: "Departure",
    });
    expect(
      await owner.query(api.projects.get, { projectId: second }),
    ).toMatchObject({
      episodeNumber: 2,
      aspectRatio: "16:9",
      fps: 24,
      styleNotes: "Muted colours",
      seriesSettingsVersion: 2,
    });
    await owner.mutation(api.series.applyDefaults, { projectId });
    expect(await owner.query(api.projects.get, { projectId })).toMatchObject({
      aspectRatio: "9:16",
      fps: 30,
      styleNotes: "Muted colours",
      seriesSettingsVersion: 2,
    });
  });
  it("shares one file and asset identity across episodes, including generation and timeline saves", async () => {
    const { t, owner, seriesId, projectId, userId, upload } = await setup();
    const file = await upload();
    const second = await owner.mutation(api.series.createEpisode, {
      seriesId,
      title: "Departure",
    });
    const binding = await owner.mutation(api.resources.useInProject, {
      projectId,
      versionId: file.version._id,
    });
    expect(
      await owner.mutation(api.resources.useInProject, {
        projectId,
        versionId: file.version._id,
      }),
    ).toBe(binding);
    await owner.mutation(api.resources.useInProject, {
      projectId: second,
      versionId: file.version._id,
    });
    for (const id of [projectId, second]) {
      expect(
        (await owner.query(api.assets.list, { projectId: id })).map(
          (a) => a._id,
        ),
      ).toEqual([file.assetId]);
      expect(
        (
          await owner.query(api.storage.listProjectAssetUrls, { projectId: id })
        )[0]?.assetId,
      ).toBe(file.assetId);
      await owner.mutation(internal.generation.assertStartAllowed, {
        userId,
        projectId: id,
        prompt: "A harbour",
        referenceAssetIds: [file.assetId],
      });
      const doc = createEmptyTimeline({ id, aspectRatio: "9:16", fps: 30 });
      doc.tracks
        .find((track) => track.kind === "video")!
        .clips.push({
          id: "shared",
          source: { type: "asset", assetId: file.assetId },
          startSec: 0,
          inSec: 0,
          outSec: 3,
          durationSec: 3,
          speed: 1,
        });
      doc.durationSec = 3;
      const lock = await owner.mutation(api.timelineLeases.claim, {
        projectId: id,
        sessionId: "series-editor",
      });
      if (!lock.held) throw new Error("Expected lease");
      await owner.action(api.timelineVersions.save, {
        projectId: id,
        document: doc,
        parentId: null,
        requestId: "shared-save",
        sessionId: "series-editor",
        fence: lock.fence,
      });
    }
    expect(await t.run((ctx) => ctx.db.query("assets").collect())).toHaveLength(
      1,
    );
    expect(
      await t.run((ctx) => ctx.db.query("mediaFiles").collect()),
    ).toHaveLength(1);
  });
  it("detaches episodes without breaking resource membership, files or saved work", async () => {
    const { owner, seriesId, projectId, upload } = await setup();
    const file = await upload();
    await owner.mutation(api.resources.useInProject, {
      projectId,
      versionId: file.version._id,
    });
    await owner.mutation(api.series.setMembership, {
      projectId,
      seriesId: null,
    });
    expect(
      (await owner.query(api.projects.get, { projectId }))?.seriesId,
    ).toBeUndefined();
    expect(await owner.query(api.assets.list, { projectId })).toHaveLength(1);
    expect(
      await owner.query(api.resources.listForProject, { projectId }),
    ).toHaveLength(1);
    await owner.mutation(api.series.setMembership, { projectId, seriesId });
    expect(
      (await owner.query(api.projects.get, { projectId }))?.aspectRatio,
    ).toBe("9:16");
  });
  it("pins immutable character snapshots and only imports newer versions explicitly", async () => {
    const { t, owner, seriesId, projectId, upload } = await setup();
    const file = await upload();
    const resourceId = await owner.mutation(api.resources.publish, {
      seriesId,
      name: "Mara",
      kind: "character",
      description: "Red coat",
      assetIds: [file.assetId],
    });
    const first = (
      await owner.query(api.resources.versions, { resourceId })
    )[0]!;
    await owner.mutation(api.resources.useInProject, {
      projectId,
      versionId: first._id,
    });
    await owner.mutation(api.resources.publish, {
      seriesId,
      resourceId,
      expectedVersionId: first._id,
      name: "Mara",
      kind: "character",
      description: "Blue coat",
      assetIds: [file.assetId],
    });
    expect(
      (await owner.query(api.entities.listForProject, { projectId }))[0]
        ?.description,
    ).toBe("Red coat");
    const second = (
      await owner.query(api.resources.versions, { resourceId })
    )[0]!;
    await owner.mutation(api.resources.useInProject, {
      projectId,
      versionId: second._id,
    });
    expect(
      (await owner.query(api.entities.listForProject, { projectId })).map(
        (e) => e.description,
      ),
    ).toEqual(["Red coat", "Blue coat"]);
    expect(await t.run((ctx) => ctx.db.get(first._id))).toMatchObject({
      description: "Red coat",
    });
    await expect(
      owner.mutation(api.resources.publish, {
        seriesId,
        resourceId,
        expectedVersionId: first._id,
        name: "Mara",
        kind: "character",
        description: "Stale write",
        assetIds: [],
      }),
    ).rejects.toThrow(/changed/);
  });
  it("preserves full entity sheets when promoted and reused", async () => {
    const { t, owner, seriesId, projectId, upload } = await setup();
    const file = await upload();
    await owner.mutation(api.resources.useInProject, {
      projectId,
      versionId: file.version._id,
    });
    const entityId = await owner.mutation(api.entities.create, {
      projectId,
      kind: "character",
      name: "Mara",
    });
    const sheetFileId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob(
          [
            JSON.stringify({
              schema: "cinakey.sheet/1.0",
              entityKind: "character",
              version: 1,
              wardrobe: "Red coat",
              referenceSheetAssetId: file.assetId,
            }),
          ],
          { type: "application/json" },
        ),
      ),
    );
    await owner.mutation(internal.entities.applySheetBlob, {
      entityId,
      sheetFileId,
      lockedReferenceAssetIds: [file.assetId],
    });
    const resourceId = await owner.mutation(api.resources.publish, {
      seriesId,
      name: "Mara",
      kind: "character",
      description: "Hero",
      sourceEntityId: entityId,
      assetIds: [file.assetId],
    });
    const second = await owner.mutation(api.series.createEpisode, {
      seriesId,
      title: "Next",
    });
    const version = (
      await owner.query(api.resources.versions, { resourceId })
    )[0]!;
    await owner.mutation(api.resources.useInProject, {
      projectId: second,
      versionId: version._id,
    });
    const entity = (
      await owner.query(api.entities.listForProject, { projectId: second })
    )[0]!;
    expect(
      (await owner.action(api.entities.getWithSheet, { entityId: entity._id }))
        .sheet.wardrobe,
    ).toBe("Red coat");
  });
  it("adopts series style as the active style without changing old entities", async () => {
    const { owner, seriesId, projectId, upload } = await setup();
    const old = await owner.mutation(api.entities.ensureStyle, { projectId });
    const file = await upload();
    const resourceId = await owner.mutation(api.resources.publish, {
      seriesId,
      name: "Harbour look",
      kind: "style",
      description: "Muted blue palette",
      assetIds: [file.assetId],
    });
    const version = (
      await owner.query(api.resources.versions, { resourceId })
    )[0]!;
    await owner.mutation(api.resources.useInProject, {
      projectId,
      versionId: version._id,
    });
    const active = await owner.mutation(api.entities.ensureStyle, {
      projectId,
    });
    expect(active).not.toBe(old);
    expect(
      (await owner.action(api.entities.getWithSheet, { entityId: active }))
        .sheet.artStyleBlock,
    ).toBe("Muted blue palette");
    expect(await owner.query(api.projects.get, { projectId })).toMatchObject({
      styleReferenceAssetId: file.assetId,
    });
  });
  it("archiving keeps adopted resources accessible but prevents new adoption", async () => {
    const { owner, seriesId, projectId, upload } = await setup();
    const file = await upload();
    await owner.mutation(api.resources.useInProject, {
      projectId,
      versionId: file.version._id,
    });
    const second = await owner.mutation(api.series.createEpisode, {
      seriesId,
      title: "Next",
    });
    await owner.mutation(api.resources.setArchived, {
      resourceId: file.resourceId,
      archived: true,
    });
    expect(await owner.query(api.assets.list, { projectId })).toHaveLength(1);
    await expect(
      owner.mutation(api.resources.useInProject, {
        projectId: second,
        versionId: file.version._id,
      }),
    ).rejects.toThrow(/Restore/);
    await owner.mutation(api.series.setArchived, { seriesId, archived: true });
    expect(
      (await owner.query(api.series.get, { seriesId })).episodes,
    ).toHaveLength(2);
    await expect(
      owner.mutation(api.series.createEpisode, { seriesId, title: "Blocked" }),
    ).rejects.toThrow(/Restore/);
  });
  it("protects shared library files even before any episode adopts them", async () => {
    const { t, owner, upload } = await setup();
    const file = await upload();
    await expect(
      owner.mutation(api.storage.deleteAsset, { assetId: file.assetId }),
    ).rejects.toThrow(/pinned/);
    await expect(
      owner.mutation(api.assets.remove, { assetId: file.assetId }),
    ).rejects.toThrow(/pinned/);
    expect(
      await t.run((ctx) =>
        ctx.storage.get(file.storageId).then((blob) => !!blob),
      ),
    ).toBe(true);
  });
  it("isolates resource access and imports across workspaces and series", async () => {
    const { t, owner, seriesId, projectId, upload } = await setup();
    const file = await upload();
    const strangerId = await createTestUser(t, "other@test.com");
    const stranger = t.withIdentity(authIdentity(strangerId));
    const otherSeries = await stranger.mutation(api.series.create, {
      title: "Other",
    });
    const otherProject = await stranger.mutation(api.series.createEpisode, {
      seriesId: otherSeries,
      title: "Other episode",
    });
    await expect(stranger.query(api.series.get, { seriesId })).rejects.toThrow(
      /access denied/,
    );
    await expect(
      stranger.query(api.resources.assetUrls, { versionId: file.version._id }),
    ).rejects.toThrow(/access denied/);
    await expect(
      stranger.mutation(api.resources.publish, {
        seriesId: otherSeries,
        kind: "media",
        name: "Stolen",
        description: "",
        assetIds: [file.assetId],
      }),
    ).rejects.toThrow(/access denied/);
    await expect(
      stranger.mutation(api.resources.useInProject, {
        projectId: otherProject,
        versionId: file.version._id,
      }),
    ).rejects.toThrow(/not in/);
    const siblingSeries = await owner.mutation(api.series.create, {
      title: "Sibling",
    });
    const siblingProject = await owner.mutation(api.series.createEpisode, {
      seriesId: siblingSeries,
      title: "Sibling episode",
    });
    await expect(
      owner.mutation(api.resources.useInProject, {
        projectId: siblingProject,
        versionId: file.version._id,
      }),
    ).rejects.toThrow(/not in/);
    await expect(
      owner.mutation(api.series.setMembership, {
        projectId,
        seriesId: otherSeries,
      }),
    ).rejects.toThrow(/access denied/);
  });
  it("rejects generation with unadopted references even in the same workspace", async () => {
    const { owner, projectId, userId, upload } = await setup();
    const file = await upload();
    await expect(
      owner.mutation(internal.generation.assertStartAllowed, {
        userId,
        projectId,
        prompt: "Test",
        referenceAssetIds: [file.assetId],
      }),
    ).rejects.toThrow(/not found/);
    await owner.mutation(api.resources.useInProject, {
      projectId,
      versionId: file.version._id,
    });
    await owner.mutation(internal.generation.assertStartAllowed, {
      userId,
      projectId,
      prompt: "Test",
      referenceAssetIds: [file.assetId],
    });
  });
  it("replays upload completion without new assets, resources or physical files", async () => {
    const { t, owner, seriesId, upload } = await setup();
    const file = await upload();
    expect(
      await owner.mutation(api.resources.completeUpload, {
        seriesId,
        storageId: file.storageId,
        type: "image",
        name: "retry.png",
      }),
    ).toBe(file.resourceId);
    expect(await t.run((ctx) => ctx.db.query("assets").collect())).toHaveLength(
      1,
    );
    expect(
      await t.run((ctx) => ctx.db.query("mediaFiles").collect()),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("libraryResources").collect()),
    ).toHaveLength(1);
  });
  it("enforces numbering, ordering, pagination and likeness consent", async () => {
    const { t, owner, seriesId, projectId, upload } = await setup();
    await expect(
      owner.mutation(api.series.createEpisode, {
        seriesId,
        title: "Duplicate",
        episodeNumber: 1,
      }),
    ).rejects.toThrow(/unique/);
    await expect(
      owner.mutation(api.series.createEpisode, {
        seriesId,
        title: "Invalid",
        episodeNumber: -1,
      }),
    ).rejects.toThrow(/unique/);
    const second = await owner.mutation(api.series.createEpisode, {
      seriesId,
      title: "Second",
    });
    await expect(
      owner.mutation(api.series.reorderEpisodes, {
        seriesId,
        projectIds: [projectId, projectId],
      }),
    ).rejects.toThrow(/exactly once/);
    await owner.mutation(api.series.reorderEpisodes, {
      seriesId,
      projectIds: [second, projectId],
    });
    expect(
      (await owner.query(api.series.get, { seriesId })).episodes.map(
        (e) => e._id,
      ),
    ).toEqual([second, projectId]);
    await upload("one.png");
    await upload("two.png");
    const page = await owner.query(api.resources.list, { seriesId, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(
      (
        await owner.query(api.resources.list, {
          seriesId,
          limit: 1,
          cursor: page.cursor,
        })
      ).items[0]?.resource._id,
    ).not.toBe(page.items[0]?.resource._id);
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["face"], { type: "image/png" })),
    );
    await expect(
      owner.mutation(api.resources.completeUpload, {
        seriesId,
        storageId,
        type: "image",
        name: "face.png",
        containsLikeness: true,
      }),
    ).rejects.toThrow(/consent/);
  });
  it("purges the new resource graph and files during full account deletion", async () => {
    const { t, owner, userId, projectId, upload } = await setup();
    const file = await upload();
    await owner.mutation(api.resources.useInProject, {
      projectId,
      versionId: file.version._id,
    });
    await owner.mutation(internal.users.purgeUserData, { userId });
    for (const table of [
      "series",
      "libraryResources",
      "resourceVersions",
      "resourceAssetUses",
      "projectResources",
      "projectAssetLinks",
      "mediaFiles",
      "assets",
    ] as const)
      expect(await t.run((ctx) => ctx.db.query(table).collect())).toHaveLength(
        0,
      );
    expect(
      await t.run((ctx) =>
        ctx.storage.get(file.storageId).then((blob) => !!blob),
      ),
    ).toBe(false);
  });
  it("rejects registering another workspace's stored file as a series upload", async () => {
    const { t, upload } = await setup();
    const file = await upload();
    const otherId = await createTestUser(t, "file-thief@test.com");
    const other = t.withIdentity(authIdentity(otherId));
    const otherSeries = await other.mutation(api.series.create, {
      title: "Other",
    });
    await expect(
      other.mutation(api.resources.completeUpload, {
        seriesId: otherSeries,
        storageId: file.storageId,
        type: "image",
        name: "stolen.png",
      }),
    ).rejects.toThrow(/another workspace/);
  });
});

it("promotes an unused upload into a named resource without a duplicate, and offers its name to script references", async () => {
  const { owner, seriesId, projectId, upload } = await setup();
  const file = await upload("original.png");
  const id = await owner.mutation(api.resources.publish, {
    seriesId,
    kind: "character",
    name: "Jess",
    description: "Shared character",
    assetIds: [file.assetId],
  });
  expect(id).toBe(file.resourceId);
  const page = await owner.query(api.resources.list, { seriesId });
  expect(page.items).toHaveLength(1);
  expect(page.items[0]?.resource.kind).toBe("character");
  const refs = await owner.query(api.resources.referenceCandidates, {
    projectId,
  });
  expect(refs[0]?.name).toBe("Jess");
  await owner.mutation(api.resources.useInProject, {
    projectId,
    versionId: refs[0]!.versionId,
  });
  await owner.mutation(api.resources.setArchived, {
    resourceId: id,
    archived: true,
  });
  expect(
    await owner.query(api.resources.referenceCandidates, { projectId }),
  ).toHaveLength(0);
  expect(
    await owner.query(api.resources.listForProject, { projectId }),
  ).toHaveLength(1);
});
