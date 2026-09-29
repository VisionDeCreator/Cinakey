import { describe, expect, it } from "vitest";
import { parseScriptPromptText } from "../../prompt-templates/parse";
import { camAt, objAt } from "../engine";
import { validateBlockoutDocument } from "../validate";
import { auditStagedDocument } from "./audit";
import { compileStagingPlan } from "./compile";
import { CAR_CHASE_PLAN, CAR_CHASE_SCRIPT } from "./fixtures/carChase";
import { HUNT_PLAN, HUNT_SCRIPT } from "./fixtures/hunt";
import { KITCHEN_PLAN, KITCHEN_SCRIPT } from "./fixtures/kitchen";
import { buildStagingMessages, estimateStagingTokens } from "./prompt";
import { parseStagingPlan } from "./schema";

const PROJECT = { id: "p", title: "T", aspectRatio: "16:9", fps: 24 };

function stage(scriptText: string, planJson: unknown) {
  const script = parseScriptPromptText(scriptText);
  const parsed = parseStagingPlan(JSON.stringify(planJson));
  if (!parsed.ok) throw new Error(parsed.error);
  const doc = compileStagingPlan(parsed.plan, script, PROJECT);
  return { script, plan: parsed.plan, doc };
}

const CASES = [
  ["savanna hunt", HUNT_SCRIPT, HUNT_PLAN],
  ["kitchen dialogue", KITCHEN_SCRIPT, KITCHEN_PLAN],
  ["night car chase", CAR_CHASE_SCRIPT, CAR_CHASE_PLAN],
] as const;

describe("staging plan → blockout", () => {
  for (const [label, text, planJson] of CASES) {
    it(`${label}: compiles a valid document with every subject in frame`, () => {
      const { script, plan, doc } = stage(text, planJson);
      expect(validateBlockoutDocument(doc)).toBeNull();
      expect(doc.shots).toHaveLength(script.shots.length);
      for (const k of doc.camera.keys) {
        expect([...k.pos, ...k.target].every(Number.isFinite)).toBe(true);
      }
      expect(auditStagedDocument(plan, doc)).toEqual([]);
    });
  }

  it("kitchen: dialogue staging — sits, turns, walks out; two-shot and OTS hold the line", () => {
    const { doc } = stage(KITCHEN_SCRIPT, KITCHEN_PLAN);
    const maya = doc.objects.find((o) => o.id === "cast-maya")!;
    const leo = doc.objects.find((o) => o.id === "cast-leo")!;
    expect(objAt(maya, 48).y).toBeLessThan(-0.3); // seated
    expect(objAt(leo, 13 * 24).x).toBeLessThan(0);
    expect(objAt(leo, 17 * 24).x).toBeGreaterThan(3); // at the door
    expect(objAt(leo, 19.5 * 24).x).toBeGreaterThan(4.5); // gone
    // OTS: camera sits near Leo, looking at Maya
    const ots = camAt(doc.camera.keys, 5 * 24);
    const lp = objAt(leo, 5 * 24);
    expect(Math.hypot(ots.pos[0] - lp.x, ots.pos[2] - lp.z)).toBeLessThan(1.5);
    expect(doc.env?.sky).toBe("#2a2d33");
  });

  it("car chase: vehicles drive the route, driver rides, cruiser crashes into the truck", () => {
    const { doc } = stage(CAR_CHASE_SCRIPT, CAR_CHASE_PLAN);
    const coupe = doc.objects.find((o) => o.id === "cast-coupe")!;
    const driver = doc.objects.find((o) => o.id === "cast-driver")!;
    const cruiser = doc.objects.find((o) => o.id === "cast-cruiser")!;
    expect(coupe.type).toBe("car");
    for (const t of [1, 6, 9]) {
      const c = objAt(coupe, t * 24);
      const d = objAt(driver, t * 24);
      expect(Math.hypot(c.x - d.x, c.z - d.z)).toBeLessThan(0.1);
    }
    // Turned right at the intersection (+z), cruiser behind the coupe throughout
    expect(objAt(coupe, 11 * 24).z).toBeGreaterThan(40);
    for (const t of [2, 8, 11]) {
      expect(objAt(cruiser, t * 24).x + objAt(cruiser, t * 24).z).toBeLessThan(
        objAt(coupe, t * 24).x + objAt(coupe, t * 24).z,
      );
    }
    expect(
      doc.objects.filter((o) => o.type === "strip").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("hunt: herd bolts ahead, antelope leaps the river before the cheetah, bird only at the end", () => {
    const { doc } = stage(HUNT_SCRIPT, HUNT_PLAN);
    const get = (id: string) => doc.objects.find((o) => o.id === `cast-${id}`)!;
    expect(objAt(get("cheetah"), 11 * 24).x).toBeCloseTo(0, 1);
    expect(objAt(get("a1"), 18 * 24).y).toBeGreaterThan(1);
    expect(objAt(get("cheetah"), 18 * 24).x).toBeLessThan(90);
    expect(objAt(get("cheetah"), 19.2 * 24).y).toBeGreaterThan(1);
    expect(objAt(get("bird"), 20 * 24).y).toBeLessThan(-20);
    expect(objAt(get("bird"), 29 * 24).y).toBeGreaterThan(0);
    expect(doc.objects.some((o) => o.name === "River")).toBe(true);
  });

  it("parses forgiving model output: fences, bad enums, unknown ids", () => {
    const messy = JSON.parse(JSON.stringify(KITCHEN_PLAN));
    messy.shots[0].camera.size = "super-wide";
    messy.shots[1].camera.subject = "nobody";
    messy.shots[2].moves.push({ who: "ghost", action: "walk" });
    const parsed = parseStagingPlan(
      "```json\n" + JSON.stringify(messy) + "\n```",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.plan.shots[0]!.camera.size).toBe("medium");
    expect(parsed.plan.shots[1]!.camera.subject).toBeUndefined();
    expect(parsed.plan.shots[2]!.moves.every((m) => m.who !== "ghost")).toBe(
      true,
    );
    expect(parseStagingPlan("not json").ok).toBe(false);
  });

  it("builds a prompt and a token estimate", () => {
    const msgs = buildStagingMessages({
      scriptText: KITCHEN_SCRIPT,
      aspectRatio: "16:9",
      durationSec: 20,
      shotCount: 6,
    });
    expect(msgs[0]!.content).toContain("cinakey.staging/1.0");
    expect(msgs[1]!.content).toContain("Shot 5");
    expect(estimateStagingTokens(HUNT_SCRIPT, 23)).toBeGreaterThan(4000);
  });
});
