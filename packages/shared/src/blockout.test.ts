import { describe, expect, it } from "vitest";
import {
  BLOCKOUT_SCHEMA_ID,
  assertBlockoutDocument,
  blockoutTransform,
  extractShotForImport,
  finalizeShot,
  isBlockoutDocument,
  mergeBlockoutDocuments,
  singleShotDocument,
  tracksFromShot,
  validateBlockoutDocument,
  type BlockoutNode,
  type BlockoutProject,
  type BlockoutShot,
  type BlockoutTracks,
} from "./blockout";

const project: BlockoutProject = {
  id: "p1",
  title: "Test",
  aspectRatio: "16:9",
  fps: 24,
};

function makeShot(id: string, sceneId: string, order: number, tracks: BlockoutTracks = {}): BlockoutShot {
  const nodes: BlockoutNode[] = [
    { id: "ground", kind: "ground", name: "Ground", transform: blockoutTransform() },
    { id: "cam", kind: "camera", name: "Shot camera", transform: blockoutTransform([0, 1.6, 6]) },
    {
      id: "m1",
      kind: "mannequin",
      name: "Ana",
      entityId: "e1",
      pose: "standing",
      transform: blockoutTransform([-1, 0, 0]),
    },
    {
      id: "m2",
      kind: "mannequin",
      name: "Ben",
      entityId: "e2",
      pose: "sitting",
      transform: blockoutTransform([1, 0, 0]),
    },
  ];
  return finalizeShot(
    {
      id,
      sceneId,
      order,
      durationSec: 5,
      shotType: "MS",
      lensMm: 35,
      characterIds: ["e1", "e2"],
      camera: { nodeId: "cam" },
      scene: { nodes },
    },
    tracks,
    project.fps,
  );
}

const pushIn: BlockoutTracks = {
  cam: [
    { t: 0, position: [0, 1.6, 6], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { t: 5, position: [0, 1.6, 3], rotation: [0, 0.1, 0], scale: [1, 1, 1] },
  ],
};

describe("cinakey.blockout/1.0", () => {
  it("validates a single-shot document", () => {
    const doc = singleShotDocument(project, { id: "s1", order: 0 }, makeShot("sh1", "s1", 0, pushIn));
    expect(doc.schema).toBe(BLOCKOUT_SCHEMA_ID);
    expect(validateBlockoutDocument(doc)).toBeNull();
    expect(isBlockoutDocument(JSON.parse(JSON.stringify(doc)))).toBe(true);
  });

  it("rejects unknown schema versions and broken shots", () => {
    const doc = singleShotDocument(project, { id: "s1", order: 0 }, makeShot("sh1", "s1", 0));
    expect(() => assertBlockoutDocument({ ...doc, schema: "cinakey.blockout/2.0" })).toThrow(
      /Unsupported schema/,
    );
    const broken = JSON.parse(JSON.stringify(doc));
    broken.scenes[0].shots[0].scene.nodes[1].kind = "spaceship";
    expect(validateBlockoutDocument(broken)).toMatch(/kind invalid/);
  });

  it("round-trips keyframes through Theatre state", () => {
    const shot = makeShot("sh1", "s1", 0, pushIn);
    expect(shot.camera.keyframes).toHaveLength(2);
    const restored = tracksFromShot(JSON.parse(JSON.stringify(shot)));
    expect(restored).toEqual(pushIn);
  });

  it("summarizes characters with positions and keyframes", () => {
    const shot = makeShot("sh1", "s1", 0, {
      m1: [{ t: 1, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
    });
    expect(shot.characters.map((c) => [c.id, c.pose, c.keyframes.length])).toEqual([
      ["e1", "standing", 1],
      ["e2", "sitting", 0],
    ]);
  });

  it("merges shot documents into scenes and extracts for import", () => {
    const a = singleShotDocument(project, { id: "s1", order: 0, heading: "INT. A" }, makeShot("a", "s1", 1));
    const b = singleShotDocument(project, { id: "s1", order: 0 }, makeShot("b", "s1", 0, pushIn));
    const c = singleShotDocument(project, { id: "s2", order: 1 }, makeShot("c", "s2", 0));
    const merged = mergeBlockoutDocuments([c, a, b], project);
    expect(validateBlockoutDocument(merged)).toBeNull();
    expect(merged.scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(merged.scenes[0]!.shots.map((s) => s.id)).toEqual(["b", "a"]);
    expect(merged.scenes[0]!.heading).toBe("INT. A");

    const imported = extractShotForImport(merged, { id: "b", sceneId: "s1", order: 0 });
    expect(tracksFromShot(imported)).toEqual(pushIn);
    expect(() => extractShotForImport(merged, { id: "zzz", sceneId: "s9", order: 0 })).toThrow(
      /Choose which shot/,
    );
    const rebound = extractShotForImport(merged, { id: "zzz", sceneId: "s9", order: 3 }, "c");
    expect([rebound.id, rebound.sceneId, rebound.order]).toEqual(["zzz", "s9", 3]);
  });
});
