/**
 * Whole-part watchability: patterns seen in real model plans (animals listed
 * as set boxes, a 28 m waterfall at a chasm edge, rocks on the path, rider
 * close-ups from the front, "from" the subject itself, herds re-placed shot
 * to shot, a mounting jump near the start). Every sampled frame of every
 * shot must be watchable — not just the individual fixes.
 */
import { describe, expect, it } from "vitest";
import { parseScriptPromptText } from "../../prompt-templates/parse";
import { camAt, objAt } from "../engine";
import type { BlockoutDocument } from "../types";
import { auditStagedDocument } from "./audit";
import { compileStagingPlanWithInfo } from "./compile";
import { CAR_CHASE_PLAN, CAR_CHASE_SCRIPT } from "./fixtures/carChase";
import { HUNT_PLAN, HUNT_SCRIPT } from "./fixtures/hunt";
import { KITCHEN_PLAN, KITCHEN_SCRIPT } from "./fixtures/kitchen";
import { parseStagingPlan, type StagingPlan } from "./schema";

const PROJECT = { id: "p", title: "T", aspectRatio: "16:9", fps: 24 };

function stage(text: string, planJson: unknown) {
  const parsed = parseStagingPlan(JSON.parse(JSON.stringify(planJson)));
  if (!parsed.ok) throw new Error(parsed.error);
  const info = compileStagingPlanWithInfo(
    parsed.plan,
    parseScriptPromptText(text),
    PROJECT,
  );
  return { ...info, plan: parsed.plan };
}

/** Everything that makes a pre-viz unwatchable, as readable strings. */
function unwatchable(
  doc: BlockoutDocument,
  plan: StagingPlan,
  riding: Map<string, unknown>,
): string[] {
  const out = auditStagedDocument(plan, doc, riding as never)
    .filter((i) =>
      /camera inside|view blocked|m tall|below ground/.test(i.problem),
    )
    .map((i) => `shot ${i.shot}: ${i.problem}`);
  // A sane world: nothing runs off hundreds of metres, ground isn't kilometres long.
  const grounds = doc.objects.filter((o) => o.name === "Ground");
  const span =
    Math.max(...grounds.map((g) => g.pos[0] + g.size[0] / 2)) -
    Math.min(...grounds.map((g) => g.pos[0] - g.size[0] / 2));
  if (span > 1200) out.push(`ground spans ${Math.round(span)} m`);
  for (const o of doc.objects.filter((x) => x.id.startsWith("cast-"))) {
    let prev = objAt(o, 0);
    for (let f = 1; f <= doc.frames; f++) {
      const p = objAt(o, f);
      if (
        p.y > -20 &&
        prev.y > -20 &&
        Math.hypot(p.x - prev.x, p.z - prev.z) > 2.5
      ) {
        const cut = doc.shots.some((c) => c.start === f);
        if (!cut)
          out.push(
            `${o.name} snaps ${Math.round(Math.hypot(p.x - prev.x, p.z - prev.z))} m at frame ${f}`,
          );
      }
      if (Math.abs(p.x) > 500 || Math.abs(p.z) > 500) {
        out.push(
          `${o.name} runs off to ${Math.round(p.x)}, ${Math.round(p.z)}`,
        );
        break;
      }
      prev = p;
    }
  }
  return [...new Set(out)];
}

const shotsText = (lines: string[], total: number) => `REFERENCES
@image_1 = the girl. Use it for her face.
@image_2 = the giant riding hare. Use it for the mount.
@image_3 = the antelope. Use it for the herd.
ART STYLE — LOCKED TO THE REFERENCE IMAGES:
Painted.
IMAGE QUALITY — ALWAYS SHARP AND CLEAN:
Sharp.
THE GIRL — @image_1, identical in every shot:
A young rider.
THE HARE — @image_2: a giant riding hare with a saddle she rides.
THE ANTELOPE — @image_3: slender antelope in a herd.
LOCATION — @image_2: a night forest with a campfire, ending at a misty chasm with a waterfall.
SHOTS (${total} seconds total, multi-shot, 16:9):
${lines.join("\n")}
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

const MESSY_SCRIPT = shotsText(
  [
    "Shot 1 (0.0s–2.0s) — Close-up on an antelope grazing near the camp.",
    "Shot 2 (2.0s–4.0s) — Medium: she leaps into the saddle of the hare.",
    "Shot 3 (4.0s–7.0s) — Low tracking shot alongside: the hare races after the fleeing herd.",
    "Shot 4 (7.0s–8.0s) — Close-up on her face from the front as she rides.",
    "Shot 5 (8.0s–10.0s) — Front shot on her as the hare sprints on.",
    "Shot 6 (10.0s–13.0s) — Wide side shot: the hare leaps across the chasm, the waterfall far below.",
    "Shot 7 (13.0s–15.0s) — Wide shot from her side: she looks back across the gap.",
    "Shot 8 (15.0s–16.0s) — Her point of view back across the chasm.",
  ],
  16,
);

const MESSY_PLAN = {
  schema: "cinakey.staging/1.0",
  set: {
    terrain: "forest",
    timeOfDay: "night",
    features: [
      { kind: "chasm", id: "chasm", at: [60, 0], size: [18, 30, 200] },
      { kind: "water", name: "waterfall", at: [60, 0], size: [2, 28, 2] },
      {
        kind: "box",
        name: "hunted antelope",
        at: [28, 0],
        size: [1.2, 1, 1.2],
      },
      { kind: "box", name: "herd antelope", at: [34, 6] },
      { kind: "rocks", at: [5, 0.8], count: 8, spread: 4 },
      { kind: "rock", name: "Rock", at: [45, 0], size: [2.6, 2, 2.2] },
      { kind: "wall", name: "tent", at: [-3, -2], size: [2.5, 2, 2], rot: 30 },
      { kind: "trees", at: [30, 10], count: 12, spread: 15 },
      { kind: "moon", at: [35, -40] },
    ],
  },
  cast: [
    {
      id: "girl",
      name: "the girl",
      kind: "person",
      imageN: 1,
      at: [1.5, -1],
      facing: 90,
    },
    {
      id: "hare",
      name: "the giant riding hare",
      kind: "quadruped",
      imageN: 2,
      size: [1.2, 2.5, 3],
      at: [2, -1],
      facing: 90,
    },
    {
      id: "herd1",
      name: "antelope",
      kind: "quadruped",
      imageN: 3,
      size: [0.8, 2.2, 2.4],
      at: [28, 0],
      facing: 90,
    },
    {
      id: "herd2",
      name: "antelope 2",
      kind: "quadruped",
      size: [0.8, 2.2, 2.4],
      at: [34, 6],
      facing: 90,
    },
  ],
  shots: [
    {
      n: 1,
      moves: [{ who: "herd1", action: "idle" }],
      camera: {
        size: "cu",
        angle: "eye",
        side: "front",
        move: "static",
        subject: "herd1",
      },
    },
    {
      n: 2,
      moves: [
        {
          who: "girl",
          action: "jump",
          path: [[2.4, -1]],
          height: 1,
          from: 0.2,
          to: 0.5,
        },
      ],
      camera: {
        size: "medium",
        angle: "eye",
        side: "left",
        move: "static",
        subject: "girl",
      },
    },
    {
      n: 3,
      moves: [
        { who: "hare", action: "run", path: [[35, -1]] },
        { who: "herd1", action: "run", path: [[60, 0]] },
        { who: "herd2", action: "run", path: [[-10, 8]] },
      ],
      camera: {
        size: "medium",
        angle: "low",
        side: "left",
        move: "track",
        subject: "hare",
      },
    },
    {
      n: 4,
      moves: [{ who: "hare", action: "sprint", path: [[45, 0]] }],
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
        { who: "hare", action: "sprint", path: [[55, 0]] },
        { who: "herd1", action: "run", start: [50, 3], path: [[58, 3]] },
      ],
      camera: {
        size: "mcu",
        angle: "eye",
        side: "front",
        move: "follow",
        subject: "girl",
      },
    },
    {
      n: 6,
      moves: [{ who: "hare", action: "leap", path: [[82, 0]], height: 4 }],
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
      moves: [{ who: "hare", action: "walk", path: [[86, 0]] }],
      camera: {
        size: "wide",
        angle: "eye",
        side: "back",
        move: "static",
        subject: "girl",
        from: "girl",
      },
    },
    {
      n: 8,
      moves: [],
      camera: {
        size: "medium",
        angle: "eye",
        side: "front",
        move: "static",
        pov: "girl",
        subject: "herd1",
      },
    },
  ],
};

describe("whole-part watchability", () => {
  it("a messy real-world-style plan comes out watchable", () => {
    const { document, riding, plan } = stage(MESSY_SCRIPT, MESSY_PLAN);
    expect(unwatchable(document, plan, riding)).toEqual([]);

    // Animals listed as set pieces are dropped (the cast is already staged)
    expect(
      document.objects.some(
        (o) => /antelope/.test(o.name) && !o.id.startsWith("cast-"),
      ),
    ).toBe(false);
    // The waterfall is flat water sunk into the chasm, not a 28 m pillar
    const falls = document.objects.find((o) => o.name === "waterfall")!;
    expect(falls.size[1]).toBeLessThanOrEqual(0.3);
    expect(falls.y! + falls.size[1]).toBeLessThan(0);
    // The small mounting jump near the start does not drag the chasm there
    const grounds = document.objects.filter((o) => o.name === "Ground");
    const gapStart = Math.min(...grounds.map((g) => g.pos[0] + g.size[0] / 2));
    expect(gapStart).toBeGreaterThan(50);
    // No rock sits on the hare's path
    const hare = document.objects.find((o) => o.id === "cast-hare")!;
    for (const rock of document.objects.filter((o) => o.name === "Rock")) {
      for (let f = 0; f <= document.frames; f += 6) {
        const h = objAt(hare, f);
        const clearance =
          Math.hypot(h.x - rock.pos[0], h.z - rock.pos[1]) -
          Math.max(rock.size[0], rock.size[2]) / 2;
        expect(clearance).toBeGreaterThan(0.3);
      }
    }
    // The girl's front close-up sees her, from outside the hare
    const c = camAt(document.camera.keys, 7.5 * 24);
    expect(c.pos[1]).toBeGreaterThan(0.15);
  });

  it.each([
    ["savanna hunt", HUNT_SCRIPT, HUNT_PLAN],
    ["kitchen dialogue", KITCHEN_SCRIPT, KITCHEN_PLAN],
    ["night car chase", CAR_CHASE_SCRIPT, CAR_CHASE_PLAN],
  ] as const)("%s stays watchable", (_label, text, planJson) => {
    const { document, riding, plan } = stage(text, planJson);
    expect(unwatchable(document, plan, riding)).toEqual([]);
  });
});

describe("camera never inside anything (randomized plans)", () => {
  // Deterministic pseudo-random plans: varied cast, riding, paths and cameras.
  let seed = 12345;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const SIZES = [
    "ecu",
    "cu",
    "mcu",
    "medium",
    "cowboy",
    "full",
    "wide",
    "insert",
  ] as const;
  const SIDES = [
    "front",
    "front_left",
    "left",
    "back_left",
    "back",
    "back_right",
    "right",
    "front_right",
  ] as const;
  const MOVES = [
    "static",
    "pan",
    "follow",
    "track",
    "push_in",
    "pull_out",
    "orbit",
  ] as const;
  const ANGLES = ["eye", "low", "high", "ground"] as const;

  function randomPlan(nShots: number) {
    const cast = [
      { id: "a", name: "rider", kind: "person", at: [0, 0], facing: 90 },
      {
        id: "m",
        name: "mount",
        kind: "quadruped",
        size: [1.1, 2.5, 3],
        at: [1, 0],
        facing: 90,
      },
      { id: "b", name: "other", kind: "person", at: [4, 2], facing: 180 },
      { id: "v", name: "truck", kind: "vehicle", at: [10, -4], facing: 90 },
      { id: "c", name: "beast", kind: "creature", at: [-6, 3], facing: 90 },
    ];
    let mx = 1;
    const shots = Array.from({ length: nShots }, (_, i) => {
      mx += rnd() * 12;
      const moves: unknown[] = [
        {
          who: "m",
          action: pick(["walk", "run", "sprint"] as const),
          path: [[mx, (rnd() - 0.5) * 6]],
        },
      ];
      if (i === 1) moves.push({ who: "a", action: "mount", target: "m" });
      if (rnd() < 0.5)
        moves.push({
          who: "b",
          action: "walk",
          path: [[mx + (rnd() - 0.5) * 8, (rnd() - 0.5) * 8]],
        });
      if (rnd() < 0.4)
        moves.push({
          who: "c",
          action: "run",
          follow: "m",
          offset: [-3, pick([2, -2, 0])],
        });
      return {
        n: i + 1,
        moves,
        camera: {
          size: pick(SIZES),
          angle: pick(ANGLES),
          side: pick(SIDES),
          move: pick(MOVES),
          subject: pick(["a", "m", "b", "v", "c"] as const),
          ...(rnd() < 0.15 ? { from: pick(["a", "b", "m"] as const) } : {}),
        },
      };
    });
    return {
      schema: "cinakey.staging/1.0",
      set: {
        terrain: "open",
        timeOfDay: "day",
        features: [
          { kind: "rocks", at: [15, 0], count: 6, spread: 8 },
          { kind: "rock", at: [20, 0], size: [2.5, 2, 2.2] },
          { kind: "building", at: [30, 12], size: [10, 8, 10] },
          { kind: "trees", at: [25, -12], count: 10, spread: 12 },
        ],
      },
      cast,
      shots,
    };
  }

  it("40 random plans: no camera inside a body or solid, world bounded", () => {
    const lines = Array.from(
      { length: 8 },
      (_, i) =>
        `Shot ${i + 1} (${i * 2}.0s–${i * 2 + 2}.0s) — Shot: the rider and the mount.`,
    );
    const text = shotsText(lines, 16);
    const failures: string[] = [];
    for (let k = 0; k < 40; k++) {
      const { document, riding, plan } = stage(text, randomPlan(8));
      const bad = unwatchable(document, plan, riding).filter((p) =>
        /camera inside|runs off|spans|snaps/.test(p),
      );
      if (bad.length) failures.push(`plan ${k}: ${bad.slice(0, 3).join("; ")}`);
      if (bad.length && process.env.DBG_WATCH) {
        for (const b of bad) {
          const n = Number(/shot (\d+)/.exec(b)?.[1]);
          const cut = document.shots.find((c) => c.n === n);
          const sh = plan.shots.find((x) => x.n === n);
          const issue = auditStagedDocument(plan, document, riding).find(
            (i) => i.shot === n && /inside/.test(i.problem),
          );
          const cam = issue ? camAt(document.camera.keys, issue.frame) : null;
          const keysIn = cut
            ? document.camera.keys
                .filter((kk) => kk.f >= cut.start && kk.f < cut.end)
                .map((kk) => kk.f)
            : [];
          console.log(
            "DBG",
            k,
            b,
            JSON.stringify(sh?.camera),
            "frame",
            issue?.frame,
            "cam",
            cam?.pos.map((v) => +v.toFixed(2)),
            "keys",
            keysIn.join(","),
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
