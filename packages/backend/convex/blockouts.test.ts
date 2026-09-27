import {
  blockoutTransform,
  finalizeShot,
  singleShotDocument,
  tracksFromShot,
  type BlockoutTracks,
} from "@cinakey/shared";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";

const pushIn: BlockoutTracks = {
  cam: [
    { t: 0, position: [0, 1.6, 6], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { t: 2, position: [0, 1.6, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
  ],
};

function editorDocument(shotId: string, sceneId: string) {
  const shot = finalizeShot(
    {
      id: shotId,
      sceneId,
      order: 0,
      durationSec: 2,
      shotType: "MS",
      lensMm: 50,
      characterIds: [],
      camera: { nodeId: "cam" },
      scene: {
        nodes: [
          { id: "cam", kind: "camera", name: "Shot camera", transform: blockoutTransform([0, 1.6, 6]) },
          { id: "m1", kind: "mannequin", name: "A", pose: "standing", transform: blockoutTransform([-1, 0, 0]) },
          { id: "m2", kind: "mannequin", name: "B", pose: "walking", transform: blockoutTransform([1, 0, 0]) },
        ],
      },
    },
    pushIn,
    24,
  );
  return singleShotDocument(
    { id: "p", title: "t", aspectRatio: "16:9", fps: 24 },
    { id: sceneId, order: 0 },
    shot,
  );
}

describe("blockouts", () => {
  it("saves versioned files, reloads exactly, exports and re-imports", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "blk@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    const seeded = await asUser.mutation(api.seed.seedDemoProject, {});
    const [shotA, shotB] = seeded.shotIds;
    const a = await t.run(async (ctx) => ctx.db.get(shotA!));

    const first = await asUser.action(api.blockouts.save, {
      shotId: shotA!,
      document: editorDocument(shotA!, a!.sceneId),
    });
    const second = await asUser.action(api.blockouts.save, {
      shotId: shotA!,
      document: first.document,
    });
    expect(second.document.version).toBe(first.document.version + 1);
    expect(second.document.parentFileId).toBe(first.fileId);

    const loaded = await asUser.action(api.blockouts.get, { shotId: shotA! });
    const shot = loaded!.document.scenes[0]!.shots[0]!;
    expect(shot.lensMm).toBe(50);
    expect(shot.scene.nodes.map((n) => n.id)).toEqual(["cam", "m1", "m2"]);
    expect(tracksFromShot(shot).cam!.map((k) => k.position[2])).toEqual([6, 3]);

    const after = await t.run(async (ctx) => ctx.db.get(shotA!));
    expect(after!.status).toBe("blocked_out");
    expect(after!.lensMm).toBe(50);

    const exported = await asUser.action(api.blockouts.exportDocument, {
      projectId: seeded.projectId,
      sceneId: a!.sceneId,
    });
    expect(exported.document.scenes[0]!.shots.map((s) => s.id)).toContain(shotA);

    const imported = await asUser.action(api.blockouts.importToShot, {
      shotId: shotB!,
      document: JSON.parse(JSON.stringify(exported.document)),
      sourceShotId: shotA!,
    });
    const importedShot = imported.document.scenes[0]!.shots[0]!;
    expect(importedShot.id).toBe(shotB);
    expect(importedShot.scene.nodes).toHaveLength(3);
  });
});
