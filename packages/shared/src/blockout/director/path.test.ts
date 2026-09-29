import { describe, expect, it } from "vitest";
import { buildTravelPath, detectChaseBeats } from "./path";
import type { ScriptShot } from "../../prompt-templates/schemas";

function shot(
  n: number,
  startSec: number,
  endSec: number,
  action: string,
  shotType = "Wide",
): ScriptShot {
  return { n, startSec, endSec, action, shotType };
}

describe("director path integration", () => {
  it("integrates speed so X grows through the chase window", () => {
    const shots = [
      shot(1, 0, 1.5, "Campfire sparks"),
      shot(4, 4, 5.5, "She mounts and rides away into the trees"),
      shot(10, 11, 12, "Hare explodes into a full sprint"),
      shot(22, 24, 26, "Wide side: the leap across the chasm"),
      shot(23, 26, 27, "Low on the far side: the hare lands"),
      shot(25, 28.5, 30, "She rides off. Cut to black"),
    ];
    const beats = detectChaseBeats(shots, 30, "night forest and chasm");
    expect(beats.wantsCliff).toBe(true);
    const path = buildTravelPath(beats);
    expect(path.X(6)).toBeGreaterThan(path.X(4));
    expect(path.X(14)).toBeGreaterThan(path.X(12));
    expect(path.edge).toBeGreaterThan(50);
    expect(path.gap).toBe(15);
  });

  it("still builds a path for non-chase scripts without cliff", () => {
    const shots = [
      shot(1, 0, 3, "Wide: a quiet room", "Wide"),
      shot(2, 3, 6, "Close-up: she sits at the table", "Close-up"),
    ];
    const beats = detectChaseBeats(shots, 6, "interior studio");
    expect(beats.wantsCliff).toBe(false);
    const path = buildTravelPath(beats);
    expect(path.X(6)).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(path.pz(10))).toBe(true);
  });
});
