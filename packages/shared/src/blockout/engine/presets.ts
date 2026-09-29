import type {
  BlockoutCameraKey,
  BlockoutDocument,
  BlockoutObject,
  CameraMovePresetId,
  Vec3,
} from "../types";
import type { CameraPose } from "./camera";
import { round2 } from "./math";

function nid(prefix: string, n: number): string {
  return `${prefix}${n}`;
}

function key(
  id: string,
  f: number,
  pos: Vec3,
  target: Vec3,
  focal: number,
  roll: number,
  ease: BlockoutCameraKey["ease"] = "inOut",
): BlockoutCameraKey {
  return {
    id,
    f,
    pos: [round2(pos[0]), round2(pos[1]), round2(pos[2])],
    target: [round2(target[0]), round2(target[1]), round2(target[2])],
    focal: Math.round(focal * 10) / 10,
    roll: Math.round(roll || 0),
    ease,
  };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function length(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}
function normalize(a: Vec3): Vec3 {
  const L = length(a) || 1;
  return [a[0] / L, a[1] / L, a[2] / L];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function applyAxisAngleY(v: Vec3, angleRad: number): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

/**
 * Build camera keys across the whole part from the current framing.
 * Matches the reference HTML presets.
 */
export function applyCameraPreset(
  presetId: CameraMovePresetId,
  frames: number,
  live: CameraPose,
  idSeed = 1,
): BlockoutCameraKey[] {
  const F = frames;
  const P = live.pos;
  const T = live.target;
  const fo = live.focal;
  const ro = live.roll;
  let n = idSeed;
  const nextId = () => nid("k", n++);

  const dir = sub(T, P);
  const dist = length(dir);
  const right = normalize(cross(normalize(dir), [0, 1, 0]));

  switch (presetId) {
    case "static":
      return [key(nextId(), 0, P, T, fo, ro)];
    case "push":
      return [
        key(nextId(), 0, P, T, fo, ro),
        key(nextId(), F, add(P, scale(dir, 0.45)), T, fo, ro),
      ];
    case "pull":
      return [
        key(nextId(), 0, add(P, scale(dir, 0.3)), T, fo, ro),
        key(nextId(), F, add(P, scale(dir, -0.5)), T, fo, ro),
      ];
    case "truck": {
      const d = Math.max(1, dist * 0.35);
      return [
        key(
          nextId(),
          0,
          add(P, scale(right, -d)),
          add(T, scale(right, -d * 0.6)),
          fo,
          ro,
        ),
        key(
          nextId(),
          F,
          add(P, scale(right, d)),
          add(T, scale(right, d * 0.6)),
          fo,
          ro,
        ),
      ];
    }
    case "orbit": {
      const keys: BlockoutCameraKey[] = [];
      const off = sub(P, T);
      const steps = 4;
      for (let i = 0; i <= steps; i++) {
        const a = ((-45 + (90 * i) / steps) * Math.PI) / 180;
        const o = applyAxisAngleY(off, a);
        const ease = i === 0 ? "in" : i === steps ? "out" : ("linear" as const);
        keys.push(
          key(
            nextId(),
            Math.round((F * i) / steps),
            add(T, o),
            T,
            fo,
            ro,
            ease,
          ),
        );
      }
      return keys;
    }
    case "crane": {
      const lo: Vec3 = [P[0], Math.max(0.4, P[1] - 0.8), P[2]];
      const hi: Vec3 = [P[0], P[1] + 3.2, P[2]];
      const t2: Vec3 = [T[0], T[1] + 1.1, T[2]];
      return [
        key(nextId(), 0, lo, T, fo, ro),
        key(nextId(), F, hi, t2, fo, ro),
      ];
    }
    case "dzoom": {
      const far = add(T, scale(sub(P, T), 1.9));
      return [
        key(nextId(), 0, P, T, fo, ro),
        key(nextId(), F, far, T, Math.min(200, fo * 1.9), ro),
      ];
    }
    case "dutch":
      return [key(nextId(), 0, P, T, fo, 0), key(nextId(), F, P, T, fo, 12)];
    default:
      return [key(nextId(), 0, P, T, fo, ro)];
  }
}

/** Rescale every key (and cut markers) when fps or frame count changes. */
export function retimeDocument(
  doc: BlockoutDocument,
  opts: { fps?: number; frames?: number },
): BlockoutDocument {
  const oldFps = doc.fps;
  const oldFrames = doc.frames;
  const fps = opts.fps ?? oldFps;
  const frames =
    opts.frames ??
    (opts.fps != null ? Math.round(oldFrames * (fps / oldFps)) : oldFrames);
  if (fps === oldFps && frames === oldFrames) return doc;

  const r = frames / Math.max(1, oldFrames);
  const scaleF = (f: number) => Math.round(f * r);

  const cameraKeys = dedupeKeysByFrame(
    doc.camera.keys.map((k) => ({ ...k, f: scaleF(k.f) })),
  );
  const objects: BlockoutObject[] = doc.objects.map((o) => ({
    ...o,
    keys: dedupeKeysByFrame(o.keys.map((k) => ({ ...k, f: scaleF(k.f) }))),
  }));
  const shots = doc.shots.map((s) => ({
    ...s,
    start: scaleF(s.start),
    end: scaleF(s.end),
  }));

  return {
    ...doc,
    fps,
    frames,
    camera: { ...doc.camera, keys: cameraKeys },
    objects,
    shots,
  };
}

export function dedupeKeysByFrame<T extends { f: number }>(keys: T[]): T[] {
  const sorted = [...keys].sort((a, b) => a.f - b.f);
  return sorted.filter((k, i) => i === 0 || k.f !== sorted[i - 1]!.f);
}

export function clampDurationSec(
  sec: number,
  minSec: number,
  maxSec: number,
): number {
  return Math.min(maxSec, Math.max(minSec, sec));
}
