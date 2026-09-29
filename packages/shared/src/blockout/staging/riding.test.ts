import { describe, expect, it } from "vitest";
import { parseScriptPromptText } from "../../prompt-templates/parse";
import { objAt } from "../engine";
import { auditStagedDocument } from "./audit";
import { compileStagingPlanWithInfo } from "./compile";
import { HUNT_PLAN, HUNT_SCRIPT } from "./fixtures/hunt";
import { parseStagingPlan } from "./schema";

const PROJECT = { id: "p", title: "T", aspectRatio: "16:9", fps: 24 };

function compile(scriptText: string, planJson: unknown) {
  const parsed = parseStagingPlan(JSON.parse(JSON.stringify(planJson)));
  if (!parsed.ok) throw new Error(parsed.error);
  const info = compileStagingPlanWithInfo(
    parsed.plan,
    parseScriptPromptText(scriptText),
    PROJECT,
  );
  return { ...info, plan: parsed.plan };
}
const on = (
  doc: ReturnType<typeof compile>["document"],
  rider: string,
  mount: string,
  t: number,
) => {
  const a = objAt(
    doc.objects.find((o) => o.id === `cast-${rider}`)!,
    t * 24,
  );
  const b = objAt(
    doc.objects.find((o) => o.id === `cast-${mount}`)!,
    t * 24,
  );
  return Math.hypot(a.x - b.x, a.z - b.z) < 0.3 && a.y > b.y + 0.8;
};

const GIRL_SCRIPT = `REFERENCES
@image_1 = the girl. Use it for her face.
@image_2 = the giant riding hare. Use it for the mount.
@image_3 = the forest. Use it for the trees.
ART STYLE — LOCKED TO THE REFERENCE IMAGES:
Painted.
IMAGE QUALITY — ALWAYS SHARP AND CLEAN:
Sharp.
THE GIRL — @image_1, identical in every shot:
A young rider.
THE HARE — @image_2: a giant riding hare with a saddle and reins that she rides.
LOCATION — @image_3: a night forest with a campfire.
SHOTS (10 seconds total, multi-shot, 16:9):
Shot 1 (0.0s–4.0s) — Wide: the girl stands by the campfire beside the hare.
Shot 2 (4.0s–6.0s) — Medium: she leaps into the saddle and the hare bounds away into the trees.
Shot 3 (6.0s–10.0s) — Low tracking shot alongside: the hare races through the forest, the girl crouched low.
CONSISTENCY:
Same.
MOTION AND PHYSICS:
Real.
LIGHTING:
Firelight.
TECHNICAL:
16:9, 24fps.
MUSIC:
None.
AUDIO (native sound, synced to picture):
0.0s fire.
`;

/** What the model produced in the attached girl blockout: an in-place hop, no rides link. */
const GIRL_PLAN = {
  schema: "cinakey.staging/1.0",
  set: {
    terrain: "forest",
    timeOfDay: "night",
    features: [{ kind: "fire", at: [0, 1] }],
  },
  cast: [
    {
      id: "girl",
      name: "the girl",
      kind: "person",
      imageN: 1,
      at: [2, 0],
      facing: 90,
    },
    {
      id: "hare",
      name: "the giant riding hare",
      kind: "quadruped",
      imageN: 2,
      size: [1.4, 2.5, 3],
      at: [3, 0],
      facing: 90,
    },
  ],
  shots: [
    {
      n: 1,
      moves: [],
      camera: {
        size: "wide",
        angle: "eye",
        side: "front_left",
        move: "static",
        subject: "girl",
      },
    },
    {
      n: 2,
      moves: [
        { who: "girl", action: "jump", from: 0.1, to: 0.3, height: 0.9 },
        { who: "hare", action: "run", from: 0.3, path: [[12, 2]] },
      ],
      camera: {
        size: "medium",
        angle: "eye",
        side: "left",
        move: "static",
        subject: "hare",
      },
    },
    {
      n: 3,
      moves: [
        { who: "girl", action: "crouch" },
        { who: "hare", action: "sprint", path: [[40, 3]] },
      ],
      camera: {
        size: "full",
        angle: "low",
        side: "left",
        move: "track",
        subject: "hare",
      },
    },
  ],
};

describe("riders stay on their mounts", () => {
  it("girl: in-place hop beside the hare, no rides link → she rides from the hop", () => {
    const { document, riding, plan } = compile(GIRL_SCRIPT, GIRL_PLAN);
    expect(riding.get("girl")?.[0]?.mount).toBe("hare");
    expect(on(document, "girl", "hare", 2)).toBe(false);
    for (const t of [5.5, 7, 9.5])
      expect(on(document, "girl", "hare", t)).toBe(true);
    expect(auditStagedDocument(plan, document, riding)).toEqual([]);
  });

  it("boy: leaps into the saddle with no rides link (attached boy blockout)", () => {
    const plan = JSON.parse(JSON.stringify(HUNT_PLAN));
    const boy = plan.cast.find((c: { id: string }) => c.id === "boy");
    delete boy.rides;
    delete boy.ridesFrom;
    plan.shots
      .find((s: { n: number }) => s.n === 11)
      .moves.unshift({
        who: "boy",
        action: "leap",
        from: 0.1,
        to: 0.35,
        height: 1.6,
      });
    const { document, riding } = compile(HUNT_SCRIPT, plan);
    expect(riding.get("boy")?.[0]).toMatchObject({ mount: "cheetah" });
    expect(riding.get("boy")![0]!.from).toBeCloseTo(11.85, 1);
    expect(on(document, "boy", "cheetah", 6)).toBe(false);
    for (const t of [13, 18, 25, 29])
      expect(on(document, "boy", "cheetah", t)).toBe(true);
  });

  it("no mount-up signal at all: the script's rider boards when the mount sets off", () => {
    const plan = JSON.parse(JSON.stringify(HUNT_PLAN));
    const boy = plan.cast.find((c: { id: string }) => c.id === "boy");
    delete boy.rides;
    delete boy.ridesFrom;
    const { document } = compile(HUNT_SCRIPT, plan);
    for (const t of [13, 25])
      expect(on(document, "boy", "cheetah", t)).toBe(true);
  });

  it("explicit mount / dismount moves, and alias spellings", () => {
    const plan = JSON.parse(JSON.stringify(GIRL_PLAN));
    plan.shots[1].moves[0] = {
      who: "girl",
      action: "mount",
      target: "hare",
      from: 0.1,
      to: 0.3,
    };
    plan.shots[2].moves.push({
      who: "girl",
      action: "dismount",
      from: 0.9,
      to: 1,
    });
    const { document } = compile(GIRL_SCRIPT, plan);
    expect(on(document, "girl", "hare", 7)).toBe(true);
    const g = objAt(
      document.objects.find((o) => o.id === "cast-girl")!,
      9.95 * 24,
    );
    const h = objAt(
      document.objects.find((o) => o.id === "cast-hare")!,
      9.6 * 24,
    );
    // Off the mount, beside where it was when she got down — not back at her start spot
    expect(g.y).toBeLessThan(0.3);
    expect(Math.hypot(g.x - h.x, g.z - h.z)).toBeLessThan(1.6);

    const alias = JSON.parse(JSON.stringify(GIRL_PLAN));
    alias.shots[1].moves.shift();
    alias.cast[0].mount = "hare";
    alias.cast[0].mountedFrom = 4.5;
    const parsed = parseStagingPlan(alias);
    expect(parsed.ok && parsed.plan.cast[0]!.rides).toBe("hare");
  });

  it("does not invent riders when nobody rides (kitchen-style scenes)", () => {
    const plan = JSON.parse(JSON.stringify(GIRL_PLAN));
    plan.cast[1] = {
      id: "dog",
      name: "dog",
      kind: "quadruped",
      at: [3, 0],
      facing: 90,
    };
    plan.shots[1].moves = [
      { who: "dog", action: "run", from: 0.3, path: [[12, 2]] },
    ];
    plan.shots[2].moves = [{ who: "dog", action: "run", path: [[40, 3]] }];
    const script = GIRL_SCRIPT.replace(/THE HARE[^\n]*\n/, "").replace(
      /she leaps into the saddle and the hare/g,
      "the dog",
    );
    const { riding } = compile(script, plan);
    expect(riding.size).toBe(0);
  });
});
