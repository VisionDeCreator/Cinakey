/**
 * Cast / pursuer / FX motion — ported from gen_chase.py sample() + schedules.
 */

import type { ScriptShot } from "../../prompt-templates/schemas";
import type { BlockoutObject, BlockoutObjectKey, Vec2 } from "../types";
import type { CastRole } from "./cast";
import { primaryMount, primaryRider } from "./cast";
import type { TravelPath } from "./path";
import { clamp, fwd, headingOf, lerp, r3, smoothstep } from "./util";

const HIDE = -30;
const SEAT = 1.0;
const RIDE = 1.3;

export type Pose = { x: number; y: number; z: number; rot: number };

type SchedPt = [t: number, gap: number, zo: number];

/** Default pursuer schedules (gap behind mount along x, lateral offset) — gen_chase R1–R4. */
const DEFAULT_SCHED: SchedPt[][] = [
  [
    [10, 20, -9],
    [10.8, 16, -1.2],
    [12, 12, 0],
    [14.5, 6, 0],
    [15.5, 3, -2.7],
    [16.2, 0.3, -2.5],
    [17.5, 0.2, -2.4],
    [18.2, 3.5, -5.5],
    [18.8, 6, -2],
    [19.5, 7, 0],
    [20.55, 7.5, 0],
    [20.9, 10, 0.4],
    [21.5, 11, 0],
    [24.0, 12, 0],
  ],
  [
    [10, 22, 8.5],
    [10.8, 18, 1.2],
    [12, 14, 0.8],
    [14.5, 8, 1],
    [16.0, 4, 1.8],
    [16.8, 0.2, 2.4],
    [17.5, 0.2, 2.4],
    [18.2, 4.0, 5.5],
    [18.8, 7.5, 2],
    [19.5, 9, 0.8],
    [24.0, 13, 0.8],
  ],
  [
    [10, 24, -10],
    [10.8, 20, -1.5],
    [12, 16, -0.8],
    [14.5, 10, 0.2],
    [17.5, 7, 0.2],
    [18.5, 9, -1],
    [21.5, 14, -1],
    [24.0, 15, -1],
  ],
  [
    [10, 26, 10],
    [10.8, 22, 1.8],
    [12, 18, 1],
    [14.5, 12, 1],
    [17.5, 9, 1],
    [21.5, 16, 1],
    [24.0, 17, 1],
  ],
];

const DEFAULT_LANE = [-1.5, 1.5, -4.5, 4.5];
const PACE_PH = [0.0, 1.3, 2.1, 0.7];

function firePos(scriptLoc: string): [number, number] {
  if (/camp|fire/i.test(scriptLoc)) return [-2.4, 2.6];
  return [-2.4, 2.6];
}

function schedAt(s: SchedPt[], t: number): [number, number] {
  if (t <= s[0]![0]) return [s[0]![1], s[0]![2]];
  for (let i = 0; i < s.length - 1; i++) {
    const [a, ga, za] = s[i]!;
    const [b, gb, zb] = s[i + 1]!;
    if (a <= t && t <= b) {
      const u = smoothstep((t - a) / (b - a));
      return [lerp(ga, gb, u), lerp(za, zb, u)];
    }
  }
  const last = s[s.length - 1]!;
  return [last[1], last[2]];
}

/** Scale schedule times into the script's chase window. */
function scaleSched(
  base: SchedPt[],
  path: TravelPath,
  appearSec: number,
): SchedPt[] {
  const { leapStart, duration } = path.beats;
  const t0 = base[0]![0];
  const t1 = base[base.length - 1]![0];
  const span = Math.max(0.01, t1 - t0);
  return base.map(([t, g, z]) => {
    const u = (t - t0) / span;
    const nt = lerp(appearSec, Math.min(leapStart, duration * 0.95), u);
    return [nt, g, z] as SchedPt;
  });
}

/**
 * Rider head/body turn layered on the riding heading (deg; +90 = rider's left).
 * Mirrors gen_chase look_offset(): a look back holds through a following POV
 * shot; a twist-and-fire-back holds until the rider turns forward; left/right
 * turns hand off directly; "looks back, then rides off" is a quick glance.
 */
export function lookOffsetKeys(shots: ScriptShot[]): Array<[number, number]> {
  const keys: Array<[number, number]> = [[0, 0]];
  const sorted = [...shots].sort((a, b) => a.startSec - b.startSec);
  let cur = 0;
  let prevSide = false;
  const to = (t0: number, t1: number, v: number) => {
    keys.push([t0, cur], [t1, v]);
    cur = v;
  };
  sorted.forEach((s, i) => {
    const a = s.action.toLowerCase();
    const next = sorted[i + 1];
    const side =
      /\bon\s+(her|his|their)\s+(left|right)\b|\bturns?\s+(left|right)\b/.exec(
        a,
      );
    if (/\blooks?\s+back\b.*\bthen\b/.test(a)) {
      to(s.startSec, s.startSec + 0.35, 170);
      to(s.startSec + 0.7, s.startSec + 0.95, 0);
    } else if (/\btwists?\b.*\bback\b|\bfires?\s+back\b/.test(a)) {
      to(s.startSec + 0.05, s.startSec + 0.4, 180);
    } else if (
      /\blooks?\s+back\b|\bover\s+(her|his|their)\s+shoulder\b|\bturns?\s+back\b/.test(
        a,
      )
    ) {
      const holdEnd =
        next && /\bpov\b/.test(`${next.shotType} ${next.action}`.toLowerCase())
          ? next.endSec
          : s.endSec;
      to(s.startSec, s.startSec + 0.35, 150);
      to(holdEnd, holdEnd + 0.3, 0);
    } else if (side) {
      const v = (side[2] ?? side[3]) === "left" ? 90 : -90;
      const t0 = prevSide ? s.startSec - 0.05 : s.startSec + 0.05;
      to(t0, t0 + (prevSide ? 0.25 : 0.3), v);
      if (
        !next ||
        !/\bon\s+(her|his|their)\s+(left|right)\b|\bturns?\s+(left|right)\b/.test(
          next.action.toLowerCase(),
        )
      ) {
        to(s.endSec - 0.15, s.endSec + 0.05, 0);
      }
    } else if (
      /\bturns?\s+forward\b|\blooks?\s+ahead\b|\blight\s+ahead\b/.test(a) &&
      cur !== 0
    ) {
      to(s.startSec, s.startSec + 0.4, 0);
    }
    prevSide = Boolean(side);
  });
  if (cur !== 0) keys.push([1e8, cur]);
  keys.push([1e9, 0]);
  keys.sort((a, b) => a[0] - b[0]);
  return keys;
}

export function lookAt(keys: Array<[number, number]>, t: number): number {
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, va] = keys[i]!;
    const [b, vb] = keys[i + 1]!;
    if (a <= t && t <= b) {
      return b > a ? lerp(va, vb, (t - a) / (b - a)) : vb;
    }
  }
  return 0;
}

function sampleKeys(
  fn: (t: number) => Pose,
  fps: number,
  frames: number,
  step = 4,
  extra: number[] = [],
): BlockoutObjectKey[] {
  const framesSet = new Set<number>();
  for (let f = 0; f <= frames; f += step) framesSet.add(f);
  framesSet.add(frames);
  for (const e of extra) framesSet.add(clamp(e, 0, frames));

  const keys: BlockoutObjectKey[] = [];
  for (const f of [...framesSet].sort((a, b) => a - b)) {
    const p = fn(f / fps);
    keys.push({
      f,
      x: r3(p.x),
      y: r3(p.y),
      z: r3(p.z),
      rot: Math.round(p.rot * 10) / 10,
      ease: "linear",
    });
  }

  if (keys.length < 3) return keys;
  const out: BlockoutObjectKey[] = [keys[0]!];
  for (let i = 1; i < keys.length - 1; i++) {
    const a = keys[i - 1]!;
    const b = keys[i]!;
    const c = keys[i + 1]!;
    const same = (["x", "z", "rot"] as const).every(
      (k) => Math.abs(a[k] - b[k]) < 1e-3 && Math.abs(b[k] - c[k]) < 1e-3,
    );
    const ySame =
      Math.abs((a.y ?? 0) - (b.y ?? 0)) < 1e-3 &&
      Math.abs((b.y ?? 0) - (c.y ?? 0)) < 1e-3;
    if (!same || !ySame) out.push(b);
  }
  out.push(keys[keys.length - 1]!);
  return out;
}

function jog(t: number, path: TravelPath): number {
  // Sharp cut between two trunks (gen_chase shot 16)
  const b = path.beats.threadSec;
  const a = b - 0.4;
  const c = b + 0.4;
  if (t >= a && t < b) return lerp(0, 1.0, (t - a) / (b - a));
  if (t >= b && t < c) return lerp(1.0, 0, (t - b) / (c - b));
  return 0;
}

function mountY(t: number, path: TravelPath, v: number): number {
  const { leapStart, landSec, wantsCliff } = path.beats;
  const farY = path.farY;

  if (wantsCliff && t >= leapStart && t < landSec) {
    const u = (t - leapStart) / Math.max(0.01, landSec - leapStart);
    return path.leapHeight * 4 * u * (1 - u) + farY * u;
  }
  const base = wantsCliff && t >= landSec ? farY : 0;
  let y = base;
  if (v > 1.0) {
    const per = v < 9 ? 0.46 : 0.38;
    const amp = v < 9 ? 0.28 : 0.34;
    y += amp * Math.abs(Math.sin((Math.PI * t) / per)) * Math.min(1, v / 6);
  }
  if (wantsCliff && t >= leapStart - 0.28 && t < leapStart) {
    y = base - 0.14 * Math.sin((Math.PI * (t - (leapStart - 0.28))) / 0.28);
  }
  if (wantsCliff && t >= landSec && t < landSec + 0.35) {
    y = farY - 0.18 * Math.sin((Math.PI * (t - landSec)) / 0.35);
  }
  return y;
}

export type MotionContext = {
  path: TravelPath;
  fps: number;
  frames: number;
  fire: [number, number];
  g0: [number, number];
  lookKeys: Array<[number, number]>;
  mountAppear: number;
  pursuerAppear: number;
  /** Branch hits the ground; lead pursuer stumbles just after. */
  branchSec: number;
  /** Hand-over beat start (stranger's hand enters). */
  handSec: number;
  /** Rifle round hits a trunk beside the rider's head. */
  streakSec: number;
  /** Opening is staged around a campfire (gen_chase SEQ01). */
  campfire: boolean;
  /** Prey: herd bolts, scatters, and the hunt ends (gap closed). */
  fleeSec: number;
  /** Mid-air time of the hunted animal's own leap shot (e.g. "the antelope leaps the river"). */
  preyLeapSec: number | null;
  scatterSec: number;
  catchSec: number;
  corpus: string;
};

function firstShot(shots: ScriptShot[], re: RegExp): ScriptShot | undefined {
  return [...shots]
    .sort((a, b) => a.startSec - b.startSec)
    .find((s) => re.test(`${s.shotType} ${s.action}`.toLowerCase()));
}

export function buildMotionContext(
  path: TravelPath,
  shots: ScriptShot[],
  fps: number,
  frames: number,
  locationDesc: string,
  preyName?: string,
): MotionContext {
  const fire = firePos(locationDesc);
  const corpus = shots
    .map((s) => s.action)
    .join(" ")
    .toLowerCase();
  const branchShot = firstShot(shots, /\bbranch\b/);
  const handShot = firstShot(shots, /\bhand\b|\bgold\b|\bpouch\b/);
  const rifleShot = firstShot(
    shots,
    /\bred\s+flash|\brifle\s+flash|\bflashes\b|\bstreak\b/,
  );
  const { beats } = path;
  const fleeShot = firstShot(
    shots,
    /\bexplodes?\s+into\s+motion|\bbolts?\b|\bscatters?\b|\bflees?\b|\bfleeing\b|\bstampedes?\b|\bsprings?\s+away/,
  );
  const scatterShot = firstShot(
    shots,
    /\bscatters?\b|\bbreakaway\b|\bbreaks?\s+away|\bonly\s+the\s+one\b|\bsplits?\b/,
  );
  const catchShot = [...shots]
    .sort((a, b) => a.startSec - b.startSec)
    .find(
      (s) =>
        s.startSec >= beats.sprintStart &&
        /\bgunshot|\bshoots?\b|\btrigger\b|\bpounces?\b|\bcatches?\b|\bbrings?\s+\w+\s+down/.test(
          `${s.shotType} ${s.action}`.toLowerCase(),
        ),
    );
  const catchSec = catchShot?.startSec ?? beats.duration - 1.5;
  const fleeSec = Math.min(
    fleeShot?.startSec ?? beats.lopeStart - 0.5,
    beats.lopeStart,
  );
  const preyLeapShot = preyName
    ? firstShot(
        shots,
        new RegExp(`\\b${preyName.toLowerCase()}\\b.*\\b(leaps?|jumps?)\\b`),
      )
    : undefined;
  return {
    path,
    fps,
    frames,
    fire,
    g0: [-0.9, 1.1],
    lookKeys: lookOffsetKeys(shots),
    mountAppear: path.beats.lopeStart,
    pursuerAppear: Math.min(
      path.beats.sprintStart - 1.2,
      shots.find((s) => /burst|pursu|bandit|raptor/i.test(s.action))
        ?.startSec ?? path.beats.sprintStart - 1.2,
    ),
    branchSec: branchShot
      ? branchShot.startSec + 0.45
      : path.beats.leapStart - 3.55,
    handSec: handShot ? handShot.startSec + 0.1 : 1.6,
    streakSec: rifleShot
      ? rifleShot.startSec + 0.65
      : Math.min(path.beats.leapStart - 8.85, path.beats.threadSec - 2.75),
    campfire: /\bcampfire\b|\bcamp\b|\bbonfire\b/.test(
      `${corpus} ${locationDesc.toLowerCase()}`,
    ),
    fleeSec,
    preyLeapSec:
      preyLeapShot && beats.wantsCliff
        ? (preyLeapShot.startSec + preyLeapShot.endSec) / 2
        : null,
    scatterSec: clamp(
      scatterShot?.startSec ?? (fleeSec + catchSec) / 2,
      fleeSec + 0.5,
      catchSec,
    ),
    catchSec,
    corpus,
  };
}

function mountPose(ctx: MotionContext, t: number): Pose {
  const { path } = ctx;
  const x = path.X(t);
  const z = path.pz(x) + jog(t, path);
  const y = mountY(t, path, path.speed(t));
  const rot = headingOf(
    (tt) => {
      const xx = path.X(tt);
      return { x: xx, z: path.pz(xx) + jog(tt, path) };
    },
    t,
    path.beats.duration,
  );
  return { x, y, z, rot };
}

function riderPose(ctx: MotionContext, t: number, mount: Pose): Pose {
  const { g0, fire, lookKeys, mountAppear } = ctx;
  const [fx, fz] = fwd(mount.rot);
  const ride: Pose = {
    x: mount.x - 0.1 * fx,
    y: mount.y + SEAT,
    z: mount.z - 0.1 * fz,
    rot: mount.rot + lookAt(lookKeys, t),
  };

  if (!ctx.campfire) {
    // Waits beside the mount, then climbs on over the last 0.4 s.
    const m0 = mountPose(ctx, Math.max(0, mountAppear - 0.4));
    const beside: Pose = { x: m0.x - 0.3, y: 0, z: m0.z + 1.3, rot: 90 };
    if (t < mountAppear - 0.4) return beside;
    if (t < mountAppear) {
      const u = (t - (mountAppear - 0.4)) / 0.4;
      return {
        x: lerp(beside.x, ride.x, u),
        y:
          lerp(0, ride.y, Math.sin((u * Math.PI) / 2)) +
          0.35 * Math.sin(u * Math.PI),
        z: lerp(beside.z, ride.z, u),
        rot: lerp(beside.rot, ride.rot, u),
      };
    }
    return ride;
  }
  if (t < mountAppear - 1.05) {
    return { x: g0[0], y: 0, z: g0[1], rot: -45 };
  }
  const stand: Pose = { x: -0.72, y: 0, z: 0.72, rot: 162 };
  if (t < mountAppear - 0.8) {
    const u = (t - (mountAppear - 1.05)) / 0.25;
    return {
      x: lerp(g0[0], stand.x, u),
      y: 0,
      z: lerp(g0[1], stand.z, u),
      rot: lerp(-45, 162, Math.min(1, u)),
    };
  }
  if (t < mountAppear - 0.4) return stand;
  if (t < mountAppear) {
    const u = (t - (mountAppear - 0.4)) / 0.4;
    return {
      x: lerp(stand.x, ride.x, u),
      y: SEAT * Math.sin((u * Math.PI) / 2) + 0.35 * Math.sin(u * Math.PI),
      z: lerp(stand.z, ride.z, u),
      rot: lerp(162, 90, u),
    };
  }
  void fire;
  return ride;
}

function pursuerXz(
  ctx: MotionContext,
  packIndex: number,
  t: number,
): { x: number; z: number } {
  const { path, pursuerAppear } = ctx;
  const sched = scaleSched(
    DEFAULT_SCHED[packIndex % DEFAULT_SCHED.length]!,
    path,
    pursuerAppear,
  );
  const lane = DEFAULT_LANE[packIndex % DEFAULT_LANE.length]!;
  const stopX = path.edge - 1.7;
  const tt = Math.max(t, sched[0]![0]);
  const [gap, zo] = schedAt(sched, tt);
  const runX =
    path.X(Math.min(tt, path.beats.leapStart)) -
    gap +
    Math.max(0, tt - path.beats.leapStart) * 12;
  const runZ = path.pz(runX) + zo;
  if (runX < stopX - 6) return { x: runX, z: runZ };

  let x = Math.min(runX, stopX);
  const u = clamp((runX - (stopX - 6)) / 8.0, 0, 1);
  let z = lerp(runZ, lane, u);
  if (t > path.beats.stopSec - 0.1) {
    const ph = PACE_PH[packIndex % PACE_PH.length]!;
    const dt = t - (path.beats.stopSec - 0.1);
    z = lane + 1.1 * Math.sin(dt * 2.4 + ph);
    x = stopX - 0.6 - 0.6 * Math.cos(dt * 2.4 + ph);
  }
  return { x, z };
}

function pursuerPose(ctx: MotionContext, packIndex: number, t: number): Pose {
  const xz = pursuerXz(ctx, packIndex, t);
  const rot = headingOf(
    (tt) => pursuerXz(ctx, packIndex, tt),
    t,
    ctx.path.beats.duration,
  );
  const moving = t > ctx.pursuerAppear && t < ctx.path.beats.landSec - 0.6;
  let y = moving ? 0.1 * Math.abs(Math.sin((Math.PI * t) / 0.3)) : 0;
  // Lead stumbles over the branch, recovers
  if (packIndex === 0 && /\bbranch\b/.test(ctx.corpus)) {
    const branchT = ctx.branchSec + 0.1;
    if (t >= branchT && t <= branchT + 0.55) {
      const u = (t - branchT) / 0.55;
      y -= 0.4 * Math.sin(Math.PI * u);
      return { ...xz, y, rot: rot + 28 * Math.sin(Math.PI * u) };
    }
  }
  return { x: xz.x, y, z: xz.z, rot };
}

/** Herd offsets (dx along travel, dz lateral, grazing heading) for herd index 0..4. */
const HERD = [
  [0, 0, 90],
  [3.5, -3.5, 60],
  [-2.5, 3.2, 125],
  [5.5, 2.6, 100],
  [-4.5, -2.4, 75],
] as const;
const PREY_SPEED = 10;
const PREY_START_GAP = 32;

/** Prey's own run from its grazing spot (m along +x). */
function preyOwnRun(ctx: MotionContext, t: number): number {
  const s = t - ctx.fleeSec;
  if (s <= 0) return 0;
  const ramp = 0.8;
  return s < ramp
    ? (PREY_SPEED * s * s) / (2 * ramp)
    : PREY_SPEED * (ramp / 2 + s - ramp);
}

/** Hunted animal's x: flees at its own pace, then the mount reels it in. */
function preyTargetX(ctx: MotionContext, t: number): number {
  const { path, catchSec, preyLeapSec } = ctx;
  if (preyLeapSec !== null) {
    // Its own leap shot fixes when it is over the gap: graze far enough ahead
    // to be mid-air then, running at 8 m/s; after that the mount closes in.
    const run = (tt: number) => preyOwnRun(ctx, tt) * 0.8;
    const x0 = clamp(path.gc - run(preyLeapSec), 10, 40);
    if (t <= preyLeapSec) return x0 + run(t);
    const g1 = x0 + run(preyLeapSec) - path.X(preyLeapSec);
    const tc = Math.min(t, catchSec);
    const w = smoothstep(
      (tc - preyLeapSec) / Math.max(0.1, catchSec - preyLeapSec),
    );
    const x = path.X(tc) + lerp(g1, 7, w);
    return t <= catchSec ? x : x + PREY_SPEED * (t - catchSec);
  }
  const own = PREY_START_GAP + preyOwnRun(ctx, t);
  const from = path.beats.sprintFull;
  if (t <= from || catchSec <= from) return own;
  const tc = Math.min(t, catchSec);
  const caught = path.X(tc) + 7;
  const w = smoothstep((tc - from) / (catchSec - from));
  const x = lerp(PREY_START_GAP + preyOwnRun(ctx, tc), caught, w);
  return t <= catchSec ? x : x + PREY_SPEED * (t - catchSec);
}

function preyXz(
  ctx: MotionContext,
  role: CastRole,
  t: number,
): { x: number; z: number } {
  const { path, scatterSec, catchSec } = ctx;
  const [dx, dz] = HERD[(role.herdIndex ?? 0) % HERD.length]!;
  const tx = preyTargetX(ctx, t);
  const zig =
    t > scatterSec && t < catchSec
      ? 2.0 *
        Math.sin((t - scatterSec) * 2.4) *
        smoothstep((t - scatterSec) / 0.8)
      : 0;
  if (!role.herdIndex) return { x: tx, z: path.pz(tx) + zig };
  // Herd runs in formation, then peels off to the sides and falls behind.
  const s = Math.max(0, t - scatterSec);
  const side = dz >= 0 ? 1 : -1;
  const x = tx + dx - 5 * s;
  return { x, z: path.pz(x) + dz + side * 16 * smoothstep(s / 1.6) };
}

function preyPose(ctx: MotionContext, role: CastRole, t: number): Pose {
  const { path } = ctx;
  const { x, z } = preyXz(ctx, role, t);
  const moving = t > ctx.fleeSec;
  const graze = HERD[(role.herdIndex ?? 0) % HERD.length]![2];
  const rot = moving
    ? headingOf((tt) => preyXz(ctx, role, tt), t, path.beats.duration, graze)
    : graze;
  let y = moving ? 0.22 * Math.abs(Math.sin((Math.PI * t) / 0.4)) : 0;
  // Bound over the gap (river / chasm) by position, landing on the far side.
  if (path.beats.wantsCliff && x >= path.far) y += path.farY;
  if (path.beats.wantsCliff && x > path.edge && x < path.far) {
    const u = (x - path.edge) / Math.max(0.1, path.far - path.edge);
    y = (1.2 + path.gap * 0.1) * 4 * u * (1 - u) + path.farY * u;
  }
  return { x, y, z, rot };
}

/** Right-hand side offset for a pose heading (rot + 90 is the left). */
function toRight(p: Pose, d: number): { x: number; z: number } {
  const [rx, rz] = fwd(p.rot - 90);
  return { x: p.x + rx * d, z: p.z + rz * d };
}

function weaponPose(ctx: MotionContext, holder: Pose): Pose {
  void ctx;
  const { x, z } = toRight(holder, 0.3);
  return { x, y: holder.y + 1.1, z, rot: holder.rot };
}

function incidentalPose(
  ctx: MotionContext,
  role: CastRole,
  t: number,
  holder: Pose | null,
): Pose {
  const { path } = ctx;
  const [w0, w1] = role.window ?? [0, path.beats.duration];
  if (t < w0 - 0.01 || t > w1 + 0.01) {
    return { x: holder?.x ?? 0, y: HIDE, z: holder?.z ?? 0, rot: 0 };
  }
  if (role.carried && holder) {
    const { x, z } = toRight(holder, 0.45);
    return { x, y: holder.y + 0.55, z, rot: holder.rot };
  }
  // Water creatures surface in the river; anything else waits ahead of the mount.
  if (
    path.beats.gapKind === "river" &&
    path.beats.wantsCliff &&
    /croc|shark|fish|hippo|serpent|creature|monster/i.test(role.name)
  ) {
    return { x: path.gc, y: -0.6, z: path.pz(path.gc) + 2.5, rot: 270 };
  }
  const m = mountPose(ctx, w0);
  return { x: m.x + 8, y: 0, z: m.z + 3, rot: 270 };
}

/** Pose of any cast role at time t — shared by key sampling and cameras. */
export function makePoser(
  cast: CastRole[],
  ctx: MotionContext,
): (role: CastRole, t: number) => Pose {
  const mountRole = primaryMount(cast);
  const riderRole = primaryRider(cast);
  const mountAt = (t: number) => mountPose(ctx, t);
  const riderAt = (t: number) => riderPose(ctx, t, mountAt(t));
  const holderAt = (t: number) => (riderRole ? riderAt(t) : mountAt(t));
  return (role, t) => {
    if (mountRole && role.id === mountRole.id) return mountAt(t);
    if (riderRole && role.id === riderRole.id) return riderAt(t);
    if (role.role === "prey") return preyPose(ctx, role, t);
    if (role.role === "weapon") return weaponPose(ctx, holderAt(t));
    if (role.role === "incidental")
      return incidentalPose(ctx, role, t, holderAt(t));
    if (role.packIndex !== undefined && role.type === "raptor") {
      return pursuerPose(ctx, role.packIndex, t);
    }
    if (role.packIndex !== undefined && role.type === "character") {
      return banditOnRaptor(pursuerPose(ctx, role.packIndex, t));
    }
    const m = mountAt(t);
    return {
      x: m.x + role.pathBias * 0.15,
      y: m.y + role.y,
      z: m.z + role.lane,
      rot: m.rot,
    };
  };
}

function banditOnRaptor(raptor: Pose): Pose {
  const [fx, fz] = fwd(raptor.rot);
  return {
    x: raptor.x - 0.25 * fx,
    y: raptor.y + RIDE,
    z: raptor.z - 0.25 * fz,
    rot: raptor.rot,
  };
}

function popperKeys(
  timesPositions: Array<{ f0: number; f1: number; pos: Pose }>,
  hide: Pose = { x: 0, y: HIDE, z: 0, rot: 0 },
): BlockoutObjectKey[] {
  const keys: BlockoutObjectKey[] = [
    { f: 0, x: hide.x, y: hide.y, z: hide.z, rot: hide.rot, ease: "hold" },
  ];
  for (const { f0, f1, pos } of timesPositions) {
    keys.push({
      f: f0,
      x: r3(pos.x),
      y: r3(pos.y),
      z: r3(pos.z),
      rot: Math.round(pos.rot * 10) / 10,
      ease: "hold",
    });
    keys.push({
      f: f1,
      x: r3(pos.x),
      y: HIDE,
      z: r3(pos.z),
      rot: Math.round(pos.rot * 10) / 10,
      ease: "hold",
    });
  }
  return keys;
}

/**
 * Build densified cast objects + optional FX props for the part.
 */
export function buildCastObjects(
  cast: CastRole[],
  ctx: MotionContext,
  shots: ScriptShot[],
): BlockoutObject[] {
  const { path, fps, frames } = ctx;
  const mountRole = primaryMount(cast);
  const riderRole = primaryRider(cast);
  const objects: BlockoutObject[] = [];

  const jumpExtra: number[] = [];
  if (path.beats.wantsCliff) {
    const f0 = Math.round((path.beats.leapStart - 0.3) * fps);
    const f1 = Math.round((path.beats.landSec + 0.4) * fps);
    for (let f = f0; f <= f1; f += 2) jumpExtra.push(f);
  }

  const mountAt = (t: number) => mountPose(ctx, t);
  const poseOf = makePoser(cast, ctx);

  for (const role of cast) {
    let keys: BlockoutObjectKey[];

    if (mountRole && role.id === mountRole.id) {
      keys = sampleKeys(mountAt, fps, frames, 4, jumpExtra);
    } else if (riderRole && role.id === riderRole.id) {
      keys = sampleKeys(
        (t) => riderPose(ctx, t, mountAt(t)),
        fps,
        frames,
        3,
        jumpExtra,
      );
    } else if (role.packIndex !== undefined && role.type === "raptor") {
      keys = sampleKeys(
        (t) => pursuerPose(ctx, role.packIndex!, t),
        fps,
        frames,
        4,
      );
    } else if (role.packIndex !== undefined && role.type === "character") {
      keys = sampleKeys(
        (t) => banditOnRaptor(pursuerPose(ctx, role.packIndex!, t)),
        fps,
        frames,
        4,
      );
    } else if (role.role === "prey" || role.role === "weapon") {
      keys = sampleKeys(
        (t) => poseOf(role, t),
        fps,
        frames,
        role.role === "prey" ? 3 : 3,
        jumpExtra,
      );
    } else if (role.role === "incidental") {
      const extra: number[] = [];
      if (role.window) {
        for (const w of role.window) {
          const f = Math.round(w * fps);
          extra.push(f - 1, f, f + 1);
        }
      }
      keys = sampleKeys(
        (t) => poseOf(role, t),
        fps,
        frames,
        role.carried ? 3 : 6,
        extra,
      );
    } else if (!role.travels) {
      const rx = path.edge * 0.55;
      const hold = {
        x: rx + 4,
        y: role.y < 0 ? -1.2 : 0,
        z: path.pz(rx + 4),
        rot: 90,
      };
      keys = [
        { f: 0, x: hold.x, y: hold.y, z: hold.z, rot: hold.rot, ease: "hold" },
        {
          f: frames,
          x: hold.x,
          y: hold.y,
          z: hold.z,
          rot: hold.rot,
          ease: "hold",
        },
      ];
    } else {
      // Generic traveller: offset from mount path
      keys = sampleKeys(
        (t) => {
          const m = mountAt(t);
          return {
            x: m.x + role.pathBias * 0.15,
            y: m.y + role.y,
            z: m.z + role.lane,
            rot: m.rot,
          };
        },
        fps,
        frames,
        4,
      );
    }

    const k0 = keys[0]!;
    objects.push({
      id: role.id,
      type: role.type,
      name: role.name,
      color: role.color,
      size: role.size,
      pos: [k0.x, k0.z] as Vec2,
      y: k0.y,
      rot: k0.rot,
      keys,
      entityId: role.entityId,
    });
  }

  // Objects are keyed by their base (bench convention), so centre-computed
  // props drop by half their height — same offsets as gen_chase.
  const sink =
    (fn: (t: number) => Pose, dy: number) =>
    (t: number): Pose => {
      const p = fn(t);
      return { ...p, y: p.y - dy };
    };

  // FX: stranger's hand passes the gold, which goes into the satchel (campfire opening)
  if (ctx.campfire && /\bgold\b|\bpouch\b/.test(ctx.corpus)) {
    const d = ctx.handSec - 1.6;
    const C2 = { x: -1.2, z: 1.25 };
    const T2 = { x: -2.9, y: 1.0, z: 3.2 };
    const dx = T2.x - C2.x;
    const dz = T2.z - C2.z;
    const n = Math.hypot(dx, dz) || 1;
    const right: [number, number] = [-dz / n, dx / n];
    const H1 = { x: T2.x + 0.15, y: 1.08, z: T2.z - 0.1 };
    const H0 = {
      x: H1.x + right[0] * 2.4,
      y: 1.08,
      z: H1.z + right[1] * 2.4,
    };
    const handRot = (Math.atan2(H1.x - H0.x, H1.z - H0.z) * 180) / Math.PI;
    const handStart = 1.6 + d;
    const handEnd = 3.9 + d;

    const handFn = (t: number): Pose => {
      if (t < handStart || t > handEnd)
        return { x: H0.x, y: HIDE, z: H0.z, rot: handRot };
      let u: number;
      if (t < 2.5 + d) u = smoothstep((t - handStart) / 0.9);
      else if (t < 3.25 + d) u = 1;
      else u = 1 - (t - (3.25 + d)) / 0.65;
      return {
        x: lerp(H0.x, H1.x, u),
        y: 1.08,
        z: lerp(H0.z, H1.z, u),
        rot: handRot,
      };
    };

    objects.push({
      id: "fx-hand",
      type: "box",
      name: "Stranger hand",
      color: "#8f949c",
      size: [0.11, 0.1, 0.5],
      pos: [H0.x, H0.z],
      y: HIDE,
      rot: handRot,
      keys: sampleKeys(sink(handFn, 0.05), fps, frames, 2, [
        Math.round(handStart * fps) - 1,
        Math.round(handStart * fps),
        Math.round(handEnd * fps),
        Math.round(handEnd * fps) + 1,
      ]),
      label: false,
    });

    const satchelAt = (t: number): Pose => {
      const m = mountAt(t);
      const [mfx, mfz] = fwd(m.rot);
      return {
        x: m.x - 0.62 * mfx,
        y: m.y + 1.2,
        z: m.z - 0.62 * mfz,
        rot: m.rot,
      };
    };

    const goldFn = (t: number): Pose => {
      const h = handFn(t);
      const [fx, fz] = fwd(handRot);
      const tip = { x: h.x + fx * 0.3, y: 1.1, z: h.z + fz * 0.3 };
      if (t < handStart) return { x: tip.x, y: HIDE, z: tip.z, rot: 0 };
      if (t < 3.1 + d) return { ...tip, rot: 0 };
      const g = riderRole
        ? riderPose(ctx, t, mountAt(t))
        : { x: -0.7, y: 1, z: 0.7, rot: 0 };
      const palm = { x: g.x + 0.25, y: 1.05, z: g.z + 0.35 };
      if (t < 3.35 + d) {
        const u = (t - (3.1 + d)) / 0.25;
        return {
          x: lerp(tip.x, palm.x, u),
          y: lerp(tip.y, palm.y, u),
          z: lerp(tip.z, palm.z, u),
          rot: 0,
        };
      }
      const s = satchelAt(t);
      if (t < 3.75 + d) {
        const u = (t - (3.35 + d)) / 0.4;
        return {
          x: lerp(palm.x, s.x, u),
          y: lerp(palm.y, s.y + 0.3, u) + 0.2 * Math.sin(Math.PI * u),
          z: lerp(palm.z, s.z, u),
          rot: 0,
        };
      }
      return { x: s.x, y: s.y + 0.3, z: s.z, rot: 0 };
    };

    objects.push({
      id: "fx-gold",
      type: "sphere",
      name: "Gold pouch",
      color: "#f2c230",
      size: [0.24, 0.24, 0.24],
      pos: [0, 0],
      y: HIDE,
      rot: 0,
      keys: sampleKeys(sink(goldFn, 0.12), fps, frames, 2),
      glow: true,
    });

    if (/\bsatchel\b/.test(ctx.corpus)) {
      objects.push({
        id: "fx-satchel",
        type: "box",
        name: "Satchel",
        color: "#7a5230",
        size: [0.36, 0.3, 0.3],
        pos: [0, 0],
        rot: 0,
        keys: sampleKeys(sink(satchelAt, 0.15), fps, frames, 4, jumpExtra),
        label: false,
      });
    }
  }

  const muzzleBandit = (pack: number, t: number): Pose => {
    const b = banditOnRaptor(pursuerPose(ctx, pack, t));
    const [fx, fz] = fwd(b.rot);
    return { x: b.x + 0.6 * fx, y: b.y + 1.15, z: b.z + 0.6 * fz, rot: 0 };
  };

  // Pursuers' rifle flashes (red) + a streak into a trunk by the rider's head
  const rifleShot = shots.find((s) =>
    /\bred\s+flash|\brifle\s+flash|\bflashes\b|\bstreak\b/i.test(s.action),
  );
  if (rifleShot) {
    const fA = Math.round((rifleShot.startSec + 0.2) * fps);
    const fB = Math.round((rifleShot.startSec + 0.55) * fps);
    const m1 = muzzleBandit(0, fA / fps);
    const m2 = muzzleBandit(1, fB / fps);
    objects.push({
      id: "fx-flash-red",
      type: "sphere",
      name: "Rifle flash",
      color: "#ff4a3d",
      size: [0.4, 0.4, 0.4],
      pos: [0, 0],
      y: HIDE,
      rot: 0,
      keys: popperKeys([
        { f0: fA, f1: fA + 2, pos: { ...m1, y: m1.y - 0.2 } },
        { f0: fB, f1: fB + 2, pos: { ...m2, y: m2.y - 0.2 } },
      ]),
      glow: true,
      label: false,
    });
    if (/\bstreak\b|\btrunk\b/i.test(rifleShot.action)) {
      const [tx, tz] = hitTreeXZ(ctx);
      const hy = mountAt(ctx.streakSec).y;
      const head = { x: tx - 0.2, y: hy + SEAT + 1.35, z: tz + 0.2 };
      const sdx = head.x - m2.x;
      const sdz = head.z - m2.z;
      objects.push({
        id: "fx-streak",
        type: "box",
        name: "Bullet streak",
        color: "#ffb3a8",
        size: [Math.round(Math.hypot(sdx, sdz) * 100) / 100, 0.03, 0.03],
        pos: [0, 0],
        y: HIDE,
        rot: 0,
        keys: popperKeys([
          {
            f0: fB + 1,
            f1: fB + 5,
            pos: {
              x: (m2.x + head.x) / 2,
              y: (m2.y + head.y) / 2,
              z: (m2.z + head.z) / 2,
              rot: (Math.atan2(-sdz, sdx) * 180) / Math.PI,
            },
          },
        ]),
        label: false,
      });
    }
  }

  // Rider fires back (teal pistol flashes)
  const pistolShot = shots.find((s) =>
    /\bfires?\s+back\b|\bpistol\b/i.test(s.action),
  );
  if (pistolShot && riderRole) {
    const times = /\btwice\b/i.test(pistolShot.action)
      ? [pistolShot.startSec + 0.5, pistolShot.startSec + 1.0]
      : [pistolShot.startSec + 0.5];
    objects.push({
      id: "fx-flash-teal",
      type: "sphere",
      name: "Pistol flash",
      color: "#3ce0d0",
      size: [0.34, 0.34, 0.34],
      pos: [0, 0],
      y: HIDE,
      rot: 0,
      keys: popperKeys(
        times.map((t) => {
          const f0 = Math.round(t * fps);
          const g = riderPose(ctx, f0 / fps, mountAt(f0 / fps));
          const [fx, fz] = fwd(g.rot);
          return {
            f0,
            f1: f0 + 2,
            pos: { x: g.x + 0.7 * fx, y: g.y + 1.1, z: g.z + 0.7 * fz, rot: 0 },
          };
        }),
      ),
      glow: true,
      label: false,
    });
  }

  // Rider fires (e.g. "he fires; an amber muzzle flash")
  const riderFires = shots.filter(
    (s) =>
      s !== pistolShot &&
      /\b(he|she|they)\s+fires\b|\bmuzzle\s+flash\b/i.test(s.action),
  );
  if (riderFires.length > 0 && riderRole) {
    const holder = (t: number) => riderPose(ctx, t, mountAt(t));
    objects.push({
      id: "fx-flash-rider",
      type: "sphere",
      name: "Muzzle flash",
      color: "#ffb347",
      size: [0.34, 0.34, 0.34],
      pos: [0, 0],
      y: HIDE,
      rot: 0,
      keys: popperKeys(
        riderFires.slice(0, 4).map((s) => {
          const f0 = Math.round((s.startSec + 0.2) * fps);
          const g = holder(f0 / fps);
          const [fx, fz] = fwd(g.rot);
          return {
            f0,
            f1: f0 + 2,
            pos: { x: g.x + 1.4 * fx, y: g.y + 1.1, z: g.z + 1.4 * fz, rot: 0 },
          };
        }),
      ),
      glow: true,
      label: false,
    });
  }

  // A pursuer's hat is thrown at the edge
  if (/\bhat\b/.test(ctx.corpus)) {
    const pack = cast.some((r) => r.packIndex === 1) ? 1 : 0;
    const tThrow = path.beats.stopSec + 0.8;
    const hatFn = (t: number): Pose => {
      const b = banditOnRaptor(pursuerPose(ctx, pack, t));
      if (t < tThrow) return { x: b.x, y: b.y + 1.62, z: b.z, rot: b.rot };
      const b0 = banditOnRaptor(pursuerPose(ctx, pack, tThrow));
      const u = clamp((t - tThrow) / 0.4, 0, 1);
      return {
        x: lerp(b0.x, b0.x + 1.4, u),
        y: (b0.y + 1.62) * (1 - u) + 0.3 * Math.sin(Math.PI * u),
        z: lerp(b0.z, b0.z + 0.3, u),
        rot: b.rot + 200 * u,
      };
    };
    const f0 = Math.round((tThrow - 0.1) * fps);
    const extra: number[] = [];
    for (let f = f0; f <= f0 + Math.round(0.6 * fps); f++) extra.push(f);
    objects.push({
      id: "fx-hat",
      type: "column",
      name: "Hat",
      color: "#cdb57a",
      size: [0.56, 0.05, 0.56],
      pos: [0, 0],
      rot: 0,
      keys: sampleKeys(hatFn, fps, frames, 4, extra),
      label: false,
    });
  }

  // Falling branch across the path in front of the lead pursuer
  if (/\bbranch\b/.test(ctx.corpus)) {
    const p = pursuerPose(ctx, 0, ctx.branchSec + 0.15);
    const fDrop = Math.round((ctx.branchSec - 0.33) * fps);
    const fLand = Math.round(ctx.branchSec * fps);
    objects.push({
      id: "fx-branch",
      type: "box",
      name: "Falling branch",
      color: "#6d7179",
      size: [0.35, 0.35, 7.0],
      pos: [p.x, p.z],
      y: 7.4,
      rot: 8,
      keys: [
        { f: 0, x: r3(p.x), y: 7.4, z: r3(p.z), rot: 8, ease: "hold" },
        { f: fDrop, x: r3(p.x), y: 7.4, z: r3(p.z), rot: 8, ease: "in" },
        { f: fLand, x: r3(p.x), y: 0, z: r3(p.z), rot: 14, ease: "linear" },
      ],
      label: false,
    });
  }

  return objects;
}

/** Trunk the rifle round hits, just beside the mount's path. */
export function hitTreeXZ(ctx: MotionContext): [number, number] {
  const x = mountPose(ctx, ctx.streakSec).x + 1.6;
  return [x, ctx.path.pz(x) - 1.35];
}

/** Sample mount world position at time — for cameras / world clearance. */
export function sampleMountAt(ctx: MotionContext, t: number): Pose {
  return mountPose(ctx, t);
}

export function sampleRiderAt(ctx: MotionContext, t: number): Pose {
  return riderPose(ctx, t, mountPose(ctx, t));
}

export function samplePursuerAt(
  ctx: MotionContext,
  packIndex: number,
  t: number,
): Pose {
  return pursuerPose(ctx, packIndex, t);
}

export function runCorridorPoints(ctx: MotionContext): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const { fps, frames, path } = ctx;
  for (let f = 0; f <= frames; f += 2) {
    const t = f / fps;
    if (t < path.beats.leapStart) {
      const m = mountPose(ctx, t);
      pts.push([m.x, m.z]);
    }
  }
  for (let pi = 0; pi < 4; pi++) {
    for (let f = Math.round(ctx.pursuerAppear * fps); f <= frames; f += 2) {
      const p = pursuerXz(ctx, pi, f / fps);
      pts.push([p.x, p.z]);
    }
  }
  return pts;
}
