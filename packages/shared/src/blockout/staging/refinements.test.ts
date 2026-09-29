/**
 * Regressions from reviewing real staged parts against their scripts
 * (girl / hare chasm chase, boy / cheetah savanna hunt).
 */
import { describe, expect, it } from "vitest";
import { parseScriptPromptText } from "../../prompt-templates/parse";
import { camAt, objAt } from "../engine";
import { compileStagingPlanWithInfo } from "./compile";
import { parseStagingPlan } from "./schema";

const PROJECT = { id: "p", title: "T", aspectRatio: "16:9", fps: 24 };
const F = (t: number) => Math.round(t * 24);

function script(shots: string[], total: number) {
  return `REFERENCES
@image_1 = the girl. Use it for her face.
@image_2 = the giant riding hare. Use it for the mount.
ART STYLE — LOCKED TO THE REFERENCE IMAGES:
Painted.
IMAGE QUALITY — ALWAYS SHARP AND CLEAN:
Sharp.
THE GIRL — @image_1, identical in every shot:
A young rider.
THE HARE — @image_2: a giant riding hare with a saddle she rides.
LOCATION — @image_2: a night forest ending at a misty chasm with a waterfall.
SHOTS (${total} seconds total, multi-shot, 16:9):
${shots.join("\n")}
CONSISTENCY:
Same.
MOTION AND PHYSICS:
Real.
LIGHTING:
Moonlight.
TECHNICAL:
16:9, 24fps.
MUSIC:
None.
AUDIO (native sound, synced to picture):
0.0s wind.
`;
}

function compile(text: string, planJson: unknown) {
  const parsed = parseStagingPlan(JSON.parse(JSON.stringify(planJson)));
  if (!parsed.ok) throw new Error(parsed.error);
  return compileStagingPlanWithInfo(
    parsed.plan,
    parseScriptPromptText(text),
    PROJECT,
  ).document;
}
const obj = (doc: ReturnType<typeof compile>, id: string) =>
  doc.objects.find((o) => o.id === `cast-${id}` || o.name === id)!;

const CHASE = script(
  [
    "Shot 1 (0.0s–2.0s) — Close-up: a gloved hand holds out a heavy leather pouch; the stranger's face stays hidden.",
    "Shot 2 (2.0s–4.0s) — Medium: she tucks the pouch away and swings up into the saddle of the hare.",
    "Shot 3 (4.0s–7.0s) — Tracking shot alongside: the hare bounds through the forest as a raptor pulls up alongside her.",
    "Shot 4 (7.0s–8.0s) — Close-up on her face: she glances back over her shoulder.",
    "Shot 5 (8.0s–9.0s) — Medium: she twists round in the saddle and fires back at the raptor.",
    "Shot 6 (9.0s–12.0s) — Wide side shot: the hare leaps across the chasm, the waterfall far below.",
    "Shot 7 (12.0s–14.0s) — Wide shot from her side: the raptor skids to a stop at the far edge.",
    "Shot 8 (14.0s–16.0s) — Close-up: she looks back, pats the satchel and rides off. Hard cut to black on the final beat.",
  ],
  16,
);

const CHASE_PLAN = {
  schema: "cinakey.staging/1.0",
  set: {
    terrain: "forest",
    timeOfDay: "night",
    features: [
      { kind: "chasm", id: "chasm", at: [48, 0], size: [6, 30, 200] },
      { kind: "box", name: "waterfall", at: [48, 0], size: [6, 30, 24] },
      { kind: "rock", name: "Rock", at: [30, 0], size: [2.6, 2, 2.2] },
    ],
  },
  cast: [
    {
      id: "girl",
      name: "the girl",
      kind: "person",
      imageN: 1,
      at: [1, 1],
      facing: 90,
    },
    {
      id: "hare",
      name: "the giant riding hare",
      kind: "quadruped",
      imageN: 2,
      size: [1.1, 2.6, 2.8],
      at: [2, 0],
      facing: 90,
    },
    {
      id: "stranger",
      name: "the stranger",
      kind: "person",
      at: [0, -1.5],
      facing: 0,
      visible: [[0, 2]],
    },
    {
      id: "pouch",
      name: "gold pouch",
      kind: "prop",
      at: [0, -1.2],
      carriedBy: "stranger",
      visible: [[0, 2]],
    },
    {
      id: "raptor",
      name: "raptor",
      kind: "creature",
      at: [-10, 3],
      facing: 90,
    },
  ],
  shots: [
    {
      n: 1,
      moves: [],
      camera: {
        size: "cu",
        angle: "eye",
        side: "front",
        move: "static",
        pov: "girl",
      },
    },
    {
      n: 2,
      moves: [
        { who: "girl", action: "mount", target: "hare", from: 0.3, to: 0.6 },
      ],
      camera: {
        size: "medium",
        angle: "eye",
        side: "front_left",
        move: "static",
        subject: "girl",
      },
    },
    {
      n: 3,
      moves: [
        { who: "hare", action: "run", path: [[40, 0]] },
        {
          who: "raptor",
          action: "run",
          follow: "girl",
          offset: [0, 2],
          from: 0.2,
        },
      ],
      camera: {
        size: "full",
        angle: "low",
        side: "left",
        move: "track",
        subject: "hare",
      },
    },
    {
      n: 4,
      moves: [
        { who: "hare", action: "sprint", path: [[55, 0]] },
        { who: "raptor", action: "run", path: [[50, 3]] },
      ],
      camera: {
        size: "cu",
        angle: "eye",
        side: "front",
        move: "follow",
        subject: "girl",
      },
    },
    {
      n: 5,
      moves: [
        { who: "hare", action: "sprint", path: [[70, 0]] },
        { who: "girl", action: "fire", face: "raptor" },
        { who: "raptor", action: "run", path: [[62, 3]] },
      ],
      camera: {
        size: "medium",
        angle: "eye",
        side: "front",
        move: "follow",
        subject: "girl",
      },
    },
    {
      n: 6,
      moves: [
        { who: "hare", action: "leap", path: [[100, 0]], height: 3 },
        { who: "raptor", action: "run", path: [[80, 3]] },
      ],
      camera: {
        size: "wide",
        angle: "eye",
        side: "left",
        move: "static",
        subject: "hare",
      },
    },
    {
      n: 7,
      moves: [
        { who: "hare", action: "run", path: [[110, 0]] },
        { who: "raptor", action: "stand" },
      ],
      camera: {
        size: "wide",
        angle: "eye",
        side: "back",
        move: "static",
        subject: "raptor",
        from: "girl",
      },
    },
    {
      n: 8,
      moves: [{ who: "hare", action: "run", path: [[125, 0]] }],
      camera: {
        size: "cu",
        angle: "eye",
        side: "front",
        move: "follow",
        subject: "girl",
        black: true,
      },
    },
  ],
};

describe("staging refinements (girl / hare chase)", () => {
  const doc = compile(CHASE, CHASE_PLAN);
  const girl = obj(doc, "girl");
  const hare = obj(doc, "hare");
  const raptor = obj(doc, "raptor");

  it("moves the chasm to where the hare actually leaps, and the waterfall down into it", () => {
    const grounds = doc.objects.filter((o) => o.name === "Ground");
    expect(grounds).toHaveLength(2);
    const gapStart = Math.min(...grounds.map((g) => g.pos[0] + g.size[0] / 2));
    const gapEnd = Math.max(...grounds.map((g) => g.pos[0] - g.size[0] / 2));
    expect(gapStart).toBeGreaterThan(70);
    expect(gapEnd).toBeLessThan(100);
    // Airborne over the middle of the gap
    const mid = (gapStart + gapEnd) / 2;
    let peak = 0;
    for (let f = F(9); f <= F(12); f++) {
      const p = objAt(hare, f);
      if (Math.abs(p.x - mid) < 1.5) peak = Math.max(peak, p.y);
    }
    expect(peak).toBeGreaterThan(2);
    const falls = doc.objects.find((o) => o.name === "waterfall")!;
    expect(falls.pos[0]).toBeGreaterThan(gapStart - 1);
    expect(falls.pos[0]).toBeLessThan(gapEnd + 1);
    // Sunk into the gap (top below the rim), and kept to a sane size
    expect(falls.y! + falls.size[1]).toBeLessThan(0);
    expect(falls.size[1]).toBeLessThanOrEqual(4);
  });

  it("keeps a rock that sat on the chase path out of the way", () => {
    const rock = doc.objects.find((o) => o.name === "Rock")!;
    expect(Math.abs(rock.pos[1])).toBeGreaterThan(1.5);
  });

  it("POV with no subject frames what the line names (the pouch), not empty forest", () => {
    const c = camAt(doc.camera.keys, F(1));
    const pouch = objAt(obj(doc, "pouch"), F(1));
    expect(
      Math.hypot(c.target[0] - pouch.x, c.target[2] - pouch.z),
    ).toBeLessThan(0.5);
  });

  it("raptor pulls up alongside on her left", () => {
    const g = objAt(girl, F(6.5));
    const r = objAt(raptor, F(6.5));
    expect(Math.abs(r.x - g.x)).toBeLessThan(0.8);
    expect(Math.abs(r.z - g.z - -2)).toBeLessThan(0.8); // her left is −z when heading +x
  });

  it("rider turns her head: script 'glances back', and 'fires back at the raptor'", () => {
    const d = (t: number) =>
      Math.abs(
        ((((objAt(girl, F(t)).rot - objAt(hare, F(t)).rot) % 360) + 540) %
          360) -
          180,
      );
    expect(d(6)).toBeLessThan(10);
    expect(d(7.5)).toBeGreaterThan(120);
    expect(d(8.6)).toBeGreaterThan(120);
  });

  it("locked-off shot of the fast leap pans from a sensible distance", () => {
    const c = camAt(doc.camera.keys, F(10.5));
    const h = objAt(hare, F(10.5));
    expect(Math.hypot(c.pos[0] - h.x, c.pos[2] - h.z)).toBeLessThan(25);
  });

  it("'wide shot from her side' puts the camera at her", () => {
    const c = camAt(doc.camera.keys, F(13));
    const g = objAt(girl, F(13));
    expect(Math.hypot(c.pos[0] - g.x, c.pos[2] - g.z)).toBeLessThan(2.5);
  });

  it("cut to black on the final beat blacks only the tail of the shot", () => {
    expect(camAt(doc.camera.keys, F(15)).pos[1]).toBeLessThan(10);
    expect(camAt(doc.camera.keys, F(15.9)).pos[1]).toBeGreaterThan(50);
  });
});

describe("staging refinements (boy / cheetah hunt)", () => {
  const HUNT = script(
    [
      "Shot 1 (0.0s–2.0s) — Low shot: lying flat on his stomach, he slides the rifle forward.",
      "Shot 2 (2.0s–3.0s) — Close-up: he settles his eye behind the scope.",
      "Shot 3 (3.0s–4.0s) — Wide: he fires.",
      "Shot 4 (4.0s–6.0s) — Low shot at ground level: the herd explodes into motion.",
      "Shot 5 (6.0s–8.0s) — Wide: the boy watches.",
      "Shot 6 (8.0s–9.0s) — Close-up at the antelope's hooves as it bolts.",
      "Shot 7 (9.0s–11.0s) — Low angle: he rides off, the bird in his lowered hand, the rifle slung on his back.",
    ],
    11,
  );
  const PLAN = {
    schema: "cinakey.staging/1.0",
    set: { terrain: "open", timeOfDay: "golden", features: [] },
    cast: [
      { id: "boy", name: "the boy", kind: "person", at: [0, 0], facing: 90 },
      {
        id: "cheetah",
        name: "cheetah",
        kind: "quadruped",
        at: [-1, 1.5],
        facing: 90,
      },
      {
        id: "rifle",
        name: "rifle",
        kind: "prop",
        at: [0, 0],
        carriedBy: "boy",
      },
      {
        id: "ant",
        name: "antelope",
        kind: "quadruped",
        size: [0.7, 1.2, 1.8],
        at: [20, 0],
        facing: 90,
      },
      {
        id: "bird",
        name: "bird",
        kind: "bird",
        at: [0, 0],
        carriedBy: "boy",
        carry: "low",
        visible: [[9, 11]],
      },
    ],
    shots: [
      {
        n: 1,
        moves: [{ who: "boy", action: "lie" }],
        camera: {
          size: "medium",
          angle: "low",
          side: "back",
          move: "static",
          subject: "boy",
        },
      },
      {
        n: 2,
        moves: [{ who: "boy", action: "reach" }],
        camera: {
          size: "cu",
          angle: "low",
          side: "front",
          move: "static",
          subject: "boy",
        },
      },
      {
        n: 3,
        moves: [{ who: "boy", action: "fire" }],
        camera: {
          size: "wide",
          angle: "low",
          side: "front_left",
          move: "static",
          subject: "boy",
        },
      },
      {
        n: 4,
        moves: [{ who: "ant", action: "run", path: [[40, 0]] }],
        camera: {
          size: "wide",
          angle: "ground",
          side: "front",
          move: "static",
          subject: "ant",
        },
      },
      {
        n: 5,
        moves: [],
        camera: {
          size: "wide",
          angle: "eye",
          side: "front",
          move: "static",
          subject: "boy",
        },
      },
      {
        n: 6,
        moves: [],
        camera: {
          size: "insert",
          angle: "ground",
          side: "left",
          move: "follow",
          subject: "ant",
        },
      },
      {
        n: 7,
        moves: [
          { who: "boy", action: "mount", target: "cheetah", to: 0.2 },
          { who: "cheetah", action: "walk", from: 0.2, path: [[3, 1.5]] },
          { who: "rifle", action: "idle", carry: "back" },
        ],
        camera: {
          size: "full",
          angle: "low",
          side: "back",
          move: "static",
          subject: "cheetah",
        },
      },
    ],
  };
  const doc = compile(HUNT, PLAN);

  it("stays lying flat through reach / fire until he gets up", () => {
    for (const t of [1, 2.5, 3.5, 5, 7.5])
      expect(objAt(obj(doc, "boy"), F(t)).y).toBeLessThan(-0.9);
  });

  it("the herd keeps running through the cut, then eases to a stop (never runs off forever)", () => {
    const ant = obj(doc, "ant");
    expect(objAt(ant, F(7)).x).toBeGreaterThan(objAt(ant, F(6)).x + 5);
    expect(objAt(ant, F(10)).x).toBeCloseTo(objAt(ant, F(8.5)).x, 1);
    expect(objAt(ant, F(10)).x).toBeLessThan(55);
  });

  it("hooves close-up aims low", () => {
    const c = camAt(doc.camera.keys, F(8.5));
    const a = objAt(obj(doc, "ant"), F(8.5));
    expect(c.target[1] - a.y).toBeLessThan(0.4);
  });

  it("carry styles: bird low in his hand while riding, rifle on his back", () => {
    const boy = objAt(obj(doc, "boy"), F(10.5));
    const bird = objAt(obj(doc, "bird"), F(10.5));
    const rifle = objAt(obj(doc, "rifle"), F(10.5));
    expect(bird.y).toBeLessThan(boy.y);
    expect(rifle.y).toBeGreaterThan(boy.y + 1);
    expect(objAt(obj(doc, "bird"), F(5)).y).toBeLessThan(-20);
  });
});
