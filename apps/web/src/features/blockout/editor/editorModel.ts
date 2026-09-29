import {
  DEFAULT_OBJECT_DEFS,
  applyCameraPreset,
  defaultEase,
  emptyPartDocument,
  objAt,
  retimeDocument,
  round2,
  type BlockoutCameraKey,
  type BlockoutDocument,
  type BlockoutEase,
  type BlockoutLightRole,
  type BlockoutObject,
  type BlockoutObjectKey,
  type BlockoutObjectType,
  type BlockoutProject,
  type CameraMovePresetId,
  type CameraPose,
  type Vec3,
} from "@cinakey/shared";
import { LIGHT_DEFAULTS } from "./runtime/objects";

let uid = 100;
export function nid(prefix: string): string {
  return `${prefix}${uid++}`;
}

export function formatTimecode(frame: number, fps: number): string {
  const ff = ((frame % fps) + fps) % fps;
  const s = Math.floor(frame / fps);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(ff)}`;
}

export function cloneDoc(doc: BlockoutDocument): BlockoutDocument {
  return structuredClone(doc);
}

export function createEmptyEditorDoc(
  project: BlockoutProject,
  sequenceId: string,
): BlockoutDocument {
  return emptyPartDocument(project, sequenceId);
}

export function currentCut(doc: BlockoutDocument, frame: number) {
  return (
    doc.shots.find((s) => frame >= s.start && frame < s.end) ??
    doc.shots[doc.shots.length - 1] ??
    null
  );
}

export function placeInFrontOfCamera(
  live: CameraPose,
  distance = 4,
): { x: number; z: number; facing: number } {
  const fx = live.target[0] - live.pos[0];
  const fz = live.target[2] - live.pos[2];
  const len = Math.hypot(fx, fz);
  const nx = len < 1e-4 ? 0 : fx / len;
  const nz = len < 1e-4 ? -1 : fz / len;
  const dist = Math.min(distance, Math.hypot(fx, fz) || distance);
  return {
    x: round2(live.pos[0] + nx * dist),
    z: round2(live.pos[2] + nz * dist),
    facing: Math.round((Math.atan2(-nx, -nz) * 180) / Math.PI),
  };
}

export function createObject(
  type: BlockoutObjectType,
  live: CameraPose,
  opts?: {
    name?: string;
    entityId?: string;
    color?: string;
    size?: Vec3;
    lightRole?: BlockoutLightRole;
  },
): BlockoutObject {
  const def =
    type in DEFAULT_OBJECT_DEFS
      ? DEFAULT_OBJECT_DEFS[type as keyof typeof DEFAULT_OBJECT_DEFS]
      : { label: type, size: [0.5, 1.75, 0.5] as Vec3, color: "#8cbf7a" };
  const at = placeInFrontOfCamera(live);
  const light =
    type === "light" && opts?.lightRole ? LIGHT_DEFAULTS[opts.lightRole] : null;
  return {
    id: nid("o"),
    type,
    name: opts?.name ?? light?.name ?? `${def.label}`,
    color: opts?.color ?? light?.color ?? def.color,
    size: opts?.size ?? light?.size ?? ([...def.size] as Vec3),
    pos: [at.x, at.z],
    rot: type === "character" || type === "creature" ? at.facing : 0,
    keys: [],
    entityId: opts?.entityId,
    lightRole: opts?.lightRole,
    intensity: light?.intensity,
  };
}

export function setObjectTransform(
  o: BlockoutObject,
  frame: number,
  x: number,
  z: number,
  rot: number,
  y: number,
): BlockoutObject {
  if (!o.keys.length) {
    return { ...o, pos: [x, z], rot, y };
  }
  const keys = [...o.keys];
  const idx = keys.findIndex((k) => k.f === frame);
  const next: BlockoutObjectKey = {
    f: frame,
    x,
    z,
    y,
    rot,
    ease: defaultEase(),
  };
  if (idx >= 0) keys[idx] = { ...keys[idx]!, ...next };
  else keys.push(next);
  keys.sort((a, b) => a.f - b.f);
  return { ...o, keys };
}

export function keyObjectAtFrame(
  o: BlockoutObject,
  frame: number,
): BlockoutObject {
  const s = objAt(o, frame);
  const keys = [...o.keys];
  const idx = keys.findIndex((k) => k.f === frame);
  const next: BlockoutObjectKey = {
    f: frame,
    x: round2(s.x),
    z: round2(s.z),
    y: round2(s.y),
    rot: Math.round(s.rot),
    ease: defaultEase(),
  };
  if (idx >= 0) keys[idx] = next;
  else keys.push(next);
  keys.sort((a, b) => a.f - b.f);
  return { ...o, keys };
}

export function keyCameraAtFrame(
  doc: BlockoutDocument,
  frame: number,
  live: CameraPose,
  existingId?: string,
): { doc: BlockoutDocument; key: BlockoutCameraKey } {
  const keys = [...doc.camera.keys];
  const data = {
    pos: live.pos.map(round2) as Vec3,
    target: live.target.map(round2) as Vec3,
    focal: Math.round(live.focal * 10) / 10,
    roll: Math.round(live.roll),
  };
  let key = keys.find((k) => k.f === frame);
  if (key) {
    key = { ...key, ...data };
    const i = keys.findIndex((k) => k.id === key!.id);
    keys[i] = key;
  } else {
    key = {
      id: existingId ?? nid("k"),
      f: frame,
      ease: defaultEase(),
      ...data,
    };
    keys.push(key);
  }
  keys.sort((a, b) => a.f - b.f);
  return {
    doc: { ...doc, camera: { ...doc.camera, keys } },
    key,
  };
}

export function applyPresetToDoc(
  doc: BlockoutDocument,
  presetId: CameraMovePresetId,
  live: CameraPose,
): BlockoutDocument {
  const keys = applyCameraPreset(presetId, doc.frames, live);
  return { ...doc, camera: { ...doc.camera, keys } };
}

export function updateShotTiming(
  doc: BlockoutDocument,
  opts: { durationSec?: number; fps?: number; aspect?: string },
): BlockoutDocument {
  let next = doc;
  if (opts.fps != null || opts.durationSec != null) {
    const fps = opts.fps ?? doc.fps;
    const frames =
      opts.durationSec != null
        ? Math.max(1, Math.round(opts.durationSec * fps))
        : doc.frames;
    next = retimeDocument(doc, { fps, frames });
  }
  if (opts.aspect) {
    next = {
      ...next,
      aspect: opts.aspect,
      project: { ...next.project, aspectRatio: opts.aspect },
    };
  }
  return next;
}

export function deleteCameraKey(
  doc: BlockoutDocument,
  keyId: string,
): BlockoutDocument {
  return {
    ...doc,
    camera: {
      ...doc.camera,
      keys: doc.camera.keys.filter((k) => k.id !== keyId),
    },
  };
}

export function deleteObjectKey(
  o: BlockoutObject,
  frame: number,
): BlockoutObject {
  const keys = o.keys.filter((k) => k.f !== frame);
  if (keys.length === 0 && o.keys.length === 1) {
    const k = o.keys[0]!;
    return {
      ...o,
      pos: [k.x, k.z],
      rot: k.rot,
      y: k.y,
      keys: [],
    };
  }
  return { ...o, keys };
}

export function updateKeyEase(
  doc: BlockoutDocument,
  sel: SelKey,
  ease: BlockoutEase,
): BlockoutDocument {
  if (sel.kind === "cam") {
    return {
      ...doc,
      camera: {
        ...doc.camera,
        keys: doc.camera.keys.map((k) =>
          k.id === sel.id ? { ...k, ease } : k,
        ),
      },
    };
  }
  return {
    ...doc,
    objects: doc.objects.map((o) =>
      o.id !== sel.objectId
        ? o
        : {
            ...o,
            keys: o.keys.map((k) => (k.f === sel.f ? { ...k, ease } : k)),
          },
    ),
  };
}

export type SelKey =
  { kind: "cam"; id: string } | { kind: "obj"; objectId: string; f: number };

export const PROP_ADD_TYPES: Array<{
  type: BlockoutObjectType;
  label: string;
}> = [
  { type: "box", label: "Box" },
  { type: "chair", label: "Chair" },
  { type: "table", label: "Table" },
  { type: "door", label: "Door" },
  { type: "car", label: "Car" },
  { type: "wall", label: "Wall" },
  { type: "column", label: "Column" },
  { type: "tree", label: "Tree" },
  { type: "sphere", label: "Sphere" },
  { type: "strip", label: "Path strip" },
  { type: "mark", label: "Mark" },
  { type: "fire", label: "Campfire" },
];

export const LIGHT_ADD_ROLES: BlockoutLightRole[] = [
  "key",
  "fill",
  "back",
  "sun",
];
