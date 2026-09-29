import { describe, expect, it } from "vitest";
import { parseScriptPromptText } from "../../prompt-templates/parse";
import type { BlockoutDocument } from "../types";
import { compileStagingPlan } from "./compile";
import { buildAuditRepairMessage, diffBlockoutEdits } from "./feedback";
import { KITCHEN_PLAN, KITCHEN_SCRIPT } from "./fixtures/kitchen";
import { parseStagingPlan } from "./schema";

const parsed = parseStagingPlan(KITCHEN_PLAN);
if (!parsed.ok) throw new Error(parsed.error);
const plan = parsed.plan;
const compiled = compileStagingPlan(
  plan,
  parseScriptPromptText(KITCHEN_SCRIPT),
  {
    id: "p",
    title: "T",
    aspectRatio: "16:9",
    fps: 24,
  },
);
const clone = (d: BlockoutDocument): BlockoutDocument =>
  JSON.parse(JSON.stringify(d));

describe("diffBlockoutEdits", () => {
  it("reports nothing for an untouched blockout", () => {
    expect(diffBlockoutEdits(compiled, clone(compiled))).toEqual([]);
  });

  it("reports camera, lens, set and timing corrections by shot", () => {
    const edited = clone(compiled);
    const shot3 = edited.shots.find((s) => s.n === 3)!;
    for (const k of edited.camera.keys) {
      if (k.f >= shot3.start && k.f < shot3.end) {
        k.focal += 20;
        k.target = [k.target[0], k.target[1], k.target[2] + 3];
      }
    }
    const counter = edited.objects.find((o) => o.name === "counter")!;
    counter.pos = [counter.pos[0], counter.pos[1] + 1];
    edited.objects = edited.objects.filter((o) => o.name !== "table");
    edited.objects.push({
      id: "user-plant",
      type: "column",
      name: "Plant",
      color: "#4a7",
      size: [0.4, 1, 0.4],
      pos: [2, 2],
      rot: 0,
      keys: [],
    });
    edited.shots.find((s) => s.n === 6)!.end -= 12;

    const got = diffBlockoutEdits(compiled, edited);
    const has = (shot: number | null, kind: string, target?: string) =>
      got.some(
        (c) =>
          c.shot === shot &&
          c.kind === kind &&
          (target === undefined || c.target === target),
      );
    expect(has(3, "lens_changed")).toBe(true);
    expect(has(3, "camera_reaimed")).toBe(true);
    expect(has(1, "lens_changed")).toBe(false);
    expect(has(null, "set_moved", "counter")).toBe(true);
    expect(has(null, "set_removed", "table")).toBe(true);
    expect(has(null, "set_added", "Plant")).toBe(true);
    expect(got.find((c) => c.kind === "shot_timing")).toMatchObject({
      shot: 6,
      amount: -12,
    });
  });
});

describe("buildAuditRepairMessage", () => {
  it("lists each faulty shot once with a hint and its current camera", () => {
    const msg = buildAuditRepairMessage(
      [
        { shot: 4, frame: 241, problem: "Maya out of frame" },
        { shot: 4, frame: 280, problem: "Maya out of frame" },
        { shot: 5, frame: 300, problem: "camera inside counter" },
      ],
      plan,
    );
    expect(msg.content.match(/Shot 4:/g)).toHaveLength(1);
    expect(msg.content).toMatch(
      /Shot 4: Maya out of frame \(the camera does not see them/,
    );
    expect(msg.content).toMatch(
      /Shot 5: camera inside counter \(the camera is inside a set piece/,
    );
    expect(msg.content).toContain('"subject":"maya"');
    expect(msg.content).toMatch(/Return the corrected full JSON object only/);
  });
});
