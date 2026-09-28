import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { createTestUser, makeTest } from "../test/helpers";

describe("purgeRejectedTakes", () => {
  it("purges old unselected unstarred takes and keeps starred", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "purge@test.com");

    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const old = now - 40 * 24 * 60 * 60 * 1000;
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "W",
        ownerUserId: userId,
        starterCreditsGrantedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(userId, { personalWorkspaceId: workspaceId });
      const projectId = await ctx.db.insert("projects", {
        workspaceId,
        title: "P",
        aspectRatio: "16:9",
        fps: 24,
        rules: [],
        createdAt: now,
        updatedAt: now,
      });
      const sceneId = await ctx.db.insert("scenes", {
        projectId,
        elementId: "e1",
        order: 0,
        heading: "INT.",
        createdAt: now,
        updatedAt: now,
      });
      const shotId = await ctx.db.insert("shots", {
        projectId,
        sceneId,
        order: 0,
        shotType: "WS",
        durationSec: 3,
        characterIds: [],
        status: "planned",
        outdated: false,
        createdAt: now,
        updatedAt: now,
      });
      const storageA = await ctx.storage.store(
        new Blob(["a"], { type: "video/mp4" }),
      );
      const storageB = await ctx.storage.store(
        new Blob(["b"], { type: "video/mp4" }),
      );
      const assetKeep = await ctx.db.insert("assets", {
        projectId,
        type: "video",
        name: "keep",
        searchText: "keep",
        storageId: storageA,
        format: "video/mp4",
        sizeBytes: 1,
        tags: [],
        starred: true,
        createdBy: userId,
        createdAt: old,
        updatedAt: old,
      });
      const assetPurge = await ctx.db.insert("assets", {
        projectId,
        type: "video",
        name: "purge",
        searchText: "purge",
        storageId: storageB,
        format: "video/mp4",
        sizeBytes: 1,
        tags: [],
        starred: false,
        createdBy: userId,
        createdAt: old,
        updatedAt: old,
      });
      const takeKeep = await ctx.db.insert("takes", {
        projectId,
        shotId,
        assetId: assetKeep,
        selected: false,
        createdAt: old,
      });
      const takePurge = await ctx.db.insert("takes", {
        projectId,
        shotId,
        assetId: assetPurge,
        selected: false,
        createdAt: old,
      });
      return { takeKeep, takePurge, assetKeep, assetPurge };
    });

    const result = await t.mutation(internal.takes.purgeRejectedTakes, {
      now: Date.now(),
      limit: 50,
    });
    expect(result.purged).toBeGreaterThanOrEqual(1);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(ids.takeKeep)).not.toBeNull();
      expect(await ctx.db.get(ids.takePurge)).toBeNull();
      expect(await ctx.db.get(ids.assetKeep)).not.toBeNull();
      expect(await ctx.db.get(ids.assetPurge)).toBeNull();
    });
  });
});
