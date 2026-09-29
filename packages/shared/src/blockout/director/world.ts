/**
 * Set dressing: campfire, path strips, trees, ground platforms, river,
 * moon / sun, lights. Forest + chasm dressing is ported from gen_chase.py;
 * open terrain (savanna, plains, desert …) gets sparse trees and rocks.
 */

import type { ScriptPromptData } from "../../prompt-templates/schemas";
import type { BlockoutObject, Vec2 } from "../types";
import { hitTreeXZ, type MotionContext } from "./castMotion";
import type { TravelPath } from "./path";
import { r3 } from "./util";

export function buildWorldObjects(
  script: ScriptPromptData,
  path: TravelPath,
  ctx: MotionContext,
  runPts: Array<[number, number]>,
  rng: () => number,
): BlockoutObject[] {
  const objects: BlockoutObject[] = [];
  const { edge, far, farY, gc, pz, beats } = path;
  const [fx, fz] = ctx.fire;
  const loc =
    `${script.location.description} ${script.shots.map((s) => s.action).join(" ")}`.toLowerCase();
  const place = script.location.description.toLowerCase();
  const wantsFire = ctx.campfire;
  const open =
    /\bsavanna|\bplains?\b|\bdesert|\bgrassland|\bmeadow|\bprairie|\bsteppe|\bfields?\b|\btundra|\bdunes?\b|\bbeach|\bveld/.test(
      place,
    );
  const wantsForest =
    /\bforest|\bwoods\b|\bwoodland|\bjungle|\bgrove|\bpines?\b/.test(place) ||
    (!open && beats.wantsCliff && beats.gapKind === "chasm");
  const wantsMoon = /\bmoon|\bnight\b|\bmidnight/.test(loc);
  const wantsSun =
    !wantsMoon &&
    /\bsun\b|\bsunset|\bsunrise|\bdusk|\bdawn|\bgolden\s+hour/.test(loc);
  const river = beats.wantsCliff && beats.gapKind === "river";
  const wantsPath = wantsForest || /\bpath\b|\btrail\b|\broad\b/.test(place);
  const groundColor = open ? "#5d5646" : "#34383f";

  let n = 0;
  const push = (
    o: Partial<BlockoutObject> &
      Pick<BlockoutObject, "id" | "type" | "name" | "color" | "size">,
  ) => {
    objects.push({
      keys: [],
      rot: 0,
      pos: [0, 0] as Vec2,
      y: 0,
      ...o,
    });
    n++;
  };

  if (wantsFire) {
    push({
      id: "fire",
      type: "fire",
      name: "CAMPFIRE",
      color: "#e8772e",
      size: [0.6, 0.7, 0.6],
      pos: [fx, fz],
      y: 0,
    });
  }

  if (beats.wantsCliff && wantsMoon) {
    push({
      id: "moon",
      type: "sphere",
      name: "MOON",
      color: "#f2f2ee",
      size: [12, 12, 12],
      pos: [r3(gc + 45), -50],
      y: 8,
      glow: true,
      label: false,
    });
  }
  if (wantsSun) {
    push({
      id: "sun",
      type: "sphere",
      name: "SUN",
      color: "#ffb46b",
      size: [18, 18, 18],
      pos: [r3(Math.max(edge, path.X(beats.duration)) + 160), r3(pz(0))],
      y: 4,
      glow: true,
      label: false,
    });
  }

  if (beats.wantsCliff) {
    push({
      id: "ground-near",
      type: "box",
      name: river ? "Ground (near bank)" : "Ground (near side)",
      color: groundColor,
      size: [r3(edge + 70), 40, 160],
      pos: [r3((edge - 70) / 2), 0],
      y: -40,
      label: false,
    });
    push({
      id: "ground-far",
      type: "box",
      name: river ? "Ground (far bank)" : "Far platform",
      color: groundColor,
      size: [110, 40, 160],
      pos: [r3(far + 55), 0],
      y: -40 + farY,
      label: false,
    });
    if (river) {
      push({
        id: "river",
        type: "box",
        name: "River",
        color: "#3f5f7a",
        size: [r3(path.gap), 0.3, 160],
        pos: [r3(gc), 0],
        y: -2.6,
        label: false,
      });
    }
  } else {
    push({
      id: "ground-near",
      type: "box",
      name: "Ground",
      color: groundColor,
      size: [r3(edge + 40), 40, 120],
      pos: [r3(edge / 2), 0],
      y: -40,
      label: false,
    });
  }

  // Winding path strips
  let x = -2.0;
  const pathEnd = !wantsPath
    ? x
    : beats.wantsCliff
      ? edge - 0.5
      : Math.min(edge - 0.5, path.X(beats.duration) + 5);
  while (x < pathEnd) {
    const x2 = Math.min(pathEnd + 0.4, x + 6.0);
    const z1 = pz(x);
    const z2 = pz(x2);
    const len = Math.hypot(x2 - x, z2 - z1) + 0.3;
    const rot = (Math.atan2(x2 - x, z2 - z1) * 180) / Math.PI;
    push({
      id: `path-${n}`,
      type: "strip",
      name: "Path",
      color: "#50545b",
      size: [2.6, 0.02, r3(len)],
      pos: [r3((x + x2) / 2), r3((z1 + z2) / 2)],
      rot: Math.round(rot * 10) / 10,
      label: false,
    });
    x = x2;
  }
  if (beats.wantsCliff && wantsPath) {
    x = far + 1;
    while (x < far + 60) {
      push({
        id: `path-${n}`,
        type: "strip",
        name: "Path",
        color: "#50545b",
        size: [2.6, 0.02, 6.3],
        pos: [r3(x + 3), 0],
        rot: 90,
        y: farY,
        label: false,
      });
      x += 6;
    }
  }

  if (wantsForest) {
    const txPair = path.X(beats.threadSec);
    const tzPair = pz(txPair) + 1.0;
    const hitTree = hitTreeXZ(ctx);
    const special: Array<[number, number]> = [
      [txPair, tzPair - 1.15],
      [txPair, tzPair + 1.15],
      hitTree,
    ];

    const tree = (tx: number, tz: number, y = 0, h?: number) => {
      const height = h ?? Math.round((8 + rng() * 3.5) * 10) / 10;
      push({
        id: `tree-${n}`,
        type: "tree",
        name: "Tree",
        color: "#4a4e55",
        size: [
          Math.round((0.5 + rng() * 0.3) * 100) / 100,
          height,
          Math.round((4 + rng() * 2.2) * 10) / 10,
        ],
        pos: [r3(tx), r3(tz)],
        y,
        label: false,
      });
    };

    for (const [sx, sz] of special) tree(sx, sz, 0, 10);

    const clear = (cx: number, cz: number) => {
      if (
        runPts.some(
          ([a, b]) =>
            Math.abs(cx - a) < 2.0 && Math.hypot(cx - a, cz - b) < 1.8,
        )
      ) {
        return false;
      }
      if (special.some(([a, b]) => Math.hypot(cx - a, cz - b) < 2.2))
        return false;
      if (Math.abs(cx - txPair) < 6 && Math.abs(cz - tzPair) < 7.5)
        return false;
      return true;
    };

    // Same density as gen_chase: two bands per side, ~4.7 m spacing, so side
    // and tracking cameras keep clear sightlines.
    x = 9.0;
    while (x < edge - 3) {
      for (const side of [-1, 1] as const) {
        for (const [lo, hi] of [
          [3.6, 9.5],
          [11, 19],
        ] as const) {
          const xx = x + (rng() - 0.5) * 3;
          const z = pz(xx) + side * (lo + rng() * (hi - lo));
          if (xx < edge - 2 && clear(xx, z)) tree(xx, z);
        }
      }
      x += 3.8 + rng() * 1.8;
    }

    // Behind the campfire
    for (let i = 0; i < 10; i++) {
      tree(-16 + rng() * 12, 5 + rng() * 11);
    }

    if (beats.wantsCliff) {
      x = far + 26;
      while (x < far + 72) {
        for (const side of [-1, 1] as const) {
          tree(x + (rng() - 0.5) * 3, side * (3.4 + rng() * 10.6), farY);
        }
        x += 4 + rng() * 2;
      }
    }
  }

  // Open terrain: sparse wide-canopy trees and rock outcrops, kept well off the run.
  if (open && !wantsForest) {
    const wantsTrees = /\btrees?\b|\bacacias?\b|\bbaobabs?\b|\bpalms?\b/.test(
      place,
    );
    const wantsRocks = /\brock|\boutcrop|\bboulder|\bstones?\b/.test(place);
    const end =
      Math.max(edge, path.X(beats.duration)) +
      (beats.wantsCliff ? path.gap + 60 : 30);
    const clearOfRun = (cx: number, cz: number) =>
      !runPts.some(
        ([a, b]) => Math.abs(cx - a) < 4 && Math.hypot(cx - a, cz - b) < 6,
      ) && !(beats.wantsCliff && cx > edge - 3 && cx < far + 3);
    if (wantsTrees) {
      x = -12;
      while (x < end) {
        const side = rng() < 0.5 ? -1 : 1;
        const tx = x + (rng() - 0.5) * 6;
        const tz = pz(tx) + side * (12 + rng() * 30);
        if (clearOfRun(tx, tz)) {
          push({
            id: `tree-${n}`,
            type: "tree",
            name: "Tree",
            color: "#4f4a3e",
            size: [
              Math.round((0.35 + rng() * 0.2) * 100) / 100,
              Math.round((4.5 + rng() * 2.5) * 10) / 10,
              Math.round((6 + rng() * 3) * 10) / 10,
            ],
            pos: [r3(tx), r3(tz)],
            y: beats.wantsCliff && tx >= far ? farY : 0,
            label: false,
          });
        }
        x += 12 + rng() * 14;
      }
    }
    if (wantsRocks) {
      const clusters = [Math.min(edge, path.X(beats.duration)) * 0.35, -6];
      clusters.forEach((cx, ci) => {
        const side = ci % 2 === 0 ? -1 : 1;
        const cz = pz(cx) + side * (14 + rng() * 6);
        for (let i = 0; i < 5; i++) {
          const s = 1 + rng() * 2.5;
          push({
            id: `rock-${n}`,
            type: "box",
            name: "Rock",
            color: "#6b6258",
            size: [r3(s * 1.3), r3(s), r3(s * 1.1)],
            pos: [r3(cx + (rng() - 0.5) * 7), r3(cz + (rng() - 0.5) * 5)],
            rot: Math.round(rng() * 90),
            label: false,
          });
        }
      });
    }
  }

  // Lights
  push({
    id: "light-key",
    type: "light",
    name: "Key",
    color: wantsFire ? "#ffb070" : "#fff4e0",
    size: [0.3, 0.3, 0.3],
    pos: wantsFire ? [fx + 1.5, fz + 1.2] : [4, 6],
    y: wantsFire ? 2.2 : 8,
    lightRole: "key",
    intensity: 1.1,
  });
  push({
    id: "light-fill",
    type: "light",
    name: "Fill",
    color: "#c8d8ff",
    size: [0.25, 0.25, 0.25],
    pos: [-4, 6],
    y: 4,
    lightRole: "fill",
    intensity: 0.45,
  });
  if (beats.wantsCliff && wantsMoon) {
    push({
      id: "light-moon",
      type: "light",
      name: "Moonlight",
      color: "#dce6ff",
      size: [0.4, 0.4, 0.4],
      pos: [r3(gc + 20), -30],
      y: 18,
      lightRole: "back",
      intensity: 0.7,
    });
  }

  return objects;
}
