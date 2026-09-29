import { describe, expect, it } from "vitest";
import {
  BLOCKOUT_SCHEMA_ID,
  BLOCKOUT_SCHEMA_V1,
  applyCameraPreset,
  assertBlockoutDocument,
  camAt,
  emptyPartDocument,
  isBlockoutDocument,
  migrateShotsToPartDocument,
  migrateToV2,
  objAt,
  retimeDocument,
  validateBlockoutDocument,
  type BlockoutCameraKey,
  type BlockoutDocument,
  type BlockoutDocumentV1,
  type BlockoutObject,
} from "./blockout";

function sampleKeys(): BlockoutCameraKey[] {
  return [
    {
      id: "k1",
      f: 0,
      pos: [0, 1, 4],
      target: [0, 1, 0],
      focal: 35,
      roll: 0,
      ease: "inOut",
    },
    {
      id: "k2",
      f: 48,
      pos: [0, 1, 2],
      target: [0, 1, 0],
      focal: 35,
      roll: 0,
      ease: "inOut",
    },
    {
      id: "k3",
      f: 96,
      pos: [0, 1, 0],
      target: [0, 1, -2],
      focal: 24,
      roll: 0,
      ease: "inOut",
    },
  ];
}

describe("blockout engine", () => {
  it("interpolates camera with Catmull-Rom mid-segment", () => {
    const pose = camAt(sampleKeys(), 24);
    expect(pose.pos[2]).toBeLessThan(4);
    expect(pose.pos[2]).toBeGreaterThan(2);
    expect(pose.focal).toBe(35);
  });

  it("treats hold as a hard cut (no tangent borrow)", () => {
    const keys: BlockoutCameraKey[] = [
      {
        id: "a",
        f: 0,
        pos: [0, 1, 10],
        target: [0, 1, 0],
        focal: 35,
        roll: 0,
        ease: "inOut",
      },
      {
        id: "cut",
        f: 24,
        pos: [5, 2, 0],
        target: [5, 1, -5],
        focal: 50,
        roll: 0,
        ease: "hold",
      },
      {
        id: "b",
        f: 48,
        pos: [5, 2, -4],
        target: [5, 1, -8],
        focal: 50,
        roll: 0,
        ease: "inOut",
      },
    ];
    // At hold key — exact cut pose
    const at = camAt(keys, 24);
    expect(at.pos[0]).toBe(5);
    expect(at.focal).toBe(50);
    // After hold: segment cut→b must not use pre-hold key as Catmull neighbour
    const mid = camAt(keys, 36);
    expect(mid.pos[0]).toBeCloseTo(5, 5);
    // Halfway from z=0 toward z=-4
    expect(mid.pos[2]).toBeLessThanOrEqual(0);
    expect(mid.pos[2]).toBeGreaterThanOrEqual(-4);
    expect(mid.focal).toBe(50);
  });

  it("interpolates object facing via shortest path", () => {
    const o: BlockoutObject = {
      id: "o1",
      type: "character",
      name: "Maya",
      color: "#d9795f",
      size: [0.5, 1.7, 0.5],
      pos: [0, 0],
      rot: 0,
      keys: [
        { f: 0, x: 0, z: 0, rot: 350, ease: "linear" },
        { f: 10, x: 2, z: 0, rot: 10, ease: "linear" },
      ],
    };
    const mid = objAt(o, 5);
    // 350 → 10 via 0° (delta +20), midpoint ≈ 360
    const norm = ((mid.rot % 360) + 360) % 360;
    expect(norm === 0 || norm > 355 || norm < 5).toBe(true);
    expect(mid.x).toBeCloseTo(1, 5);
    // Long way would be ~180 at midpoint
    expect(Math.abs(((mid.rot % 360) + 360) % 360 - 180)).toBeGreaterThan(90);
  });

  it("builds push-in preset from live framing", () => {
    const keys = applyCameraPreset("push", 72, {
      pos: [0, 1.6, 6],
      target: [0, 1.4, 0],
      focal: 35,
      roll: 0,
    });
    expect(keys).toHaveLength(2);
    expect(keys[0]!.f).toBe(0);
    expect(keys[1]!.f).toBe(72);
    expect(keys[1]!.pos[2]).toBeLessThan(keys[0]!.pos[2]);
  });

  it("retimes keys when fps or duration changes", () => {
    const doc = emptyPartDocument({
      id: "p",
      title: "T",
      aspectRatio: "16:9",
      fps: 24,
    });
    doc.frames = 48;
    doc.camera.keys = sampleKeys().slice(0, 2);
    doc.shots = [{ n: 1, start: 0, end: 48, desc: "A" }];
    const retimed = retimeDocument(doc, { fps: 48 });
    expect(retimed.fps).toBe(48);
    expect(retimed.frames).toBe(96);
    expect(retimed.camera.keys[1]!.f).toBe(96);
    expect(retimed.shots[0]!.end).toBe(96);
  });
});

describe("cinakey.blockout/2.0", () => {
  it("validates a part document", () => {
    const doc = emptyPartDocument({
      id: "p1",
      title: "Test",
      aspectRatio: "16:9",
      fps: 24,
    });
    expect(doc.schema).toBe(BLOCKOUT_SCHEMA_ID);
    expect(validateBlockoutDocument(doc)).toBeNull();
    expect(isBlockoutDocument(JSON.parse(JSON.stringify(doc)))).toBe(true);
    expect(() => assertBlockoutDocument(doc)).not.toThrow();
  });

  it("rejects broken docs with one-line errors", () => {
    expect(validateBlockoutDocument({ schema: "cinakey.blockout/9.0" })).toMatch(
      /Unsupported schema/,
    );
    expect(
      validateBlockoutDocument({
        schema: BLOCKOUT_SCHEMA_ID,
        version: 1,
        project: { id: "p", title: "t", aspectRatio: "16:9", fps: 24 },
        name: "x",
        fps: 24,
        frames: 10,
        aspect: "16:9",
        camera: { sensor: 36, keys: [] },
        // objects missing
      }),
    ).toMatch(/Missing fields/);
  });

  it("migrates 1.0 shot docs into a part with hold cuts", () => {
    const v1 = (id: string, order: number, durationSec: number): BlockoutDocumentV1 =>
      ({
        schema: BLOCKOUT_SCHEMA_V1,
        version: 1,
        project: { id: "p", title: "Savanna", aspectRatio: "16:9", fps: 24 },
        scenes: [
          {
            id: "sc1",
            order: 0,
            shots: [
              {
                id,
                sceneId: "sc1",
                order,
                durationSec,
                shotType: "WS",
                lensMm: 24,
                characterIds: [],
                camera: {
                  nodeId: "cam",
                  lensMm: 24,
                  keyframes: [
                    {
                      t: 0,
                      position: [0, 1.6, 8],
                      rotation: [0, 0, 0],
                      scale: [1, 1, 1],
                    },
                    {
                      t: durationSec,
                      position: [0, 1.6, 4],
                      rotation: [0, 0, 0],
                      scale: [1, 1, 1],
                    },
                  ],
                },
                characters: [],
                scene: {
                  nodes: [
                    {
                      id: "ground",
                      kind: "ground",
                      name: "Ground",
                      transform: {
                        position: [0, 0, 0],
                        rotation: [0, 0, 0],
                        scale: [1, 1, 1],
                      },
                    },
                    {
                      id: "cam",
                      kind: "camera",
                      name: "Cam",
                      transform: {
                        position: [0, 1.6, 8],
                        rotation: [0, 0, 0],
                        scale: [1, 1, 1],
                      },
                    },
                    {
                      id: "cheetah",
                      kind: "mannequin",
                      name: "Cheetah",
                      entityId: "e1",
                      transform: {
                        position: [-2, 0, 0],
                        rotation: [0, 0, 0],
                        scale: [1, 1, 1],
                      },
                    },
                  ],
                },
                theatre: { sheetId: "Shot", projectState: {} },
              },
            ],
          },
        ],
      }) as BlockoutDocumentV1;

    const part = migrateShotsToPartDocument(
      [
        {
          doc: v1("s1", 0, 4),
          meta: {
            id: "s1",
            order: 0,
            startSec: 0,
            endSec: 4,
            durationSec: 4,
            shotType: "WS",
          },
        },
        {
          doc: v1("s2", 1, 4),
          meta: {
            id: "s2",
            order: 1,
            startSec: 4,
            endSec: 8,
            durationSec: 4,
            shotType: "MS",
          },
        },
      ],
      { id: "p", title: "Savanna", aspectRatio: "16:9", fps: 24 },
      "seq1",
    );

    expect(part.schema).toBe(BLOCKOUT_SCHEMA_ID);
    expect(part.frames).toBe(192);
    expect(part.shots).toHaveLength(2);
    expect(part.shots[1]!.start).toBe(96);
    // Second shot first key should be hold
    const holdKey = part.camera.keys.find((k) => k.f === 96);
    expect(holdKey?.ease).toBe("hold");
    expect(part.objects.some((o) => o.name === "Cheetah")).toBe(true);

    const single = migrateToV2(v1("only", 0, 6));
    expect(single.schema).toBe(BLOCKOUT_SCHEMA_ID);
    expect(validateBlockoutDocument(single)).toBeNull();
  });
});

describe("document identity", () => {
  it("empty part is a valid round-trip", () => {
    const doc: BlockoutDocument = emptyPartDocument({
      id: "p",
      title: "T",
      aspectRatio: "16:9",
      fps: 24,
    });
    const again = JSON.parse(JSON.stringify(doc)) as BlockoutDocument;
    expect(validateBlockoutDocument(again)).toBeNull();
    expect(again.camera.keys.length).toBeGreaterThan(0);
  });
});
