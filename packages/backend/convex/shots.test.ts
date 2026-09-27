import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";

describe("shots", () => {
  async function seedProject() {
    const t = makeTest();
    const userId = await createTestUser(t, "shots@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    const seeded = await asUser.mutation(api.seed.seedDemoProject, {});
    return { t, asUser, seeded };
  }

  it("lists, updates, reorders, splits and merges shots", async () => {
    const { asUser, seeded } = await seedProject();
    const sceneId = seeded.sceneIds[0]!;

    const listed = await asUser.query(api.shots.listByScene, { sceneId });
    expect(listed.length).toBeGreaterThanOrEqual(2);
    expect(listed.every((s: { status: string }) => s.status === "planned")).toBe(
      true,
    );
    expect(
      listed.every((s: { outdated: boolean }) => s.outdated === false),
    ).toBe(true);

    const first = listed[0]!;
    await asUser.mutation(api.shots.update, {
      shotId: first._id,
      shotType: "close-up",
      durationSec: 7,
      notes: "Hero beat",
    });
    const updated = await asUser.query(api.shots.get, { shotId: first._id });
    expect(updated?.shotType).toBe("close-up");
    expect(updated?.durationSec).toBe(7);
    expect(updated?.notes).toBe("Hero beat");

    const ids = listed.map((s: { _id: (typeof listed)[number]["_id"] }) => s._id);
    const reversed = [...ids].reverse();
    await asUser.mutation(api.shots.reorder, {
      sceneId,
      orderedShotIds: reversed,
    });
    const reordered = await asUser.query(api.shots.listByScene, { sceneId });
    expect(reordered.map((s: { _id: string }) => s._id)).toEqual(reversed);

    const splitFrom = reordered[0]!;
    const newId = await asUser.mutation(api.shots.split, {
      shotId: splitFrom._id,
    });
    const afterSplit = await asUser.query(api.shots.listByScene, { sceneId });
    expect(afterSplit.length).toBe(reordered.length + 1);
    expect(afterSplit.some((s: { _id: string }) => s._id === newId)).toBe(true);

    await asUser.mutation(api.shots.merge, {
      firstShotId: splitFrom._id,
      secondShotId: newId,
    });
    const afterMerge = await asUser.query(api.shots.listByScene, { sceneId });
    expect(afterMerge.length).toBe(reordered.length);
  });

  it("replaceSceneShots / applyShotList replaces a scene", async () => {
    const { asUser, seeded } = await seedProject();
    const sceneId = seeded.sceneIds[0]!;
    const before = await asUser.query(api.shots.listByScene, { sceneId });
    expect(before.length).toBeGreaterThan(0);

    await asUser.mutation(api.shots.replaceSceneShots, {
      projectId: seeded.projectId,
      sceneId,
      shots: [
        {
          shotType: "wide",
          durationSec: 5,
          cameraMove: "static",
          characterIds: [seeded.entityIds.maya],
          locationId: seeded.entityIds.cafe,
          dialogue: "Hello",
          dialogueLineId: "line-1",
        },
        {
          shotType: "close-up",
          durationSec: 3,
          characterIds: [seeded.entityIds.jordan],
        },
      ],
    });
    const after = await asUser.query(api.shots.listByScene, { sceneId });
    expect(after).toHaveLength(2);
    expect(after[0]!.shotType).toBe("wide");
    expect(after[0]!.dialogueLineId).toBe("line-1");
    expect(after[1]!.shotType).toBe("close-up");
  });

  it("flags only linked shots outdated when dialogue text changes", async () => {
    const { t, asUser, seeded } = await seedProject();
    const sceneId = seeded.sceneIds[0]!;
    const lineId = "dlg-linked-1";

    await asUser.mutation(api.shots.replaceSceneShots, {
      projectId: seeded.projectId,
      sceneId,
      shots: [
        {
          shotType: "medium",
          durationSec: 4,
          characterIds: [],
          dialogueLineId: lineId,
          dialogue: "Original line",
        },
        {
          shotType: "wide",
          durationSec: 4,
          characterIds: [],
        },
      ],
    });

    const scene = await asUser.query(api.scenes.get, { sceneId });
    expect(scene).not.toBeNull();

    const previous = {
      schema: "cinakey.script/1.0" as const,
      format: "screenplay" as const,
      scenes: [
        {
          id: scene!.elementId,
          heading: scene!.heading,
          beats: [
            {
              id: "beat-1",
              lines: [
                {
                  id: lineId,
                  characterName: "MAYA",
                  dialogue: "Original line",
                },
              ],
            },
          ],
        },
      ],
      entityLinks: [],
    };
    const next = {
      ...previous,
      scenes: [
        {
          ...previous.scenes[0]!,
          beats: [
            {
              id: "beat-1",
              lines: [
                {
                  id: lineId,
                  characterName: "MAYA",
                  dialogue: "Changed line",
                },
              ],
            },
          ],
        },
      ],
    };

    await t.run(async (ctx) => {
      const { materializeScriptWithPrevious } = await import(
        "./lib/scriptMaterialize"
      );
      await materializeScriptWithPrevious(ctx, {
        projectId: seeded.projectId,
        document: next,
        previousDocument: previous,
      });
    });

    const shots = await asUser.query(api.shots.listByScene, { sceneId });
    const linked = shots.find(
      (s: { dialogueLineId?: string }) => s.dialogueLineId === lineId,
    );
    const unlinked = shots.find(
      (s: { dialogueLineId?: string }) => !s.dialogueLineId,
    );
    expect(linked?.outdated).toBe(true);
    expect(linked?.dialogue).toBe("Changed line");
    expect(unlinked?.outdated).toBe(false);
  });

  it("sets keyframeAssetId without creating a take for image jobs", async () => {
    const { t, asUser, seeded } = await seedProject();
    const shotId = seeded.shotIds[0]!;
    const userId = await t.run(async (ctx) => {
      const u = await ctx.db.query("users").first();
      return u!._id;
    });

    const assetId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(
        new Blob(["fake"], { type: "image/png" }),
      );
      return await ctx.db.insert("assets", {
        projectId: seeded.projectId,
        shotId,
        type: "image",
        name: "keyframe.png",
        searchText: "keyframe.png",
        storageId,
        format: "image/png",
        sizeBytes: 4,
        tags: [],
        starred: false,
        createdBy: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await asUser.mutation(api.shots.setKeyframe, {
      shotId,
      keyframeAssetId: assetId,
    });

    const shot = await asUser.query(api.shots.get, { shotId });
    expect(shot?.keyframeAssetId).toBe(assetId);

    const takes = await t.run(async (ctx) => {
      return await ctx.db
        .query("takes")
        .withIndex("by_shot", (q) => q.eq("shotId", shotId))
        .collect();
    });
    expect(takes).toHaveLength(0);
  });
});
