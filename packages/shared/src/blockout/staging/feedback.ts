/**
 * Learning signals for the staging director.
 *
 * - `diffBlockoutEdits`: what a user changed in the 3D editor compared with the
 *   compiled blockout, as structured corrections per shot (camera moved /
 *   re-aimed / lens, cast moved, pieces added / removed / moved, timing).
 * - `buildAuditRepairMessage`: turns the automatic check's findings into one
 *   concrete repair request for the model.
 */

import { camAt, objAt } from "../engine";
import type { BlockoutDocument, BlockoutObject, Vec3 } from "../types";
import type { StagingIssue } from "./audit";
import type { StagingPlan } from "./schema";

export const CORRECTION_KINDS = [
  "camera_moved",
  "camera_reaimed",
  "lens_changed",
  "cast_moved",
  "cast_added",
  "cast_removed",
  "set_added",
  "set_removed",
  "set_moved",
  "shot_timing",
] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export type StagingCorrection = {
  /** Shot number, or null for part-wide changes (set pieces). */
  shot: number | null;
  kind: CorrectionKind;
  /** Object name for cast / set corrections. */
  target?: string;
  /** Metres (moves), degrees (re-aim), mm (lens) or frames (timing). */
  amount?: number;
};

const MAX_CORRECTIONS = 60;
const isCast = (o: BlockoutObject) =>
  o.id.startsWith("cast-") || o.keys.length > 0;
const round1 = (v: number) => Math.round(v * 10) / 10;

function angleBetween(a: Vec3, b: Vec3): number {
  const la = Math.hypot(...a) || 1;
  const lb = Math.hypot(...b) || 1;
  const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Structured corrections between the compiled blockout and the user's edited one. */
export function diffBlockoutEdits(
  before: BlockoutDocument,
  after: BlockoutDocument,
): StagingCorrection[] {
  const out: StagingCorrection[] = [];
  const push = (c: StagingCorrection) => {
    if (out.length < MAX_CORRECTIONS) out.push(c);
  };

  const afterCuts = new Map(after.shots.map((s) => [s.n, s] as const));
  for (const cut of before.shots) {
    const a = afterCuts.get(cut.n);
    if (a && (a.start !== cut.start || a.end !== cut.end)) {
      push({
        shot: cut.n,
        kind: "shot_timing",
        amount: a.end - a.start - (cut.end - cut.start),
      });
    }
  }

  // Camera, per shot (sampled at the start, middle and end of each cut)
  for (const cut of before.shots) {
    const frames = [
      cut.start + 1,
      Math.round((cut.start + cut.end) / 2),
      Math.max(cut.start, cut.end - 2),
    ];
    let moved = 0;
    let reaim = 0;
    let lens = 0;
    for (const f of frames) {
      const b = camAt(before.camera.keys, f);
      const e = camAt(after.camera.keys, f);
      moved = Math.max(
        moved,
        Math.hypot(
          e.pos[0] - b.pos[0],
          e.pos[1] - b.pos[1],
          e.pos[2] - b.pos[2],
        ),
      );
      const db: Vec3 = [
        b.target[0] - b.pos[0],
        b.target[1] - b.pos[1],
        b.target[2] - b.pos[2],
      ];
      const de: Vec3 = [
        e.target[0] - e.pos[0],
        e.target[1] - e.pos[1],
        e.target[2] - e.pos[2],
      ];
      reaim = Math.max(reaim, angleBetween(db, de));
      lens = Math.max(lens, Math.abs(e.focal - b.focal));
    }
    if (moved > 0.5)
      push({ shot: cut.n, kind: "camera_moved", amount: round1(moved) });
    if (reaim > 5)
      push({ shot: cut.n, kind: "camera_reaimed", amount: Math.round(reaim) });
    if (lens > 2)
      push({ shot: cut.n, kind: "lens_changed", amount: Math.round(lens) });
  }

  // Objects
  const beforeById = new Map(before.objects.map((o) => [o.id, o] as const));
  const afterById = new Map(after.objects.map((o) => [o.id, o] as const));
  for (const o of after.objects) {
    if (!beforeById.has(o.id) && o.type !== "light") {
      push({
        shot: null,
        kind: isCast(o) ? "cast_added" : "set_added",
        target: o.name,
      });
    }
  }
  for (const o of before.objects) {
    const e = afterById.get(o.id);
    if (!e) {
      if (o.type !== "light")
        push({
          shot: null,
          kind: isCast(o) ? "cast_removed" : "set_removed",
          target: o.name,
        });
      continue;
    }
    if (o.type === "light") continue;
    if (isCast(o)) {
      for (const cut of before.shots) {
        const f = Math.round((cut.start + cut.end) / 2);
        const pb = objAt(o, f);
        const pe = objAt(e, f);
        if (pb.y < -20 && pe.y < -20) continue;
        const d = Math.hypot(pe.x - pb.x, pe.y - pb.y, pe.z - pb.z);
        if (d > 0.75)
          push({
            shot: cut.n,
            kind: "cast_moved",
            target: o.name,
            amount: round1(d),
          });
      }
    } else {
      const d = Math.hypot(
        e.pos[0] - o.pos[0],
        (e.y ?? 0) - (o.y ?? 0),
        e.pos[1] - o.pos[1],
      );
      if (d > 0.5)
        push({
          shot: null,
          kind: "set_moved",
          target: o.name,
          amount: round1(d),
        });
    }
  }
  return out;
}

function hintFor(problem: string): string {
  if (/out of frame|behind camera/.test(problem)) {
    return 'the camera does not see them — choose a side that faces them, a wider size, move "follow", or fix their path / subject';
  }
  if (/camera inside/.test(problem)) {
    return "the camera is inside a set piece — choose another side / from, or move that piece off the camera";
  }
  if (/below ground/.test(problem))
    return "raise the camera (angle eye / high)";
  if (/hidden while framed/.test(problem))
    return 'they are not visible at that time — check "visible" or frame someone else';
  if (/is not on/.test(problem)) {
    return 'the rider is not on the mount — set "rides" + "ridesFrom" or add a "mount" move with "target"';
  }
  return "fix the staging so this reads correctly";
}

/**
 * One repair request for the model: each faulty shot with its problems, a
 * concrete hint, and that shot's current camera + moves.
 */
export function buildAuditRepairMessage(
  issues: StagingIssue[],
  plan: StagingPlan,
): { role: "user"; content: string } {
  const byShot = new Map<number, Set<string>>();
  for (const i of issues) {
    const set = byShot.get(i.shot) ?? new Set<string>();
    set.add(i.problem);
    byShot.set(i.shot, set);
  }
  const planByN = new Map(plan.shots.map((s) => [s.n, s] as const));
  const lines = [...byShot.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, 12)
    .map(([n, problems]) => {
      const s = planByN.get(n);
      const current = s
        ? ` Current: ${JSON.stringify({ camera: s.camera, moves: s.moves })}`
        : "";
      return `- Shot ${n}: ${[...problems].map((p) => `${p} (${hintFor(p)})`).join("; ")}.${current}`;
    });
  return {
    role: "user",
    content: `I built this plan and checked every shot. These need fixing:\n${lines.join("\n")}\nReturn the corrected full JSON object only. Keep everything that is not listed unchanged.`,
  };
}
