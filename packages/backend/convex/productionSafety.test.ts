import { describe, expect, it } from "vitest";
import { createEmptyTimeline, assembleFromShotList } from "@cinakey/shared";
import { api, internal } from "../../../apps/api/src/operations";
import { makeTest, createTestUser, authIdentity } from "../test/helpers";

async function fixture() {
  const t = makeTest();
  const userId = await createTestUser(t, "safe@test.com");
  const asUser = t.withIdentity(authIdentity(userId));
  const workspaceId = await asUser.mutation(
    api.users.ensurePersonalWorkspace,
    {},
  );
  const projectId = await asUser.mutation(api.projects.create, {
    title: "Existing project",
  });
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["local media fixture"], { type: "video/mp4" })),
  );
  const assetId = await asUser.mutation(api.storage.createAssetFromUpload, {
    projectId,
    storageId,
    type: "video",
    name: "fixture.mp4",
  });
  const document = assembleFromShotList({
    project: { id: projectId, aspectRatio: "16:9", fps: 24 },
    shots: [
      {
        shotId: "shot",
        sceneOrder: 0,
        shotOrder: 0,
        durationSec: 5,
        take: { takeId: "take", assetId },
      },
    ],
  });
  return { t, asUser, projectId, workspaceId, userId, assetId, document };
}

describe("production safety", () => {
  it("saves indexed media, rejects stale writers and replays an acknowledged request without a new version", async () => {
    const { t, asUser, projectId, assetId, document } = await fixture();
    const request = { projectId, parentId: null, document, requestId: "first" };
    const first = await asUser.action(api.timelineVersions.save, request);
    expect(await asUser.action(api.timelineVersions.save, request)).toEqual(
      first,
    );
    await expect(
      asUser.action(api.timelineVersions.save, {
        ...request,
        requestId: "other-tab",
      }),
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("timelineVersions").collect()),
    ).toHaveLength(1);
    const version = await asUser.query(api.timelineVersions.getVersion, {
      versionId: first.versionId,
    });
    expect(version?.mediaAssetIds).toEqual([assetId]);
    await expect(
      asUser.mutation(api.assets.remove, { assetId }),
    ).rejects.toThrow("saved timeline");
    await expect(
      asUser.mutation(api.storage.deleteAsset, { assetId }),
    ).rejects.toThrow("saved timeline");
    const empty = createEmptyTimeline(document.project);
    await asUser.action(api.timelineVersions.save, {
      projectId,
      parentId: first.versionId,
      document: empty,
      requestId: "empty-edit",
    });
    // Even if no longer present in the current edit, history must remain playable.
    await expect(
      asUser.mutation(api.assets.remove, { assetId }),
    ).rejects.toThrow("saved timeline");
    expect(
      await asUser.query(api.storage.getAssetUrl, { assetId }),
    ).toBeTruthy();
  });

  it("conservatively keeps media for legacy timelines without dependency indexes", async () => {
    const { t, asUser, projectId, userId, assetId } = await fixture();
    await t.run(async (ctx) => {
      const timelineFileId = await ctx.storage.store(
        new Blob(["{}"], { type: "application/json" }),
      );
      await ctx.db.insert("timelineVersions", {
        projectId,
        timelineFileId,
        createdBy: userId,
        createdAt: Date.now(),
      });
    });
    await expect(
      asUser.mutation(api.storage.deleteAsset, { assetId }),
    ).rejects.toThrow("saved timeline");
  });

  it("rejects missing or cross-project snapshot media without publishing a version", async () => {
    const { t, asUser, projectId, document } = await fixture();
    const otherId = await asUser.mutation(api.projects.create, {
      title: "Other project",
    });
    const otherDocument = {
      ...document,
      project: { ...document.project, id: otherId },
    };
    await expect(
      asUser.action(api.timelineVersions.save, {
        projectId: otherId,
        parentId: null,
        document: otherDocument,
        requestId: "wrong-project",
      }),
    ).rejects.toThrow("inaccessible media");
    expect(
      await t.run((ctx) => ctx.db.query("timelineVersions").collect()),
    ).toHaveLength(0);
    expect(await asUser.query(api.projects.get, { projectId })).toBeTruthy();
  });

  it("reserves a duplicate generation only once even when it fills the spending cap", async () => {
    const { t, asUser, projectId } = await fixture();
    await asUser.mutation(api.projects.update, {
      projectId,
      spendCapCredits: 10,
    });
    const before = (await asUser.query(api.credits.getBalance, {})).balance;
    const request = {
      projectId,
      adapterId: "seedance-2.5",
      kind: "text-to-video",
      prompt: "A local test",
      requestId: "same-click",
      input: { durationSec: 5 },
    };
    const first = await asUser.action(api.generation.startGeneration, request);
    const replay = await asUser.action(api.generation.startGeneration, request);
    expect(replay.jobId).toBe(first.jobId);
    expect((await asUser.query(api.credits.getBalance, {})).balance).toBe(
      before - 10,
    );
    await expect(
      asUser.action(api.generation.startGeneration, {
        ...request,
        requestId: "new-run",
      }),
    ).rejects.toThrow("spend cap");
    await expect(
      asUser.action(api.generation.startGeneration, {
        ...request,
        prompt: "Changed",
      }),
    ).rejects.toThrow("different generation settings");
    expect(
      await t.run((ctx) => ctx.db.query("generationJobs").collect()),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("apiTasks").collect()),
    ).toHaveLength(1);
  });

  it("checks spending inside reservation and rejects the former public bypass", async () => {
    const { t, asUser, projectId, workspaceId, userId } = await fixture();
    await asUser.mutation(api.projects.update, {
      projectId,
      spendCapCredits: 10,
    });
    const args = {
      projectId,
      workspaceId,
      createdBy: userId,
      model: "seedance-2.5",
      modelVersion: "test",
      kind: "text-to-video",
      prompt: "fixture",
      estimatedCostCredits: 10,
    };
    await t.mutation(internal.generation.createQueuedJob, args);
    await expect(
      t.mutation(internal.generation.createQueuedJob, args),
    ).rejects.toThrow("spend cap");
    await expect(
      asUser.action(api.generation.startGeneration, {
        projectId,
        adapterId: "seedance-2.5",
        kind: "text-to-video",
        prompt: "fixture",
        skipSpendCapCheck: true,
      } as never),
    ).rejects.toThrow("Unexpected args.skipSpendCapCheck");
  });
  it("keeps an old unselected take and its file when a saved timeline uses them", async () => {
    const { t, asUser, projectId, assetId, document } = await fixture();
    await asUser.action(api.timelineVersions.save, {
      projectId,
      parentId: null,
      document,
      requestId: "keep-history",
    });
    const takeId = await t.run(async (ctx) => {
      const now = Date.now();
      const sceneId = await ctx.db.insert("scenes", {
        projectId,
        elementId: "s",
        order: 0,
        heading: "INT. TEST",
        createdAt: now,
        updatedAt: now,
      });
      const shotId = await ctx.db.insert("shots", {
        projectId,
        sceneId,
        order: 0,
        shotType: "WS",
        durationSec: 5,
        characterIds: [],
        status: "planned",
        outdated: false,
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("takes", {
        projectId,
        shotId,
        assetId,
        selected: false,
        createdAt: now - 40 * 24 * 60 * 60_000,
      });
    });
    await t.mutation(internal.takes.purgeRejectedTakes, {});
    expect(await t.run((ctx) => ctx.db.get(takeId))).toBeTruthy();
    expect(
      await asUser.query(api.storage.getAssetUrl, { assetId }),
    ).toBeTruthy();
  });
  it("allows at most one of two concurrent reservations that would exceed a cap", async () => {
    const { t, asUser, projectId } = await fixture();
    await asUser.mutation(api.projects.update, {
      projectId,
      spendCapCredits: 10,
    });
    const request = {
      projectId,
      adapterId: "seedance-2.5",
      kind: "text-to-video",
      prompt: "Parallel request",
      input: { durationSec: 5 },
    };
    const results = await Promise.allSettled([
      asUser.action(api.generation.startGeneration, {
        ...request,
        requestId: "parallel-a",
      }),
      asUser.action(api.generation.startGeneration, {
        ...request,
        requestId: "parallel-b",
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("generationJobs").collect()),
    ).toHaveLength(1);
  });
});
