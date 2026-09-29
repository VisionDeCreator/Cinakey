/**
 * Compile a `cinakey.staging/1.0` plan into a part-scoped blockout document.
 *
 * Deterministic: the same plan + script always gives the same document. The
 * plan says *what* happens (who is where, who moves along which path, what
 * each camera frames); this module does the geometry — speed-integrated
 * paths, jump arcs, riders / carried props, visibility, set dressing, and
 * camera placement from shot size / angle / side / move.
 */

import type { ScriptPromptData } from "../../prompt-templates/schemas";
import { camAt } from "../engine/camera";
import { objAt } from "../engine/object";
import { applyEase } from "../engine/math";
import {
  BLOCKOUT_SCHEMA_ID,
  DEFAULT_OBJECT_DEFS,
  type BlockoutCameraKey,
  type BlockoutCutMarker,
  type BlockoutDocument,
  type BlockoutEase,
  type BlockoutObject,
  type BlockoutObjectKey,
  type BlockoutObjectType,
  type BlockoutProject,
  type Vec2,
  type Vec3,
} from "../types";
import type { DirectorShotLink } from "../director/cameras";
import { lookAt as lookAtKeys, lookOffsetKeys } from "../director/castMotion";
import { mergeKeptRanges } from "../director/merge";
import { resolveRiding, seatHeight, type RidingInterval } from "./riding";
import { clamp, fwd, hashSeed, lerp, mulberry32, r3 } from "../director/util";
import type {
  CARRY_STYLES,
  StagingCamera,
  StagingFeature,
  StagingCast,
  StagingMove,
  StagingPlan,
} from "./schema";

export type CompileStagingOpts = {
  sequenceId?: string;
  sequenceTitle?: string;
  liveShots?: DirectorShotLink[];
  existing?: BlockoutDocument | null;
  keepShotIds?: Set<string>;
};

const HIDE = -30;
const CAST_COLORS = [
  "#8cbf7a",
  "#cdb48f",
  "#7a9ccb",
  "#c97a8c",
  "#c9a44f",
  "#7abfb0",
  "#e6e6e3",
  "#b08cd0",
];

type Pose = { x: number; y: number; z: number; rot: number };
type ShotTiming = {
  n: number;
  start: number;
  end: number;
  desc: string;
  shotType: string;
  cameraMove?: string;
};

/* ----------------------------------------------------------------- cast */

function standInFor(c: StagingCast): { type: BlockoutObjectType; size: Vec3 } {
  const given = c.size as Vec3 | undefined;
  switch (c.kind) {
    case "person":
      return { type: "character", size: given ?? [0.5, 1.75, 0.5] };
    case "quadruped":
      return { type: "hare", size: given ?? [0.8, 2.2, 2.4] };
    case "bird":
      return { type: "sphere", size: given ?? [0.45, 0.45, 0.45] };
    case "creature":
      return { type: "raptor", size: given ?? DEFAULT_OBJECT_DEFS.raptor.size };
    case "vehicle":
      return { type: "car", size: given ?? DEFAULT_OBJECT_DEFS.car.size };
    default:
      return { type: "box", size: given ?? [0.3, 0.3, 0.3] };
  }
}

/** Height of the body the camera frames (quadruped stand-ins include ears). */
function bodyHeight(c: StagingCast, size: Vec3): number {
  return c.kind === "quadruped" ? size[1] * 0.62 : size[1];
}

/** How far a pose sinks to read as sitting / crouching / lying on an upright stand-in. */
function sinkFor(action: StagingMove["action"], h: number): number {
  if (action === "sit") return -0.3 * h;
  if (action === "crouch") return -0.35 * h;
  if (action === "lie") return -0.72 * h;
  return 0;
}

const POSTURES = new Set<StagingMove["action"]>(["sit", "crouch", "lie"]);
/** Actions that bring someone back to their feet; everything else keeps the posture. */
const UPRIGHT = new Set<StagingMove["action"]>([
  "stand",
  "walk",
  "run",
  "sprint",
  "jump",
  "leap",
  "drive",
  "fly",
  "mount",
  "dismount",
]);
const STEADY = new Set<StagingMove["action"]>([
  "run",
  "sprint",
  "drive",
  "fly",
]);

const MOVING = new Set([
  "walk",
  "run",
  "sprint",
  "drive",
  "fly",
  "jump",
  "leap",
  "fall",
]);

/** A river / chasm across the z axis, spanning x in [x0, x1]. */
export type Gap = {
  id: string;
  x0: number;
  x1: number;
  kind: "river" | "chasm";
  depth: number;
};

type TimedMove = { t0: number; t1: number; move: StagingMove };

type Segment = {
  t0: number;
  t1: number;
  move: StagingMove;
  pts: Vec2[];
  lens: number[];
  total: number;
  startPose: Pose;
  endRot: number;
  sink0: number;
  sink1: number;
  gap?: Gap;
  coast?: boolean;
  /** Coasting to a stop (eased out). */
  decel?: boolean;
};

function headingDeg(dx: number, dz: number, fallback: number) {
  return dx * dx + dz * dz < 1e-6
    ? fallback
    : (Math.atan2(dx, dz) * 180) / Math.PI;
}

function shortestTo(from: number, to: number) {
  let d = ((((to - from) % 360) + 540) % 360) - 180;
  if (d === -180) d = 180;
  return from + d;
}

function polyline(pts: Vec2[]) {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) {
    lens.push(
      lens[i - 1]! +
        Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]),
    );
  }
  return { lens, total: lens[lens.length - 1]! };
}

type TimelineOpts = {
  gaps: Gap[];
  /** Shot boundaries (s): a steady move that runs to one keeps going. */
  shotEnds: number[];
  duration: number;
};

/**
 * Build a pose-at-time function for one cast member from its moves.
 * Position is piecewise: hold, then travel each move's path (constant speed
 * for run / sprint / drive / fly so chases stay continuous across cuts; eased
 * for walks and in-place actions).
 *
 * - Postures (sit / crouch / lie) last until someone gets up; in-place actions
 *   like reach / fire / look don't stand them up.
 * - A run / sprint / drive / fly that is still going at a cut carries on at the
 *   same speed until the next move (things don't stop because the shot changed).
 * - A leap / jump over a gap arcs across the gap itself and lands past it.
 */
function castTimeline(
  c: StagingCast,
  h: number,
  moves: TimedMove[],
  facePoint: (id: string, t: number) => Vec2 | null,
  opts: TimelineOpts,
): (t: number) => Pose {
  const segs: Segment[] = [];
  let cur: Pose = { x: c.at[0], y: 0, z: c.at[1], rot: c.facing ?? 90 };
  const ordered = [...moves].sort((a, b) => a.t0 - b.t0);
  // A first move that is only a posture (sit / crouch / lie) is the starting state.
  const first = ordered[0]?.move;
  let sink =
    first && !first.path?.length && POSTURES.has(first.action)
      ? sinkFor(first.action, h)
      : 0;
  const initialSink = sink;
  const gapById = new Map(opts.gaps.map((g) => [g.id, g] as const));

  ordered.forEach(({ t0, t1, move }, i) => {
    const start: Pose = move.start
      ? { x: move.start[0], y: 0, z: move.start[1], rot: cur.rot }
      : { ...cur };
    let pts: Vec2[] = [[start.x, start.z], ...((move.path ?? []) as Vec2[])];
    const gap = move.over ? gapById.get(move.over) : undefined;
    if (gap && (move.action === "leap" || move.action === "jump")) {
      // Land a little past the far edge, whichever way they're going.
      const last = pts[pts.length - 1]!;
      const dir = last[0] >= start.x ? 1 : -1;
      const landX = dir > 0 ? gap.x1 + 1.5 : gap.x0 - 1.5;
      // Only nudge a landing that falls a little short — never stretch a path.
      const short = (landX - last[0]) * dir;
      if (short > 0 && short <= 8)
        pts = [...pts.slice(0, -1), [landX, last[1]]];
      if (pts.length === 1) pts.push([landX, start.z]);
    }
    const { lens, total } = polyline(pts);
    const last = pts[pts.length - 1]!;
    const prev = pts[Math.max(0, pts.length - 2)]!;
    let endRot =
      total > 0.05
        ? headingDeg(last[0] - prev[0], last[1] - prev[1], start.rot)
        : start.rot;
    if (typeof move.face === "number") endRot = move.face;
    else if (typeof move.face === "string") {
      const p = facePoint(move.face, t1);
      if (p) endRot = headingDeg(p[0] - last[0], p[1] - last[1], endRot);
    }
    endRot = shortestTo(start.rot, endRot);
    const sink1 = POSTURES.has(move.action)
      ? sinkFor(move.action, h)
      : UPRIGHT.has(move.action)
        ? 0
        : sink;
    const seg: Segment = {
      t0,
      t1: Math.max(t0 + 1 / 48, t1),
      move,
      pts,
      lens,
      total,
      startPose: start,
      endRot,
      sink0: sink,
      sink1,
      gap,
    };
    segs.push(seg);
    cur = { x: last[0], y: 0, z: last[1], rot: endRot };
    sink = sink1;

    // Momentum: still running at the cut. If the plan re-places them next, run
    // there (when that's a believable run); otherwise carry on for up to 2 s,
    // easing to a stop — never overshoot and snap back.
    const next = ordered[i + 1];
    const gapT = (next?.t0 ?? opts.duration) - seg.t1;
    const atCut = opts.shotEnds.some((e) => Math.abs(e - seg.t1) < 1e-3);
    if (STEADY.has(move.action) && total > 1 && atCut && gapT > 0.05) {
      const speed = total / (seg.t1 - seg.t0);
      const len = Math.max(
        1e-6,
        Math.hypot(last[0] - prev[0], last[1] - prev[1]),
      );
      let end: Vec2 | null = null;
      let t1c = seg.t1;
      let decel = false;
      if (next?.move.start) {
        const to = next.move.start as Vec2;
        const dist = Math.hypot(to[0] - last[0], to[1] - last[1]);
        if (dist / gapT <= speed * 1.5 + 1) {
          end = to;
          t1c = next.t0;
        }
      } else {
        const T = Math.min(gapT, 2);
        decel = !next || gapT > 2;
        const d = decel ? (speed * T) / 2 : speed * T;
        end = [
          last[0] + ((last[0] - prev[0]) / len) * d,
          last[1] + ((last[1] - prev[1]) / len) * d,
        ];
        t1c = seg.t1 + T;
      }
      if (end) {
        const coastPts: Vec2[] = [last, end];
        const pl = polyline(coastPts);
        segs.push({
          t0: seg.t1,
          t1: Math.max(seg.t1 + 1 / 48, t1c),
          move: {
            ...move,
            path: [end],
            start: undefined,
            face: undefined,
            over: undefined,
          },
          pts: coastPts,
          lens: pl.lens,
          total: pl.total,
          startPose: { ...cur },
          endRot: cur.rot,
          sink0: sink,
          sink1: sink,
          coast: true,
          decel,
        });
        cur = { x: end[0], y: 0, z: end[1], rot: cur.rot };
      }
    }
  });

  const along = (
    s: Segment,
    d: number,
  ): { x: number; z: number; rot: number } => {
    if (s.total <= 1e-6)
      return { x: s.pts[0]![0], z: s.pts[0]![1], rot: s.startPose.rot };
    let i = 1;
    while (i < s.lens.length - 1 && s.lens[i]! < d) i++;
    const a = s.pts[i - 1]!;
    const b = s.pts[i]!;
    const segLen = Math.max(1e-6, s.lens[i]! - s.lens[i - 1]!);
    const u = clamp((d - s.lens[i - 1]!) / segLen, 0, 1);
    return {
      x: lerp(a[0], b[0], u),
      z: lerp(a[1], b[1], u),
      rot: headingDeg(b[0] - a[0], b[1] - a[1], s.startPose.rot),
    };
  };

  return (t: number): Pose => {
    let pose: Pose = { x: c.at[0], y: 0, z: c.at[1], rot: c.facing ?? 90 };
    let baseSink = initialSink;
    for (const s of segs) {
      if (t < s.t0) break;
      const u = clamp((t - s.t0) / (s.t1 - s.t0), 0, 1);
      const act = s.move.action;
      const k = s.decel
        ? 1 - (1 - u) * (1 - u)
        : STEADY.has(act) || s.gap
          ? u
          : applyEase("inOut", u);
      const p = along(s, k * s.total);
      // Turn toward the travel direction quickly, then to the end facing.
      let rot: number;
      if (s.total > 0.05 && u < 1) rot = shortestTo(pose.rot, p.rot);
      else
        rot = lerp(
          s.startPose.rot,
          s.endRot,
          applyEase("inOut", clamp(u * 1.5, 0, 1)),
        );
      let y = 0;
      const height = s.move.height ?? (act === "leap" ? 1.5 : 0.6);
      if (s.gap && (act === "jump" || act === "leap")) {
        // Arc over the gap itself (run-up and run-out stay on the ground).
        const a0 = s.gap.x0 - 0.8;
        const a1 = s.gap.x1 + 0.8;
        const v = (p.x - a0) / Math.max(0.1, a1 - a0);
        y =
          v > 0 && v < 1
            ? Math.max(height, 1 + (a1 - a0) * 0.12) * 4 * v * (1 - v)
            : 0;
      } else if (act === "jump" || act === "leap") y = height * 4 * u * (1 - u);
      else if (act === "fly") y = s.move.height ?? 3;
      else if (act === "fall") y = -0.55 * h * applyEase("in", u);
      pose = { x: p.x, y, z: p.z, rot };
      // Sit / crouch / lie settle in about half a second.
      baseSink = lerp(
        s.sink0,
        s.sink1,
        applyEase(
          "inOut",
          clamp((t - s.t0) / Math.min(0.5, s.t1 - s.t0), 0, 1),
        ),
      );
      if (t <= s.t1) {
        // Gait bounce while travelling
        if (
          MOVING.has(act) &&
          s.total > 0.5 &&
          act !== "jump" &&
          act !== "leap" &&
          act !== "fly"
        ) {
          const amp =
            c.kind === "quadruped" ? 0.22 : c.kind === "person" ? 0.05 : 0;
          const per = act === "walk" ? 0.55 : 0.36;
          pose.y += amp * Math.abs(Math.sin((Math.PI * t) / per));
        }
        break;
      }
    }
    return { ...pose, y: pose.y + baseSink };
  };
}

type CarryStyle = (typeof CARRY_STYLES)[number];

/** Where a carried prop sits on its holder: [forward, right, up × height]. */
function carriedPose(hp: Pose, h: number, style: CarryStyle): Pose {
  const [fx, fz] = fwd(hp.rot);
  const [rx, rz] = fwd(hp.rot - 90);
  const place = (
    fwdM: number,
    rightM: number,
    y: number,
    rot = hp.rot,
  ): Pose => ({
    x: hp.x + fx * fwdM + rx * rightM,
    y,
    z: hp.z + fz * fwdM + rz * rightM,
    rot,
  });
  const elevated = hp.y > 0.5; // riding: a lowered hand hangs down the mount's flank
  switch (style) {
    case "low":
      return place(0.05, 0.5, elevated ? hp.y - 0.35 : hp.y + h * 0.3);
    case "back":
      return place(-0.2, 0.05, hp.y + h * 0.7, hp.rot + 60);
    case "shoulder":
      return place(0.35, 0.15, hp.y + h * 0.82);
    case "overhead":
      return place(0.1, 0, hp.y + h * 1.05);
    default:
      return place(0, 0.32, hp.y + h * 0.55);
  }
}

/**
 * Leaps and the gaps they cross must agree — conservatively:
 * - a leap / jump that already crosses a river / chasm gets its arc shaped
 *   over it; nothing moves;
 * - otherwise, if a real leap (≥ 6 m across, by an animal / vehicle / creature,
 *   or a "leap" with height) lands within 25 m of a gap that no leap crosses,
 *   the gap moves to that leap (narrowed to what it clears), and set pieces
 *   in the gap move with it;
 * - small hops and mounting jumps never move anything, and paths are never
 *   stretched.
 * Returns the features that belong inside a gap.
 */
function alignLeapsToGaps(
  plan: StagingPlan,
  movesBy: Map<string, TimedMove[]>,
  gaps: Gap[],
  stand: Map<string, { type: BlockoutObjectType; size: Vec3 }>,
  shotEnds: number[],
  duration: number,
): Set<StagingFeature> {
  const inGap = new Set<StagingFeature>();
  if (gaps.length === 0) return inGap;
  const castById = new Map(plan.cast.map((c) => [c.id, c] as const));

  const temp = new Map<string, (t: number) => Pose>();
  const tl = (id: string) => {
    let fn = temp.get(id);
    if (!fn) {
      const c = castById.get(id)!;
      fn = castTimeline(
        c,
        bodyHeight(c, stand.get(id)!.size),
        movesBy.get(id) ?? [],
        () => null,
        {
          gaps: [],
          shotEnds,
          duration,
        },
      );
      temp.set(id, fn);
    }
    return fn;
  };

  type Arc = {
    move: StagingMove;
    a0: number;
    a1: number;
    big: boolean;
    reach: number;
  };
  const arcs: Arc[] = [];
  for (const [id, ms] of movesBy) {
    const c = castById.get(id);
    if (!c) continue;
    for (const m of ms) {
      if (m.move.action !== "leap" && m.move.action !== "jump") continue;
      if (m.move.over) continue; // the model named the gap itself
      const x0 = tl(id)(m.t0).x;
      const x1 = tl(id)(m.t1).x;
      const len = Math.abs(x1 - x0);
      const bigMover =
        c.kind === "quadruped" || c.kind === "vehicle" || c.kind === "creature";
      const big =
        len >= 6 &&
        (bigMover || (m.move.action === "leap" && (m.move.height ?? 1.5) >= 1));
      // A big animal / vehicle leap is the hero moment: its gap may be further off.
      const reach = bigMover && len >= 8 ? 40 : 25;
      arcs.push({
        move: m.move,
        a0: Math.min(x0, x1),
        a1: Math.max(x0, x1),
        big,
        reach,
      });
    }
  }

  const skip = new Set(["river", "chasm", "sun", "moon", "bridge"]);
  for (const g of gaps) {
    const crossing = arcs.filter(
      (a) => a.a0 <= g.x0 + 0.5 && a.a1 >= g.x1 - 0.5,
    );
    if (crossing.length > 0) {
      for (const a of crossing) a.move.over = g.id;
    } else {
      const center = (g.x0 + g.x1) / 2;
      const near = arcs
        .filter((a) => a.big && Math.abs((a.a0 + a.a1) / 2 - center) <= a.reach)
        .sort(
          (a, b) =>
            Math.abs((a.a0 + a.a1) / 2 - center) -
            Math.abs((b.a0 + b.a1) / 2 - center),
        )[0];
      if (near) {
        const oldX0 = g.x0;
        const oldX1 = g.x1;
        const w = Math.max(2, Math.min(g.x1 - g.x0, 0.7 * (near.a1 - near.a0)));
        const c = (near.a0 + near.a1) / 2;
        g.x0 = c - w / 2;
        g.x1 = c + w / 2;
        const feat = plan.set.features.find((f) => f.id === g.id)!;
        const size = feat.size as Vec3 | undefined;
        feat.at = [g.x0, feat.at[1]];
        feat.size = [w, size?.[1] ?? g.depth, size?.[2] ?? 300];
        const delta = c - (oldX0 + oldX1) / 2;
        for (const f of plan.set.features) {
          if (skip.has(f.kind) || f === feat) continue;
          if (f.at[0] >= oldX0 - 1.5 && f.at[0] <= oldX1 + 1.5)
            f.at = [f.at[0] + delta, f.at[1]];
        }
        near.move.over = g.id;
      }
    }
    // At (or within 1.5 m of) the gap counts as in it.
    for (const f of plan.set.features) {
      if (!skip.has(f.kind) && f.at[0] >= g.x0 - 1.5 && f.at[0] <= g.x1 + 1.5)
        inGap.add(f);
    }
  }
  return inGap;
}

/* ----------------------------------------------------------------- set */

const LIVING =
  /\b(antelopes?|herds?|deer|horses?|hares?|cheetahs?|lions?|dogs?|wolf|wolves|raptors?|bandits?|riders?|man|men|woman|women|boy|girl|person|people|crowd|birds?|flock|creatures?|animals?|cattle|cows?|sheep|goats?)\b/;
const wordsOf = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (w) =>
        w.length > 2 &&
        !["the", "and", "big", "small", "old", "young", "giant"].includes(w),
    );

/**
 * Make the model's set list safe to build:
 * - boxes / columns / marks named after a cast member or a living thing are the
 *   cast listed twice — drop them (the cast is staged already);
 * - sizes are capped per kind (flat water / floors / roads; rocks, props and
 *   walls at sensible heights), so nothing turns into a giant pillar or wall.
 */
function sanitizeFeatures(plan: StagingPlan) {
  const castWords = new Set(
    plan.cast
      .filter(
        (c) =>
          c.kind === "person" ||
          c.kind === "quadruped" ||
          c.kind === "bird" ||
          c.kind === "creature",
      )
      .flatMap((c) => wordsOf(`${c.name} ${c.id}`)),
  );
  plan.set.features = plan.set.features.filter((f) => {
    if (!["box", "column", "mark"].includes(f.kind)) return true;
    const name = (f.name ?? f.id ?? "").toLowerCase();
    return !LIVING.test(name) && !wordsOf(name).some((w) => castWords.has(w));
  });
  for (const f of plan.set.features) {
    const size = f.size as Vec3 | undefined;
    if (!size) continue;
    const [w, h, d] = size;
    const tallOk =
      /\b(tower|pillar|statue|monument|tank|silo|container|truck|bus|ship|boat)\b/.test(
        (f.name ?? "").toLowerCase(),
      );
    const cap = (maxH: number, maxWD = 400): Vec3 => [
      Math.min(w, maxWD),
      Math.min(h, maxH),
      Math.min(d, maxWD),
    ];
    switch (f.kind) {
      case "water":
        f.size = cap(0.3);
        break;
      case "floor":
      case "road":
      case "path":
      case "mark":
        f.size = cap(0.05);
        break;
      case "rock":
        f.size = cap(6, 8);
        break;
      case "wall":
      case "window":
        f.size = [Math.min(w, 60), Math.min(h, 6), Math.min(d, 1)];
        break;
      case "building":
        f.size = cap(60, 120);
        break;
      case "tree":
        f.size = cap(25, 12);
        break;
      case "river":
      case "chasm":
      case "bridge":
      case "sun":
      case "moon":
      case "trees":
      case "rocks":
        break;
      default:
        f.size = cap(tallOk ? 12 : 4, tallOk ? 20 : 8);
    }
  }
}

function buildSet(
  plan: StagingPlan,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  avoid: Vec2[],
  rng: () => number,
  moving: Vec2[] = [],
  inGap: Set<StagingFeature> = new Set(),
): BlockoutObject[] {
  const out: BlockoutObject[] = [];
  const { terrain, timeOfDay } = plan.set;
  const groundColor =
    terrain === "desert"
      ? "#6b5f48"
      : terrain === "snow"
        ? "#c9ccd1"
        : terrain === "open"
          ? "#5d5646"
          : terrain === "urban"
            ? "#46484c"
            : "#34383f";
  let n = 0;
  const push = (
    o: Partial<BlockoutObject> &
      Pick<BlockoutObject, "type" | "name" | "color" | "size">,
  ) => {
    out.push({
      id: `set-${n++}`,
      keys: [],
      rot: 0,
      pos: [0, 0],
      y: 0,
      label: false,
      ...o,
    });
  };
  const clearOf = (x: number, z: number, r: number) =>
    !avoid.some(([a, b]) => Math.hypot(x - a, z - b) < r);

  // Ground, split around rivers / chasms (gaps run across z at feature x)
  const gaps = plan.set.features
    .filter((f) => f.kind === "river" || f.kind === "chasm")
    .map((f) => ({
      f,
      x0: f.at[0],
      w: (f.size as Vec3 | undefined)?.[0] ?? (f.kind === "river" ? 8 : 15),
    }))
    .sort((a, b) => a.x0 - b.x0);
  const pad = 80;
  const x0 = bounds.minX - pad;
  const x1 = bounds.maxX + pad;
  const zMid = (bounds.minZ + bounds.maxZ) / 2;
  const zLen = Math.max(160, bounds.maxZ - bounds.minZ + 2 * pad);
  if (terrain !== "water") {
    let from = x0;
    const pieces: Array<[number, number]> = [];
    for (const g of gaps) {
      if (g.x0 > from) pieces.push([from, g.x0]);
      from = g.x0 + g.w;
    }
    pieces.push([from, x1]);
    for (const [a, b] of pieces) {
      if (b - a < 0.1) continue;
      push({
        type: "box",
        name: "Ground",
        color: groundColor,
        size: [r3(b - a), 40, r3(zLen)],
        pos: [r3((a + b) / 2), r3(zMid)],
        y: -40,
      });
    }
  }
  for (const g of gaps) {
    const depth =
      (g.f.size as Vec3 | undefined)?.[1] ?? (g.f.kind === "river" ? 2.5 : 30);
    if (g.f.kind === "river" || terrain === "water") {
      push({
        type: "box",
        name: g.f.name ?? "River",
        color: "#3f5f7a",
        size: [r3(g.w), 0.3, r3(zLen)],
        pos: [r3(g.x0 + g.w / 2), r3(zMid)],
        y: -Math.min(depth, 3),
      });
    }
  }
  if (terrain === "water") {
    push({
      type: "box",
      name: "Water",
      color: "#3f5f7a",
      size: [r3(x1 - x0), 0.3, r3(zLen)],
      pos: [r3((x0 + x1) / 2), r3(zMid)],
      y: -0.3,
    });
  }

  const tree = (x: number, z: number, h?: number) => {
    const open = terrain !== "forest";
    push({
      type: "tree",
      name: "Tree",
      color: open ? "#4f4a3e" : "#4a4e55",
      size: [
        Math.round((open ? 0.35 + rng() * 0.2 : 0.5 + rng() * 0.3) * 100) / 100,
        h ?? Math.round((open ? 4.5 + rng() * 2.5 : 8 + rng() * 3.5) * 10) / 10,
        Math.round((open ? 6 + rng() * 3 : 4 + rng() * 2.2) * 10) / 10,
      ],
      pos: [r3(x), r3(z)],
    });
  };
  const rock = (x: number, z: number, s: number) =>
    push({
      type: "box",
      name: "Rock",
      color: "#6b6258",
      size: [r3(s * 1.3), r3(s), r3(s * 1.1)],
      pos: [r3(x), r3(z)],
      rot: Math.round(rng() * 90),
    });

  const SOLID = new Set([
    "tree",
    "rock",
    "building",
    "table",
    "chair",
    "sofa",
    "bed",
    "counter",
    "box",
    "column",
    "car",
  ]);
  for (const f of plan.set.features) {
    const size = f.size as Vec3 | undefined;
    const fx = f.at[0];
    let fz = f.at[1];
    // Solid set pieces never stand where someone runs / walks / drives: slide them aside.
    if (SOLID.has(f.kind) && !inGap.has(f)) {
      const hw = (size?.[0] ?? (f.kind === "building" ? 10 : 1.4)) / 2;
      const hd = (size?.[2] ?? (f.kind === "building" ? 10 : 1.4)) / 2;
      const zs = moving
        .filter(([px]) => Math.abs(px - fx) < hw + 0.6)
        .map(([, pz]) => pz);
      if (zs.some((pz) => Math.abs(pz - fz) < hd + 0.6)) {
        // Just past whichever edge of the traffic band is nearer.
        const above = Math.max(...zs) + hd + 1.5;
        const below = Math.min(...zs) - hd - 1.5;
        fz = Math.abs(above - fz) <= Math.abs(below - fz) ? above : below;
      }
    }
    const before = out.length;
    const name = f.name ?? f.kind;
    const color = f.color;
    const scatter = (
      count: number,
      spread: number,
      fn: (x: number, z: number) => void,
      clearance: number,
    ) => {
      let placed = 0;
      for (let i = 0; i < count * 4 && placed < count; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * spread;
        const x = fx + Math.cos(a) * r;
        const z = fz + Math.sin(a) * r;
        if (!clearOf(x, z, clearance)) continue;
        if (gaps.some((g) => x > g.x0 - 1 && x < g.x0 + g.w + 1)) continue;
        fn(x, z);
        placed++;
      }
    };
    switch (f.kind) {
      case "tree":
        tree(fx, fz, size?.[1]);
        break;
      case "trees":
        scatter(f.count ?? 12, f.spread ?? 20, (x, z) => tree(x, z), 2.5);
        break;
      case "rock":
        rock(fx, fz, size?.[1] ?? 1.5);
        break;
      case "rocks":
        // Largest rock is ~3 m across: keep the whole cluster that far off the paths.
        scatter(
          f.count ?? 6,
          f.spread ?? 6,
          (x, z) => rock(x, z, 0.8 + rng() * 2.2),
          3.2,
        );
        break;
      case "building":
        push({
          type: "box",
          name,
          color: color ?? "#5a5e66",
          size: size ?? [10, 8, 10],
          pos: [fx, fz],
          rot: f.rot ?? 0,
          label: true,
        });
        break;
      case "wall":
        push({
          type: "wall",
          name,
          color: color ?? "#6a6e75",
          size: size ?? [6, 2.8, 0.2],
          pos: [fx, fz],
          rot: f.rot ?? 0,
        });
        break;
      case "window":
        push({
          type: "wall",
          name,
          color: color ?? "#9fb6cc",
          size: size ?? [1.4, 1.3, 0.08],
          pos: [fx, fz],
          y: 0.9,
          rot: f.rot ?? 0,
        });
        break;
      case "floor":
        push({
          type: "box",
          name,
          color: color ?? "#4b4f56",
          size: size ?? [10, 0.05, 10],
          pos: [fx, fz],
          y: -0.05,
          rot: f.rot ?? 0,
        });
        break;
      case "table":
      case "chair":
      case "door":
      case "column":
      case "car":
      case "mark":
        push({
          type: f.kind,
          name,
          color: color ?? DEFAULT_OBJECT_DEFS[f.kind].color,
          size: size ?? DEFAULT_OBJECT_DEFS[f.kind].size,
          pos: [fx, fz],
          rot: f.rot ?? 0,
          label: f.kind === "car",
        });
        break;
      case "sofa":
        push({
          type: "box",
          name,
          color: color ?? "#7d6f64",
          size: size ?? [2.1, 0.85, 0.9],
          pos: [fx, fz],
          rot: f.rot ?? 0,
        });
        break;
      case "bed":
        push({
          type: "box",
          name,
          color: color ?? "#8a8f98",
          size: size ?? [1.6, 0.55, 2.1],
          pos: [fx, fz],
          rot: f.rot ?? 0,
        });
        break;
      case "counter":
        push({
          type: "box",
          name,
          color: color ?? "#80848c",
          size: size ?? [3, 0.95, 0.7],
          pos: [fx, fz],
          rot: f.rot ?? 0,
        });
        break;
      case "box":
        push({
          type: "box",
          name,
          color: color ?? "#9aa0a8",
          size: size ?? [1.2, 1, 1.2],
          pos: [fx, fz],
          rot: f.rot ?? 0,
          label: Boolean(f.name),
        });
        break;
      case "fire":
        push({
          type: "fire",
          name: f.name ?? "FIRE",
          color: "#e8772e",
          size: size ?? [0.6, 0.7, 0.6],
          pos: [fx, fz],
          label: true,
        });
        break;
      case "lamp":
        push({
          type: "column",
          name,
          color: "#6d7179",
          size: [0.12, size?.[1] ?? 1.6, 0.12],
          pos: [fx, fz],
        });
        push({
          type: "light",
          name,
          color: "#ffd9a0",
          size: [0.25, 0.25, 0.25],
          pos: [fx, fz],
          y: size?.[1] ?? 1.6,
          lightRole: "key",
          intensity: 0.7,
        });
        break;
      case "road":
      case "path": {
        const pts = (f.points as Vec2[] | undefined) ?? [
          [fx, fz],
          [fx + (size?.[2] ?? 40), fz],
        ];
        const w = size?.[0] ?? (f.kind === "road" ? 7 : 2.6);
        for (let i = 1; i < pts.length; i++) {
          const [ax, az] = pts[i - 1]!;
          const [bx, bz] = pts[i]!;
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 0.1) continue;
          push({
            type: "strip",
            name: f.kind === "road" ? "Road" : "Path",
            color: color ?? (f.kind === "road" ? "#3b3d42" : "#50545b"),
            size: [w, 0.02, r3(len + 0.3)],
            pos: [r3((ax + bx) / 2), r3((az + bz) / 2)],
            rot:
              Math.round(
                ((Math.atan2(bx - ax, bz - az) * 180) / Math.PI) * 10,
              ) / 10,
          });
        }
        break;
      }
      case "bridge":
        push({
          type: "box",
          name,
          color: color ?? "#6d6152",
          size: size ?? [12, 0.4, 3],
          pos: [fx, fz],
          y: -0.2,
          rot: f.rot ?? 0,
          label: true,
        });
        break;
      case "water":
        push({
          type: "box",
          name,
          color: "#3f5f7a",
          size: size ?? [20, 0.3, 20],
          pos: [fx, fz],
          y: -0.3,
          rot: f.rot ?? 0,
        });
        break;
      case "sun":
      case "moon":
        push({
          type: "sphere",
          name: f.kind === "sun" ? "SUN" : "MOON",
          color: f.kind === "sun" ? "#ffb46b" : "#f2f2ee",
          size: size ?? [16, 16, 16],
          pos: [fx, fz],
          y: f.kind === "sun" ? 4 : 10,
          glow: true,
        });
        push({
          type: "light",
          name: f.kind === "sun" ? "Sunlight" : "Moonlight",
          color: f.kind === "sun" ? "#ffcf99" : "#dce6ff",
          size: [0.4, 0.4, 0.4],
          pos: [(bounds.minX + bounds.maxX) / 2, fz * 0.2],
          y: f.kind === "sun" ? 12 : 18,
          lightRole: "back",
          intensity: 0.7,
        });
        break;
      case "river":
      case "chasm":
        break;
    }
    // Things in a river / chasm (a waterfall, spray, far rocks) sit down in it.
    if (inGap.has(f)) {
      for (const o of out.slice(before)) {
        if (o.type !== "light") o.y = -o.size[1] - 0.3;
      }
    }
  }

  const night = timeOfDay === "night";
  push({
    type: "light",
    name: "Key",
    color: night
      ? "#c8d4ff"
      : timeOfDay === "golden" || timeOfDay === "dusk"
        ? "#ffcf99"
        : "#fff4e0",
    size: [0.3, 0.3, 0.3],
    pos: [bounds.minX + 4, bounds.maxZ + 6],
    y: 8,
    lightRole: "key",
    intensity: night ? 0.7 : 1.1,
  });
  push({
    type: "light",
    name: "Fill",
    color: "#c8d8ff",
    size: [0.25, 0.25, 0.25],
    pos: [bounds.minX - 4, bounds.minZ - 6],
    y: 4,
    lightRole: "fill",
    intensity: 0.45,
  });
  return out;
}

function skyFor(timeOfDay: StagingPlan["set"]["timeOfDay"]): string {
  switch (timeOfDay) {
    case "night":
      return "#2a2d33";
    case "golden":
    case "dusk":
    case "dawn":
      return "#8a7480";
    case "interior":
      return "#1f2227";
    default:
      return "#87a0b8";
  }
}

/* ----------------------------------------------------------------- camera */

const SIZE_DIST: Record<StagingCamera["size"], number> = {
  ecu: 0.45,
  cu: 0.9,
  mcu: 1.4,
  medium: 2.2,
  cowboy: 3.0,
  full: 4.4,
  wide: 9,
  ews: 28,
  insert: 0.6,
};
const SIZE_LENS: Record<StagingCamera["size"], number> = {
  ecu: 85,
  cu: 50,
  mcu: 50,
  medium: 35,
  cowboy: 35,
  full: 28,
  wide: 24,
  ews: 18,
  insert: 85,
};
/** Aim point as a fraction of subject height. */
const SIZE_AIM: Record<StagingCamera["size"], number> = {
  ecu: 0.93,
  cu: 0.9,
  mcu: 0.86,
  medium: 0.78,
  cowboy: 0.66,
  full: 0.55,
  wide: 0.5,
  ews: 0.3,
  insert: 0.5,
};
const SIDE_DEG: Record<StagingCamera["side"], number> = {
  front: 0,
  front_left: 40,
  left: 90,
  back_left: 140,
  back: 180,
  back_right: -140,
  right: -90,
  front_right: -40,
};

type Subject = {
  at: (t: number) => Pose;
  h: number;
  eye: number;
  /** Size used for framing distance (length matters for animals / vehicles). */
  frame: number;
  id?: string;
};

/** A solid thing the camera must not sit inside or look through. */
export type Obstacle = {
  id: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  w: number;
  h: number;
  d: number;
};

type ShotExtras = {
  /** Aim height as a fraction of the subject (face / hands / hooves …). */
  aimFrac?: number;
  /** Camera placed here (a cast member's eyes, a feature, a ground point). */
  from?: (t: number) => Vec3 | null;
  /** How far behind the "from" spot to stand (clear of that cast member's body). */
  fromBack?: number;
  /** Everything solid at time t (cast stand-ins + set pieces). */
  obstacles?: (t: number) => Obstacle[];
};

/** Is a point inside an obstacle's box (heading-aligned; depth runs along the heading)? */
export function insideObstacle(pt: Vec3, o: Obstacle, pad = 0.15): boolean {
  if (pt[1] < o.y - pad || pt[1] > o.y + o.h + pad) return false;
  const a = (o.rot * Math.PI) / 180;
  const dx = pt[0] - o.x;
  const dz = pt[2] - o.z;
  const along = dx * Math.sin(a) + dz * Math.cos(a);
  const side = dx * Math.cos(a) - dz * Math.sin(a);
  return Math.abs(along) < o.d / 2 + pad && Math.abs(side) < o.w / 2 + pad;
}

/** Does the line of sight from the camera to (just short of) the target pass through an obstacle? */
export function sightBlocked(
  pos: Vec3,
  target: Vec3,
  obstacles: Obstacle[],
): Obstacle | null {
  const len = Math.hypot(
    target[0] - pos[0],
    target[1] - pos[1],
    target[2] - pos[2],
  );
  const steps = Math.ceil(len / 0.15);
  for (let i = 1; i < steps * 0.9; i++) {
    const u = i / steps;
    const pt: Vec3 = [
      lerp(pos[0], target[0], u),
      lerp(pos[1], target[1], u),
      lerp(pos[2], target[2], u),
    ];
    const hit = obstacles.find((o) => insideObstacle(pt, o, 0.02));
    if (hit) return hit;
  }
  return null;
}

function cameraKeysForShot(
  shot: ShotTiming,
  cam: StagingCamera,
  subjectOf: (id: string | undefined) => Subject | null,
  fallback: Subject,
  fps: number,
  nextId: () => string,
  extra: ShotExtras = {},
): { keys: BlockoutCameraKey[]; focal: number } {
  const span = shot.end - shot.start;
  const focal = cam.lensMm ?? (cam.pov ? 35 : SIZE_LENS[cam.size]);
  const S = subjectOf(cam.subject) ?? fallback;
  const S2 = subjectOf(cam.subject2);
  const startF = Math.round(shot.start * fps);
  const lastF = Math.max(startF, Math.round(shot.end * fps) - 1);

  // Average travel heading over the shot keeps side cameras steady on zig-zags.
  const a0 = S.at(shot.start);
  const a1 = S.at(shot.end);
  const heading =
    Math.hypot(a1.x - a0.x, a1.z - a0.z) > 1
      ? headingDeg(a1.x - a0.x, a1.z - a0.z, a0.rot)
      : S.at(shot.start + span / 2).rot;

  const baseDist = (() => {
    const base = Math.max(0.3, S.frame);
    return cam.size === "wide" || cam.size === "ews"
      ? SIZE_DIST[cam.size] * Math.max(1, base / 1.7) * (focal / 24)
      : SIZE_DIST[cam.size] * (base / 1.7) * (focal / 35);
  })();

  // A locked-off camera frames the subject's whole movement in the shot:
  // centred on it, and far enough back that it never leaves frame. If that
  // would put it miles away (a fast runner), pan from a normal distance instead.
  const isStatic = cam.move === "static" || lastF <= startF;
  let fit: { center: Pose; minDist: number } | null = null;
  let panned = false;
  if (isStatic && !cam.black && !cam.pov && !S2 && !extra.from) {
    const samples = Array.from({ length: 9 }, (_, i) =>
      S.at(shot.start + (span * i) / 8),
    ).filter((q) => q.y > HIDE + 1);
    if (samples.length > 0) {
      const center: Pose = {
        x: samples.reduce((a, q) => a + q.x, 0) / samples.length,
        y: samples[Math.floor(samples.length / 2)]!.y,
        z: samples.reduce((a, q) => a + q.z, 0) / samples.length,
        rot: S.at(shot.start + span / 2).rot,
      };
      const [cx, cz] = fwd(heading + SIDE_DEG[cam.side]);
      const halfW = Math.atan(18 / focal) * 0.85;
      let minDist = 0;
      for (const q of samples) {
        const rx = q.x - center.x;
        const rz = q.z - center.z;
        const along = rx * cx + rz * cz; // toward the camera
        const lateral = Math.abs(rx * cz - rz * cx);
        minDist = Math.max(
          minDist,
          along + Math.max(1.2, lateral / Math.tan(halfW)),
        );
      }
      fit = { center, minDist };
      if (minDist > Math.max(2.5 * baseDist, 10) && lastF > startF) {
        fit = null;
        panned = true;
      }
    }
  }
  // A camera placed at a moving cast member travels with them.
  const moveKind: StagingCamera["move"] = panned
    ? "pan"
    : extra.from && cam.move === "static"
      ? "follow"
      : cam.move;

  type Adj = { yaw: number; lift: number };
  const NO_ADJ: Adj = { yaw: 0, lift: 0 };

  // Never inside anything: back the camera out along its line of sight.
  const pushOut = (pos: Vec3, target: Vec3, t: number): Vec3 => {
    const obs = extra.obstacles?.(t);
    if (!obs?.length) return pos;
    let dir: Vec3 = [
      pos[0] - target[0],
      pos[1] - target[1],
      pos[2] - target[2],
    ];
    const len = Math.hypot(...dir);
    dir = len < 1e-3 ? [0, 1, 0] : [dir[0] / len, dir[1] / len, dir[2] / len];
    let out = pos;
    for (
      let i = 0;
      i < 60 && obs.some((o) => insideObstacle(out, o, 0.35));
      i++
    ) {
      out = [
        out[0] + dir[0] * 0.2,
        Math.max(0.15, out[1] + dir[1] * 0.2),
        out[2] + dir[2] * 0.2,
      ];
    }
    return out;
  };

  const rawPose = (
    t: number,
    u: number,
    adj: Adj,
  ): { pos: Vec3; target: Vec3; guard: boolean } => {
    if (cam.black) {
      const p = S.at(t);
      return { pos: [p.x, 80, p.z], target: [p.x, 90, p.z], guard: false };
    }
    const p = fit ? fit.center : S.at(t);
    const base = Math.max(0.3, S.h);
    let aimY = p.y + base * (extra.aimFrac ?? SIZE_AIM[cam.size]);
    let target: Vec3 = [p.x, aimY, p.z];

    if (extra.from && !cam.pov) {
      const at = extra.from(t);
      // A "from" spot on top of the subject would sit inside it — frame normally instead.
      if (at && Math.hypot(at[0] - p.x, at[2] - p.z) >= 2.5) {
        // Just behind the spot, looking at the subject.
        const dx = at[0] - p.x;
        const dz = at[2] - p.z;
        const len = Math.max(0.1, Math.hypot(dx, dz));
        const back = extra.fromBack ?? 1.0;
        return {
          pos: [
            at[0] + (dx / len) * back,
            Math.max(0.3, at[1] + 0.3),
            at[2] + (dz / len) * back,
          ],
          target,
          guard: true,
        };
      }
    }

    if (cam.pov) {
      const eye = subjectOf(cam.pov);
      if (eye) {
        const e = eye.at(t);
        const [fx, fz] = fwd(e.rot);
        const pos: Vec3 = [e.x + fx * 0.25, e.y + eye.eye, e.z + fz * 0.25];
        const look: Vec3 = cam.subject
          ? [p.x, aimY, p.z]
          : [e.x + fx * 20, e.y + eye.eye * 0.8, e.z + fz * 20];
        return { pos, target: look, guard: false };
      }
    }

    let dist = Math.max(0.35, baseDist, fit?.minDist ?? 0);
    let sideDeg = SIDE_DEG[cam.side];

    if (S2) {
      const q = S2.at(t);
      if (cam.overShoulder) {
        // Behind subject2's shoulder, looking past it at the subject.
        const dx = p.x - q.x;
        const dz = p.z - q.z;
        const len = Math.max(0.1, Math.hypot(dx, dz));
        const ux = dx / len;
        const uz = dz / len;
        const pos: Vec3 = [
          q.x - ux * 0.9 - uz * 0.35,
          q.y + S2.eye * 1.0,
          q.z - uz * 0.9 + ux * 0.35,
        ];
        return { pos, target: [p.x, aimY, p.z], guard: false };
      }
      // Two-shot: aim between them, back off to fit both, perpendicular to their line.
      const mx = (p.x + q.x) / 2;
      const mz = (p.z + q.z) / 2;
      const sep = Math.hypot(p.x - q.x, p.z - q.z);
      aimY = Math.max(p.y, q.y) + Math.max(base, S2.h) * SIZE_AIM[cam.size];
      target = [mx, aimY, mz];
      dist = Math.max(dist, (sep * 0.9 + 1) * (focal / 35));
      const lineDeg = headingDeg(q.x - p.x, q.z - p.z, heading);
      sideDeg = lineDeg + 90 - heading + (cam.side.includes("right") ? 180 : 0);
    }

    sideDeg += adj.yaw;
    let d = dist;
    if (cam.move === "push_in") d = lerp(dist * 1.6, dist * 0.85, u);
    if (cam.move === "pull_out") d = lerp(dist * 0.85, dist * 1.6, u);
    if (cam.move === "orbit") sideDeg += lerp(-35, 35, u);
    const [dx, dz] = fwd(heading + sideDeg);
    let y = target[1];
    if (cam.angle === "low") y = Math.max(0.3, target[1] * 0.35);
    if (cam.angle === "ground") y = 0.15;
    if (cam.angle === "high") y = target[1] + d * 0.7;
    if (cam.move === "crane_up")
      y = lerp(Math.max(0.4, target[1] * 0.4), target[1] + d * 0.9, u);
    if (cam.move === "crane_down")
      y = lerp(target[1] + d * 0.9, Math.max(0.4, target[1] * 0.6), u);
    let pos: Vec3 = [
      target[0] + dx * d,
      Math.max(0.15, y + adj.lift),
      target[2] + dz * d,
    ];
    if (cam.angle === "overhead") {
      const [bx, bz] = fwd(heading + 180);
      pos = [
        target[0] + bx * 0.05,
        target[1] + Math.max(8, d * 1.6),
        target[2] + bz * 0.05,
      ];
      target = [target[0], Math.max(0, p.y), target[2]];
    }
    if (cam.move === "handheld") {
      pos = [
        pos[0] + 0.06 * Math.sin(t * 7.1),
        pos[1] + 0.04 * Math.sin(t * 9.3),
        pos[2] + 0.06 * Math.cos(t * 6.7),
      ];
    }
    return { pos, target, guard: true };
  };

  // Close / medium framings must see the subject: if the mount, another
  // character or a set piece is in the way, swing round (one choice per shot).
  const closeish =
    !["wide", "ews"].includes(cam.size) && cam.angle !== "overhead";
  let adj: Adj = NO_ADJ;
  if (closeish && extra.obstacles && !cam.black && !cam.pov) {
    const times = [
      shot.start + 0.02,
      shot.start + span / 2,
      Math.max(shot.start, shot.end - 0.05),
    ];
    const skip = new Set([S.id, S2?.id].filter(Boolean) as string[]);
    const clear = (a: Adj) =>
      times.every((t) => {
        const r = rawPose(
          t,
          clamp((t - shot.start) / Math.max(0.01, span), 0, 1),
          a,
        );
        if (!r.guard) return true;
        const pos = pushOut(r.pos, r.target, t);
        const obs = extra.obstacles!(t).filter((o) => !skip.has(o.id));
        return !sightBlocked(pos, r.target, obs);
      });
    const candidates: Adj[] = [];
    for (const lift of [0, 0.8]) {
      for (const yaw of [
        0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180,
      ]) {
        candidates.push({ yaw, lift });
      }
    }
    adj = candidates.find(clear) ?? NO_ADJ;
  }

  const pose = (t: number, u: number): { pos: Vec3; target: Vec3 } => {
    const r = rawPose(t, u, adj);
    return r.guard
      ? { pos: pushOut(r.pos, r.target, t), target: r.target }
      : { pos: r.pos, target: r.target };
  };

  /** A camera that stays put must be clear of everything for the whole shot (runners pass by). */
  const clearAllShot = (pos: Vec3, target: Vec3): Vec3 => {
    let out = pos;
    // Two sweeps: a later push can move it into something earlier in the shot.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i <= 12; i++)
        out = pushOut(out, target, shot.start + (span * i) / 12);
    }
    return out;
  };

  const key = (
    f: number,
    p: { pos: Vec3; target: Vec3 },
    ease: BlockoutEase,
  ): BlockoutCameraKey => ({
    id: nextId(),
    f,
    pos: p.pos.map(r3) as Vec3,
    target: p.target.map(r3) as Vec3,
    focal,
    roll: 0,
    ease,
  });

  if (cam.black || moveKind === "static" || lastF <= startF) {
    const tFrame = shot.start + span * 0.25;
    const p0 = pose(tFrame, 0);
    const fixedPos =
      cam.black || cam.pov ? p0.pos : clearAllShot(p0.pos, p0.target);
    return {
      keys: [key(startF, { pos: fixedPos, target: p0.target }, "hold")],
      focal,
    };
  }
  if (moveKind === "pan") {
    // Fixed position (mid-shot when converted from a locked-off shot, so the
    // subject passes by); aim follows the subject.
    const at0 = pose(panned ? shot.start + span / 2 : shot.start, 0);
    const fixed = cam.pov ? at0.pos : clearAllShot(at0.pos, at0.target);
    const keys: BlockoutCameraKey[] = [];
    const step = Math.max(1, Math.round(fps * 0.5));
    for (let f = startF; f < lastF; f += step) {
      keys.push(
        key(f, { pos: fixed, target: pose(f / fps, 0).target }, "linear"),
      );
    }
    keys.push(
      key(lastF, { pos: fixed, target: pose(lastF / fps, 0).target }, "hold"),
    );
    return { keys, focal };
  }
  // Moving cameras (follow / track / handheld / push / pull / crane / orbit):
  // keyed four times a second so jumps, swerves and orbits read, and each key
  // is kept clear of everything until the next key.
  const eased = [
    "push_in",
    "pull_out",
    "crane_up",
    "crane_down",
    "orbit",
  ].includes(cam.move);
  const step = Math.max(1, Math.round(fps * 0.25));
  const frames: number[] = [];
  for (let f = startF; f < lastF; f += step) frames.push(f);
  frames.push(lastF);
  const keys: BlockoutCameraKey[] = frames.map((f, i) => {
    const u = eased
      ? applyEase("inOut", (f - startF) / Math.max(1, lastF - startF))
      : 0;
    const p = pose(f / fps, u);
    let pos = p.pos;
    if (!cam.pov && !cam.black) {
      const t0 = f / fps;
      const t1 = (frames[i + 1] ?? f) / fps;
      for (let pass = 0; pass < 2; pass++) {
        for (const t of [t0, (t0 + t1) / 2, t1])
          pos = pushOut(pos, p.target, t);
      }
    }
    return key(
      f,
      { pos, target: p.target },
      i === frames.length - 1 ? "hold" : "linear",
    );
  });
  return { keys, focal };
}

/**
 * Final guarantee for a shot's camera: evaluate the actual (interpolated)
 * camera on every frame; wherever it is inside a body or set piece, add a key
 * there that backs it out along its line of sight (then up, if still boxed in).
 */
function enforceClear(
  keys: BlockoutCameraKey[],
  startF: number,
  lastF: number,
  fps: number,
  obstaclesAt: (t: number) => Obstacle[],
  nextId: () => string,
) {
  const out = (pos: Vec3, target: Vec3, obs: Obstacle[]): Vec3 => {
    const inside = (p: Vec3) => obs.some((o) => insideObstacle(p, o, 0.45));
    let dir: Vec3 = [
      pos[0] - target[0],
      pos[1] - target[1],
      pos[2] - target[2],
    ];
    const len = Math.hypot(...dir);
    dir = len < 1e-3 ? [0, 1, 0] : [dir[0] / len, dir[1] / len, dir[2] / len];
    let p = pos;
    for (let i = 0; i < 40 && inside(p); i++) {
      p = [
        p[0] + dir[0] * 0.2,
        Math.max(0.15, p[1] + dir[1] * 0.2),
        p[2] + dir[2] * 0.2,
      ];
    }
    for (let i = 0; i < 30 && inside(p); i++) p = [p[0], p[1] + 0.2, p[2]];
    return p;
  };
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let f = startF; f <= lastF; f++) {
      const c = camAt(keys, f);
      const obs = obstaclesAt(f / fps);
      // Margin covers the 3-frame key sampling of fast bodies.
      if (!obs.some((o) => insideObstacle(c.pos, o, 0.35))) continue;
      const pos = out(c.pos, c.target, obs);
      const at = keys.findIndex((k) => k.f === f);
      if (at >= 0) keys[at] = { ...keys[at]!, pos: pos.map(r3) as Vec3 };
      else {
        keys.push({
          id: nextId(),
          f,
          pos: pos.map(r3) as Vec3,
          target: c.target.map(r3) as Vec3,
          focal: c.focal,
          roll: 0,
          ease: f === lastF ? "hold" : "linear",
        });
        keys.sort((a, b) => a.f - b.f);
      }
      changed = true;
    }
    if (!changed) break;
  }
  // Only the shot's last key may hold (the cut); a single-key shot stays a hold.
  keys.forEach((k, i) => {
    if (keys.length > 1)
      k.ease =
        i === keys.length - 1 ? "hold" : k.ease === "hold" ? "linear" : k.ease;
  });
}

/** First cast member a SHOT line names (by name / id words or @image_N), excluding `not`. */
function namedInText(
  text: string,
  plan: StagingPlan,
  not?: string,
): string | undefined {
  let best: { i: number; id: string } | undefined;
  for (const c of plan.cast) {
    if (c.id === not) continue;
    const hits: number[] = [];
    if (c.imageN !== undefined) {
      const i = text.indexOf(`@image_${c.imageN}`);
      if (i >= 0) hits.push(i);
    }
    const words = `${c.name} ${c.id}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(
        (w) =>
          w.length > 2 &&
          !["the", "and", "giant", "old", "young", "big"].includes(w),
      );
    for (const w of words) {
      const i = text.search(new RegExp(`\\b${w}`));
      if (i >= 0) hits.push(i);
    }
    if (hits.length && (!best || Math.min(...hits) < best.i))
      best = { i: Math.min(...hits), id: c.id };
  }
  return best?.id;
}

/* ----------------------------------------------------------------- compile */

function sampleKeys(
  fn: (t: number) => Pose,
  fps: number,
  frames: number,
  step: number,
  extra: number[],
): BlockoutObjectKey[] {
  const set = new Set<number>();
  for (let f = 0; f <= frames; f += step) set.add(f);
  set.add(frames);
  for (const e of extra) if (e >= 0 && e <= frames) set.add(e);
  const keys: BlockoutObjectKey[] = [...set]
    .sort((a, b) => a - b)
    .map((f) => {
      const p = fn(f / fps);
      return {
        f,
        x: r3(p.x),
        y: r3(p.y),
        z: r3(p.z),
        rot: Math.round(p.rot * 10) / 10,
        ease: "linear" as const,
      };
    });
  if (keys.length < 3) return keys;
  const out = [keys[0]!];
  for (let i = 1; i < keys.length - 1; i++) {
    const [a, b, c] = [keys[i - 1]!, keys[i]!, keys[i + 1]!];
    const same = (["x", "y", "z", "rot"] as const).every(
      (k) =>
        Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 1e-3 &&
        Math.abs((b[k] ?? 0) - (c[k] ?? 0)) < 1e-3,
    );
    if (!same) out.push(b);
  }
  out.push(keys[keys.length - 1]!);
  return out;
}

export function compileStagingPlan(
  plan: StagingPlan,
  script: ScriptPromptData,
  project: BlockoutProject,
  opts: CompileStagingOpts = {},
): BlockoutDocument {
  return compileStagingPlanWithInfo(plan, script, project, opts).document;
}

export type StagingCompileInfo = {
  document: BlockoutDocument;
  /** rider cast id → intervals on a mount (for the audit). */
  riding: Map<string, RidingInterval[]>;
};

export function compileStagingPlanWithInfo(
  planIn: StagingPlan,
  script: ScriptPromptData,
  project: BlockoutProject,
  opts: CompileStagingOpts = {},
): StagingCompileInfo {
  // Work on a copy: gaps / leaps get aligned below.
  const plan: StagingPlan = JSON.parse(JSON.stringify(planIn));
  sanitizeFeatures(plan);
  plan.set.features.forEach((f, i) => {
    if ((f.kind === "river" || f.kind === "chasm") && !f.id) f.id = `gap-${i}`;
  });
  const fps = project.fps;
  const scriptShots = [...script.shots].sort((a, b) => a.startSec - b.startSec);
  const planByN = new Map(plan.shots.map((s) => [s.n, s] as const));
  // Script timings are authoritative; plan shots are matched by number (or order).
  const timings: ShotTiming[] = scriptShots.length
    ? scriptShots.map((s) => ({
        n: s.n,
        start: s.startSec,
        end: s.endSec,
        desc: s.action,
        shotType: s.shotType,
        cameraMove: s.cameraMove,
      }))
    : plan.shots.map((s, i) => ({
        n: s.n,
        start: i * 3,
        end: i * 3 + 3,
        desc: "",
        shotType: "",
      }));
  const totalSec = Math.max(
    script.totalDurationSec || 0,
    timings[timings.length - 1]?.end ?? 6,
  );
  const frames = Math.max(1, Math.round(totalSec * fps));
  const planFor = (i: number) => planByN.get(timings[i]!.n) ?? plan.shots[i];

  // Absolute move times per cast member (follow moves resolve against their target)
  const movesBy = new Map<string, TimedMove[]>();
  const followBy = new Map<string, TimedMove[]>();
  timings.forEach((tm, i) => {
    const ps = planFor(i);
    if (!ps) return;
    const span = tm.end - tm.start;
    for (const m of ps.moves) {
      const into = m.follow && m.follow !== m.who ? followBy : movesBy;
      const list = into.get(m.who) ?? [];
      const f0 = clamp(m.from ?? 0, 0, 1);
      const f1 = clamp(m.to ?? 1, f0, 1);
      list.push({
        t0: tm.start + f0 * span,
        t1: tm.start + f1 * span,
        move: m,
      });
      into.set(m.who, list);
    }
  });

  const castById = new Map(plan.cast.map((c) => [c.id, c] as const));
  const featureById = new Map(
    plan.set.features.filter((f) => f.id).map((f) => [f.id!, f] as const),
  );
  const stand = new Map(plan.cast.map((c) => [c.id, standInFor(c)] as const));
  const shotEnds = timings.map((tm) => tm.end);

  // Rivers / chasms, then line them up with the leaps that cross them.
  const gaps: Gap[] = plan.set.features
    .filter((f) => f.kind === "river" || f.kind === "chasm")
    .map((f) => {
      const w =
        (f.size as Vec3 | undefined)?.[0] ?? (f.kind === "river" ? 8 : 15);
      return {
        id: f.id!,
        x0: f.at[0],
        x1: f.at[0] + w,
        kind: f.kind as "river" | "chasm",
        depth:
          (f.size as Vec3 | undefined)?.[1] ?? (f.kind === "river" ? 2.5 : 30),
      };
    });
  const inGap = alignLeapsToGaps(
    plan,
    movesBy,
    gaps,
    stand,
    shotEnds,
    totalSec,
  );

  // Ground timelines first (riders / carried props resolve on top of them).
  const ground = new Map<string, (t: number) => Pose>();
  const poseCache = new Map<string, Map<number, Pose>>();
  const resolving = new Set<string>();
  // Poses computed while a cycle guard kicked in are provisional: never cached.
  let guardHits = 0;
  const facePoint = (id: string, t: number): Vec2 | null => {
    if (castById.has(id)) {
      if (resolving.has(id)) {
        guardHits++;
        return null;
      }
      const p = poseAt(id, t);
      return [p.x, p.z];
    }
    const f = featureById.get(id);
    return f ? [f.at[0], f.at[1]] : null;
  };
  const groundAt = (id: string): ((t: number) => Pose) => {
    let fn = ground.get(id);
    if (!fn) {
      const c = castById.get(id)!;
      const s = stand.get(id)!;
      const h = bodyHeight(c, s.size);
      const list = [...(movesBy.get(id) ?? [])];
      const build = () =>
        castTimeline(c, h, list, facePoint, {
          gaps,
          shotEnds,
          duration: totalSec,
        });
      fn = build();
      ground.set(id, fn);
      // After each follow, later moves start from where the follow left them
      // (and still go to their own destinations).
      for (const f of [...(followBy.get(id) ?? [])].sort(
        (a, b) => a.t0 - b.t0,
      )) {
        const end = followPose(id, f, f.t1, fn(f.t1));
        list.push({
          t0: f.t1,
          t1: f.t1 + 1 / 48,
          move: {
            who: id,
            action: "stand",
            start: [end.x, end.z],
            face: end.rot,
          },
        });
        fn = build();
        ground.set(id, fn);
      }
    }
    return fn;
  };
  // Resolved after the ground timelines exist; poses cached before then are dropped.
  let riding = new Map<string, RidingInterval[]>();
  // Climbing on takes longer when the mount is further off / already moving.
  const blendCache = new Map<RidingInterval, number>();
  const blendDur = (id: string, iv: RidingInterval): number => {
    let d = blendCache.get(iv);
    if (d === undefined) {
      const g = groundAt(id)(iv.from);
      const m = groundAt(iv.mount)(iv.from);
      d = clamp(Math.hypot(g.x - m.x, g.z - m.z) / 6, 0.4, 2);
      blendCache.set(iv, d);
    }
    return d;
  };
  const ridingAt = (id: string, t: number) =>
    (riding.get(id) ?? []).find(
      (iv) => t > iv.from - blendDur(id, iv) && t < iv.to,
    );
  const lastDismount = (id: string, t: number) =>
    (riding.get(id) ?? [])
      .filter((iv) => iv.to <= t)
      .sort((a, b) => b.to - a.to)[0];

  const visibleAt = (c: StagingCast, t: number) =>
    !c.visible ||
    c.visible.length === 0 ||
    c.visible.some(([a, b]) => t >= a - 1e-3 && t <= b + 1e-3);

  function poseAt(id: string, t: number): Pose {
    const key = Math.round(t * 1000);
    const cache = poseCache.get(id) ?? new Map<number, Pose>();
    poseCache.set(id, cache);
    const hit = cache.get(key);
    if (hit) return hit;
    if (resolving.has(id)) {
      guardHits++;
      return groundAt(id)(t);
    }
    const guards0 = guardHits;
    resolving.add(id);
    const c = castById.get(id)!;
    let p = groundAt(id)(t);
    // Moving relative to someone else (alongside / behind / ahead).
    const fol = followBy.get(id) ?? [];
    const activeF = fol.find((f) => t >= f.t0 && t <= f.t1);
    if (activeF) p = followPose(id, activeF, t, p);
    // After getting off, carry on from beside the mount (not the old spot).
    const off = lastDismount(id, t);
    if (off && off.to > 0) {
      const m = poseAt(off.mount, off.to);
      const [rx, rz] = fwd(m.rot - 90);
      const g = groundAt(id)(off.to);
      p = {
        ...p,
        x: p.x + (m.x + rx * 1.2 - g.x),
        z: p.z + (m.z + rz * 1.2 - g.z),
      };
    }
    const iv = ridingAt(id, t);
    if (iv) {
      const from = iv.from;
      const mount = castById.get(iv.mount)!;
      const ms = stand.get(iv.mount)!;
      const seat = seatHeight(mount.kind, ms.size);
      const m = poseAt(iv.mount, t);
      const riding: Pose = {
        x: m.x,
        y: m.y + seat,
        z: m.z,
        rot: m.rot + riderLook(id, t, m),
      };
      if (t >= from) p = riding;
      else {
        const dur = blendDur(id, iv);
        const u = (t - (from - dur)) / dur;
        p = {
          x: lerp(p.x, riding.x, u),
          y:
            lerp(p.y, riding.y, Math.sin((u * Math.PI) / 2)) +
            0.3 * Math.sin(u * Math.PI),
          z: lerp(p.z, riding.z, u),
          rot: lerp(p.rot, riding.rot, u),
        };
      }
    }
    if (c.carriedBy && castById.has(c.carriedBy)) {
      const holder = castById.get(c.carriedBy)!;
      const hs = stand.get(c.carriedBy)!;
      const hp = poseAt(c.carriedBy, t);
      p = carriedPose(hp, bodyHeight(holder, hs.size), carryStyleAt(c, t));
    }
    if (!visibleAt(c, t)) p = { ...p, y: HIDE };
    resolving.delete(id);
    if (guardHits === guards0) cache.set(key, p);
    return p;
  }

  /** Pose while following: target pose + [ahead, left] offset, eased in over the first 40%. */
  function followPose(id: string, f: TimedMove, t: number, from: Pose): Pose {
    const target = f.move.follow!;
    if (resolving.has(target)) {
      guardHits++;
      return from;
    }
    const q = poseAt(target, t);
    const [along, lat] = (f.move.offset as [number, number] | undefined) ?? [
      -3, 0,
    ];
    const [fx, fz] = fwd(q.rot);
    const [lx, lz] = fwd(q.rot + 90);
    const want: Pose = {
      x: q.x + fx * along + lx * lat,
      y: 0,
      z: q.z + fz * along + lz * lat,
      rot: q.rot,
    };
    const start = f.t0 < t ? groundAt(id)(f.t0) : from;
    // Close the distance at a believable top speed (≤ 15 m/s), never teleport.
    const q0 = poseAt(target, f.t0);
    const [f0x, f0z] = fwd(q0.rot);
    const [l0x, l0z] = fwd(q0.rot + 90);
    const gap0 = Math.hypot(
      q0.x + f0x * along + l0x * lat - start.x,
      q0.z + f0z * along + l0z * lat - start.z,
    );
    const catchUp = Math.max(0.2, (f.t1 - f.t0) * 0.4, gap0 / 15);
    const u = applyEase("inOut", clamp((t - f.t0) / catchUp, 0, 1));
    const c = castById.get(id)!;
    const moving =
      Math.hypot(
        poseAt(target, t + 0.05).x - q.x,
        poseAt(target, t + 0.05).z - q.z,
      ) > 0.05;
    const amp =
      c.kind === "quadruped"
        ? 0.22
        : c.kind === "person" || c.kind === "creature"
          ? 0.06
          : 0;
    return {
      x: lerp(start.x, want.x, u),
      y: moving ? amp * Math.abs(Math.sin((Math.PI * t) / 0.36)) : 0,
      z: lerp(start.z, want.z, u),
      rot: u < 1 ? shortestTo(start.rot, want.rot) : want.rot,
    };
  }

  /**
   * A rider's head / body turn on top of the mount's heading: their own look /
   * turn / fire moves with a "face" target, else the script's own "glances back /
   * left / right / twists round" beats.
   */
  const scriptLooks = lookOffsetKeys(script.shots);
  function riderLook(id: string, t: number, mount: Pose): number {
    const looks = (movesBy.get(id) ?? []).filter(
      (m) =>
        m.move.face !== undefined &&
        ["look", "turn", "fire", "fight", "reach", "idle"].includes(
          m.move.action,
        ),
    );
    const cur = looks.find((m) => t >= m.t0 - 0.05 && t <= m.t1 + 0.3);
    if (cur) {
      let want: number;
      if (typeof cur.move.face === "number") want = cur.move.face;
      else {
        const pt = facePoint(cur.move.face!, t);
        want = pt
          ? headingDeg(pt[0] - mount.x, pt[1] - mount.z, mount.rot)
          : mount.rot;
      }
      const off = clamp(shortestTo(0, want - mount.rot), -170, 170);
      const inU = clamp((t - cur.t0) / 0.25, 0, 1);
      const outU = clamp((t - cur.t1) / 0.3, 0, 1);
      return off * applyEase("inOut", inU) * (1 - applyEase("inOut", outU));
    }
    return lookAtKeys(scriptLooks, t);
  }

  function carryStyleAt(c: StagingCast, t: number): CarryStyle {
    const changes = (movesBy.get(c.id) ?? []).filter(
      (m) => m.move.carry && m.t0 <= t,
    );
    return (
      changes.sort((a, b) => b.t0 - a.t0)[0]?.move.carry ?? c.carry ?? "hand"
    );
  }

  riding = resolveRiding(
    plan,
    script,
    movesBy,
    (id, t) => groundAt(id)(t),
    totalSec,
  );
  poseCache.clear();

  // Objects for cast
  const cutFrames = timings.flatMap((tm) => [
    Math.round(tm.start * fps) - 1,
    Math.round(tm.start * fps),
  ]);
  const castObjects: BlockoutObject[] = plan.cast.map((c, i) => {
    const s = stand.get(c.id)!;
    const visEdges = (c.visible ?? []).flatMap(([a, b]) => [
      Math.round(a * fps) - 1,
      Math.round(a * fps),
      Math.round(b * fps),
      Math.round(b * fps) + 1,
    ]);
    const keys = sampleKeys((t) => poseAt(c.id, t), fps, frames, 3, [
      ...cutFrames,
      ...visEdges,
    ]);
    const k0 = keys[0]!;
    return {
      id: `cast-${c.id}`,
      type: s.type,
      name: c.name,
      color: c.color ?? CAST_COLORS[i % CAST_COLORS.length]!,
      size: s.size,
      pos: [k0.x, k0.z] as Vec2,
      y: k0.y,
      rot: k0.rot,
      keys,
      label: c.kind !== "prop" && c.kind !== "bird",
    };
  });

  // Set, kept clear of everyone's paths
  const avoid: Vec2[] = [];
  const moving: Vec2[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const setStep = Math.max(1, Math.round(fps / 4));
  for (const c of plan.cast) {
    for (let f = 0; f <= frames; f += setStep) {
      const p = poseAt(c.id, f / fps);
      if (p.y < HIDE + 1) continue;
      avoid.push([p.x, p.z]);
      const q = poseAt(c.id, Math.min(totalSec, (f + setStep) / fps));
      if (
        c.kind !== "prop" &&
        c.kind !== "bird" &&
        Math.hypot(q.x - p.x, q.z - p.z) > (setStep / fps) * 1
      ) {
        moving.push([p.x, p.z], [(p.x + q.x) / 2, (p.z + q.z) / 2]);
      }
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  for (const f of plan.set.features) {
    if (f.kind === "sun" || f.kind === "moon") continue;
    minX = Math.min(minX, f.at[0]);
    maxX = Math.max(maxX, f.at[0]);
    minZ = Math.min(minZ, f.at[1]);
    maxZ = Math.max(maxZ, f.at[1]);
  }
  if (!Number.isFinite(minX)) [minX, maxX, minZ, maxZ] = [-10, 10, -10, 10];
  const seed = hashSeed(
    `${opts.sequenceTitle ?? project.title}|${JSON.stringify(plan.set)}`,
  );
  const setObjects = buildSet(
    plan,
    { minX, maxX, minZ, maxZ },
    avoid,
    mulberry32(seed),
    moving,
    inGap,
  );

  // Cameras
  const subjectOf = (id: string | undefined): Subject | null => {
    if (!id) return null;
    const c = castById.get(id);
    if (c) {
      const s = stand.get(id)!;
      const h = bodyHeight(c, s.size);
      const long =
        c.kind === "quadruped" || c.kind === "vehicle" || c.kind === "creature";
      return {
        at: (t) => poseAt(id, t),
        h,
        eye: h * 0.93,
        frame: long ? Math.max(h, s.size[2] * 0.75) : h,
        id,
      };
    }
    const f = featureById.get(id);
    if (f) {
      const size = f.size as Vec3 | undefined;
      const h = size?.[1] ?? 1.5;
      const p: Pose = { x: f.at[0], y: 0, z: f.at[1], rot: 90 };
      return {
        at: () => p,
        h,
        eye: h,
        frame: Math.max(h, (size?.[0] ?? 1) * 0.8, (size?.[2] ?? 1) * 0.8),
      };
    }
    return null;
  };

  const bodyObjects = castObjects.filter((o) => {
    const c = castById.get(o.id.replace(/^cast-/, ""));
    return c && c.kind !== "prop" && c.kind !== "bird";
  });
  const sampledBodies = (f: number): Obstacle[] =>
    bodyObjects
      .map((o) => {
        const p = objAt(o, f);
        const h = o.type === "hare" ? o.size[1] * 0.55 : o.size[1];
        return {
          id: o.id,
          x: p.x,
          y: p.y,
          z: p.z,
          rot: p.rot,
          w: o.size[0],
          h,
          d: o.size[2],
        };
      })
      .filter((o) => o.y > HIDE + 1);

  // Solids the camera must stay out of / see past: cast bodies over time + set pieces.
  const SOLID_SET = new Set([
    "box",
    "wall",
    "door",
    "column",
    "car",
    "table",
    "chair",
    "tree",
  ]);
  const setObstacles: Obstacle[] = setObjects
    .filter(
      (o) => SOLID_SET.has(o.type) && o.name !== "Ground" && (o.y ?? 0) > -5,
    )
    .map((o) =>
      o.type === "tree"
        ? {
            id: o.id,
            x: o.pos[0],
            y: 0,
            z: o.pos[1],
            rot: 0,
            w: o.size[0],
            h: o.size[1] * 0.6,
            d: o.size[0],
          }
        : {
            id: o.id,
            x: o.pos[0],
            y: o.y ?? 0,
            z: o.pos[1],
            rot: o.rot ?? 0,
            w: o.size[0],
            h: o.size[1],
            d: o.size[2],
          },
    );
  const castObstacles = (t: number, except: Set<string>): Obstacle[] =>
    plan.cast
      .filter(
        (c) => c.kind !== "prop" && c.kind !== "bird" && !except.has(c.id),
      )
      .map((c) => {
        const p = poseAt(c.id, t);
        const sz = stand.get(c.id)!.size;
        // Four-legged stand-ins: the solid part is the body (neck / ears stick up at the front).
        const h = c.kind === "quadruped" ? sz[1] * 0.55 : sz[1];
        return {
          id: c.id,
          x: p.x,
          y: p.y,
          z: p.z,
          rot: p.rot,
          w: sz[0],
          h,
          d: sz[2],
        };
      })
      .filter((o) => o.y > HIDE + 1);
  const firstVisible =
    plan.cast.find((c) => c.kind !== "prop") ?? plan.cast[0]!;
  const fallback = subjectOf(firstVisible.id)!;
  let keyN = 0;
  const nextId = () => `k${++keyN}`;
  const byN = new Map(
    (opts.liveShots ?? []).map((s) => [s.n ?? 0, s] as const),
  );
  const cameraKeys: BlockoutCameraKey[] = [];
  const cuts: BlockoutCutMarker[] = [];
  timings.forEach((tm, i) => {
    const ps = planFor(i);
    const cam: StagingCamera = {
      ...(ps?.camera ?? {
        size: "medium",
        angle: "eye",
        side: "front_left",
        move: "static",
      }),
    };
    const text = `${tm.shotType} ${tm.desc}`.toLowerCase();

    // Cut to black: at the start of the line = the whole shot is black; at the
    // end ("…rides off. Hard cut to black on the final beat") = only the tail.
    const blackAt = tm.desc
      .toLowerCase()
      .search(/\b(hard\s+)?(cut|fade)s?\s+(out\s+)?to\s+black\b/);
    const blackFirst =
      blackAt >= 0 && blackAt <= Math.max(8, tm.desc.length * 0.15);
    if (blackAt >= 0 && blackFirst) cam.black = true;
    let blackTail = Boolean(cam.blackAtEnd);
    if (blackAt >= 0 && !blackFirst) {
      cam.black = false;
      blackTail = true;
    }

    // No (usable) subject: frame whoever the script line names, not cast[0].
    if (!cam.black && !cam.subject)
      cam.subject = namedInText(text, plan, cam.pov);

    // Close framings aim at the body part the line is about.
    const close = ["ecu", "cu", "mcu", "insert"].includes(cam.size);
    const aimFrac = !close
      ? undefined
      : /\bhoo(f|ves)\b|\bfeet\b|\bfoot\b|\bpaws?\b|\bclaws?\b|\blegs?\b|\bboots?\b|\btail\b|\bsprings?\b/.test(
            text,
          )
        ? 0.15
        : /\bhands?\b|\bpalm\b|\bfingers\b|\bpouch\b|\bsatchel\b|\bchest\b|\bbelt\b|\bholster\b/.test(
              text,
            )
          ? 0.58
          : /\bface\b|\beyes?\b|\bgaze\b|\bexpression\b|\bhead\b|\bears\b|\bsmile\b/.test(
                text,
              )
            ? 0.92
            : undefined;

    // "from" the subject itself would put the camera inside them.
    const fromSpec = cam.from === cam.subject ? undefined : cam.from;
    const from =
      fromSpec === undefined
        ? undefined
        : (t: number): Vec3 | null => {
            if (Array.isArray(fromSpec)) return [fromSpec[0], 1.6, fromSpec[1]];
            const sub = subjectOf(fromSpec);
            if (!sub) return null;
            const p = sub.at(t);
            return [p.x, p.y + sub.eye, p.z];
          };

    const fromCast =
      typeof fromSpec === "string" ? castById.get(fromSpec) : undefined;
    const fromBack = fromCast
      ? Math.max(
          1,
          Math.max(
            stand.get(fromCast.id)!.size[0],
            stand.get(fromCast.id)!.size[2],
          ) /
            2 +
            0.8,
        )
      : 1;
    const shotTm = blackTail
      ? { ...tm, end: Math.max(tm.start + 0.1, tm.end - 0.3) }
      : tm;
    const { keys, focal } = cameraKeysForShot(
      shotTm,
      cam,
      subjectOf,
      fallback,
      fps,
      nextId,
      {
        aimFrac,
        from,
        fromBack,
        // A point of view looks out from inside its own body; ignore just that body.
        obstacles: (t) => [
          ...castObstacles(t, new Set(cam.pov ? [cam.pov] : [])),
          ...setObstacles,
        ],
      },
    );
    if (!cam.black && !cam.pov) {
      // Check against the saved keys (what the player shows), not exact poses.
      const obstaclesAt = (t: number) => [
        ...sampledBodies(t * fps),
        ...setObstacles,
      ];
      enforceClear(
        keys,
        Math.round(shotTm.start * fps),
        Math.max(
          Math.round(shotTm.start * fps),
          Math.round(shotTm.end * fps) - 1,
        ),
        fps,
        obstaclesAt,
        nextId,
      );
    }
    cameraKeys.push(...keys);
    if (blackTail) {
      const S = subjectOf(cam.subject) ?? fallback;
      const p = S.at(shotTm.end);
      cameraKeys.push({
        id: nextId(),
        f: Math.max(
          Math.round(shotTm.end * fps),
          (keys[keys.length - 1]?.f ?? 0) + 1,
        ),
        pos: [r3(p.x), 80, r3(p.z)],
        target: [r3(p.x), 90, r3(p.z)],
        focal,
        roll: 0,
        ease: "hold",
      });
    }
    const live = byN.get(tm.n);
    cuts.push({
      n: tm.n,
      start: Math.round(tm.start * fps),
      end: Math.max(Math.round(tm.start * fps) + 1, Math.round(tm.end * fps)),
      desc: tm.desc,
      shotType: tm.shotType,
      shotId: live?.id,
      sceneHeading: live?.sceneHeading,
      cameraMove: tm.cameraMove,
      lensMm: focal,
    });
  });

  let doc: BlockoutDocument = {
    schema: BLOCKOUT_SCHEMA_ID,
    version: 1,
    project,
    sequenceId: opts.sequenceId,
    name: opts.sequenceTitle ?? project.title,
    title: opts.sequenceTitle ?? project.title,
    fps,
    frames,
    aspect: project.aspectRatio,
    camera: { sensor: 36, keys: cameraKeys },
    objects: [...castObjects, ...setObjects],
    env: { sky: skyFor(plan.set.timeOfDay), ground: false, fog: false },
    shots: cuts,
    notes:
      "Staged from a cinakey.staging/1.0 plan. Hard cuts are camera keys with ease hold.",
  };
  if (opts.existing && opts.keepShotIds && opts.keepShotIds.size > 0) {
    doc = mergeKeptRanges(doc, opts.existing, opts.keepShotIds);
  }
  return { document: doc, riding };
}
