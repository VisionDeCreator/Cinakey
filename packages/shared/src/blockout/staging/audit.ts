/**
 * Script-agnostic quality checks for a compiled staging plan:
 * is each shot's subject actually in frame, is the camera above ground and
 * outside solid set pieces, is the subject visible when framed.
 */

import { camAt, objAt } from "../engine";
import type { BlockoutDocument, BlockoutObject, Vec3 } from "../types";
import { insideObstacle, sightBlocked, type Obstacle } from "./compile";
import type { RidingInterval } from "./riding";
import type { StagingPlan } from "./schema";

export type StagingIssue = { shot: number; frame: number; problem: string };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function aspectOf(doc: BlockoutDocument) {
  const [w, h] = String(doc.aspect ?? "16:9")
    .split(":")
    .map(Number);
  return w && h ? w / h : 16 / 9;
}

/** Point inside a solid (box / wall / building / trunk) stand-in? Same box convention as the renderer. */
function insideSolid(p: Vec3, o: BlockoutObject): boolean {
  if (
    !["box", "wall", "door", "column", "car", "table", "tree"].includes(o.type)
  )
    return false;
  if (o.keys.length > 0) return false;
  const [w, h, d] = o.size;
  if (o.type === "tree") {
    return (
      Math.hypot(p[0] - o.pos[0], p[2] - o.pos[1]) < w / 2 + 0.1 &&
      p[1] < h * 0.6
    );
  }
  return insideObstacle(
    p,
    {
      id: o.id,
      x: o.pos[0],
      y: o.y ?? 0,
      z: o.pos[1],
      rot: o.rot ?? 0,
      w,
      h,
      d,
    },
    0,
  );
}

const nameOf = (doc: BlockoutDocument, id: string) =>
  doc.objects.find((o) => o.id === id)?.name ?? id;

/** Cast stand-ins as boxes at frame f (props / birds and a POV's own body excluded). */
function castBodies(
  doc: BlockoutDocument,
  plan: StagingPlan,
  f: number,
  pov?: string,
): Obstacle[] {
  const small = new Set(
    plan.cast
      .filter((c) => c.kind === "prop" || c.kind === "bird")
      .map((c) => `cast-${c.id}`),
  );
  return doc.objects
    .filter(
      (o) =>
        o.id.startsWith("cast-") && !small.has(o.id) && o.id !== `cast-${pov}`,
    )
    .map((o) => {
      const p = objAt(o, f);
      const h = o.type === "hare" ? o.size[1] * 0.55 : o.size[1]; // body, not neck / ears
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
    .filter((o) => o.y > -20);
}

export function auditStagedDocument(
  plan: StagingPlan,
  doc: BlockoutDocument,
  riding?: Map<string, RidingInterval[]>,
): StagingIssue[] {
  const issues: StagingIssue[] = [];
  // Riders stay on their mounts while riding.
  for (const [riderId, ivs] of riding ?? []) {
    const rider = doc.objects.find((o) => o.id === `cast-${riderId}`);
    for (const iv of ivs) {
      const mount = doc.objects.find((o) => o.id === `cast-${iv.mount}`);
      if (!rider || !mount) continue;
      const f0 = Math.round((iv.from + 0.1) * doc.fps);
      const f1 = Math.min(doc.frames, Math.round(iv.to * doc.fps) - 1);
      for (let f = f0; f <= f1; f += Math.round(doc.fps / 2)) {
        const a = objAt(rider, f);
        const b = objAt(mount, f);
        if (a.y < -20 || b.y < -20) continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) > 0.6 || a.y < b.y) {
          const cut = doc.shots.find((c) => f >= c.start && f < c.end);
          issues.push({
            shot: cut?.n ?? 0,
            frame: f,
            problem: `${rider.name} is not on ${mount.name}`,
          });
          break;
        }
      }
    }
  }
  const aspect = aspectOf(doc);
  const solids = doc.objects.filter(
    (o) => !o.id.startsWith("cast-") && o.name !== "Ground",
  );
  const planByN = new Map(plan.shots.map((s) => [s.n, s] as const));
  for (const o of solids) {
    if (
      !["box", "wall", "column", "door", "car", "table", "chair"].includes(
        o.type,
      ) ||
      (o.y ?? 0) < -1
    )
      continue;
    if (o.size[1] > 15 && !/building|tower|cliff|mountain|wall/i.test(o.name)) {
      issues.push({
        shot: 0,
        frame: 0,
        problem: `set piece ${o.name} is ${Math.round(o.size[1])} m tall`,
      });
    }
  }
  for (const cut of doc.shots) {
    const cam = planByN.get(cut.n)?.camera;
    if (!cam || cam.black) continue;
    const frames = [
      cut.start + 1,
      Math.round((cut.start + cut.end) / 2),
      Math.max(cut.start, cut.end - 2),
    ];
    for (const f of frames) {
      const c = camAt(doc.camera.keys, f);
      if (c.pos[1] < 0.05)
        issues.push({ shot: cut.n, frame: f, problem: "camera below ground" });
      // Inside a character / animal / vehicle, or looking through one.
      const bodies = castBodies(doc, plan, f, cam.pov);
      const inBody = bodies.find((o) => insideObstacle(c.pos as Vec3, o, 0.1));
      if (inBody) {
        issues.push({
          shot: cut.n,
          frame: f,
          problem: `camera inside ${nameOf(doc, inBody.id)}`,
        });
      } else if (
        !["wide", "ews"].includes(cam.size) &&
        cam.angle !== "overhead" &&
        !cam.pov
      ) {
        const skip = new Set(
          [cam.subject, cam.subject2].filter(Boolean).map((id) => `cast-${id}`),
        );
        const blocker = sightBlocked(
          c.pos as Vec3,
          c.target as Vec3,
          bodies.filter((o) => !skip.has(o.id)),
        );
        if (blocker)
          issues.push({
            shot: cut.n,
            frame: f,
            problem: `view blocked by ${nameOf(doc, blocker.id)}`,
          });
      }
      const solid = solids.find((o) => insideSolid(c.pos, o));
      if (solid)
        issues.push({
          shot: cut.n,
          frame: f,
          problem: `camera inside ${solid.name}`,
        });
      const subject = cam.subject
        ? doc.objects.find((o) => o.id === `cast-${cam.subject}`)
        : undefined;
      if (!subject) continue;
      const p = objAt(subject, f);
      if (p.y < -20) {
        issues.push({
          shot: cut.n,
          frame: f,
          problem: `${subject.name} hidden while framed`,
        });
        continue;
      }
      const fwdv = norm(sub(c.target, c.pos));
      const right = norm(cross(fwdv, [0, 1, 0]));
      const up = cross(right, fwdv);
      const halfW = Math.atan(18 / c.focal);
      const halfH = Math.atan(18 / aspect / c.focal);
      // Any of feet / middle / head in frame counts (close-ups crop the body).
      const inFrame = [0.1, 0.5, 0.9].some((k) => {
        const v = sub([p.x, p.y + subject.size[1] * k, p.z], c.pos);
        const depth = dot(v, fwdv);
        if (depth <= 0.05) return false;
        return (
          Math.abs(Math.atan2(dot(v, right), depth)) <= halfW * 1.02 &&
          Math.abs(Math.atan2(dot(v, up), depth)) <= halfH * 1.05
        );
      });
      if (!inFrame)
        issues.push({
          shot: cut.n,
          frame: f,
          problem: `${subject.name} out of frame`,
        });
    }
  }
  return issues;
}
