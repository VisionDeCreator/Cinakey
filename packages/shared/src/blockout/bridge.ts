/**
 * Map blockout sheet structured data ↔ cinakey.blockout/2.0 part documents.
 */

import type {
  BlockoutCameraKey,
  BlockoutCutMarker,
  BlockoutDocument,
  BlockoutObject,
  BlockoutObjectType,
  BlockoutProject,
  Vec3,
} from "./types";
import { BLOCKOUT_SCHEMA_ID, DEFAULT_OBJECT_DEFS } from "./types";
import { emptyPartDocument } from "./validate";

export type LiveShotMeta = {
  id: string;
  sceneId: string;
  order: number;
  durationSec: number;
  startSec?: number;
  endSec?: number;
  shotType: string;
  lensMm?: number;
  cameraMove?: string;
  notes?: string;
  characterIds: string[];
  n?: number;
  sceneHeading?: string;
};

type SheetLike = {
  sequenceTitle?: string;
  set: Array<{
    id: string;
    name: string;
    primitive: string;
    position: Vec3;
    rotation?: Vec3;
    size: Vec3;
  }>;
  cast: Array<{
    id: string;
    name: string;
    entityId?: string;
    proxy: string;
    colorCode?: string;
    sizeHint?: string;
  }>;
  props: Array<{
    id: string;
    name: string;
    entityId?: string;
  }>;
  light: {
    sunAzimuthDeg: number;
    sunElevationDeg: number;
  };
  shots: Array<{
    n: number;
    liveShotId?: string;
    startSec: number;
    endSec: number;
    shotType: string;
    lensMm?: number;
    cameraMove?: string;
    frameMustShow?: string;
    continuity?: string;
    audioCue?: string;
    camera: {
      startPosition: Vec3;
      startLookAt: Vec3;
      endPosition: Vec3;
      endLookAt: Vec3;
      moveType?: string;
    };
    blocking: Array<{
      targetId: string;
      startPosition: Vec3;
      endPosition: Vec3;
      startPose?: string;
      timedKeys?: Array<{ t: number }>;
    }>;
    events: Array<{ label: string }>;
  }>;
};

function defaultLensForShotType(shotType: string): number {
  const key = shotType.toLowerCase();
  if (key.includes("ecu") || key.includes("extreme close")) return 85;
  if (key.includes("cu") || key.includes("close")) return 50;
  if (key.includes("ms") || key.includes("medium")) return 35;
  if (key.includes("ws") || key.includes("wide")) return 24;
  if (key.includes("ews") || key.includes("establishing")) return 18;
  return 35;
}

function primitiveToType(primitive: string): BlockoutObjectType {
  const p = primitive.toLowerCase();
  if (p.includes("tree")) return "tree";
  if (p.includes("wall")) return "wall";
  if (p.includes("column") || p.includes("cylinder")) return "column";
  if (p.includes("sphere")) return "sphere";
  if (p.includes("strip") || p.includes("path") || p.includes("plane"))
    return "strip";
  if (p.includes("fire") || p.includes("camp")) return "fire";
  if (p.includes("car")) return "car";
  if (p.includes("cliff") || p.includes("box")) return "box";
  return "box";
}

function creatureTypeFromProxy(
  proxy: string,
  sizeHint?: string,
): {
  type: BlockoutObjectType;
  size: Vec3;
} {
  const p = (proxy + " " + (sizeHint ?? "")).toLowerCase();
  if (
    p.includes("quad") ||
    p.includes("horse") ||
    p.includes("cheetah") ||
    p.includes("hare") ||
    p.includes("cat")
  ) {
    // Horse-sized cheetah / large quadruped
    const scale = p.includes("horse") || p.includes("cheetah") ? 1.4 : 1;
    return {
      type: "hare",
      size: [0.7 * scale, 2.7 * scale, 1.9 * scale],
    };
  }
  if (p.includes("raptor") || p.includes("biped") || p.includes("dino")) {
    return { type: "raptor", size: [0.8, 1.9, 3.6] };
  }
  if (p.includes("humanoid") || p.includes("human")) {
    return { type: "character", size: [0.5, 1.75, 0.5] };
  }
  return { type: "hare", size: [0.7, 2.2, 1.6] };
}

/**
 * Build a part-scoped 2.0 document from a blockout sheet + live shots.
 * When `keepCuts` is provided, camera/object keys for those shotIds are preserved
 * from `existing` (selective Update).
 */
export function blockoutSheetToPartDocument(
  sheet: SheetLike,
  project: BlockoutProject,
  liveShots: LiveShotMeta[],
  opts?: {
    version?: number;
    parentFileId?: string;
    sequenceId?: string;
    existing?: BlockoutDocument | null;
    keepShotIds?: Set<string>;
  },
): BlockoutDocument {
  const byN = new Map(liveShots.map((s) => [s.n ?? s.order + 1, s]));
  const fps = project.fps;
  const keep = opts?.keepShotIds ?? new Set<string>();
  const existing = opts?.existing ?? null;

  const objects: BlockoutObject[] = [];
  const cuts: BlockoutCutMarker[] = [];
  const cameraKeys: BlockoutCameraKey[] = [];
  let keyN = 0;
  const nextKeyId = () => `k${keyN++}`;

  // Shared set / cast / props
  for (const set of sheet.set) {
    const type = primitiveToType(set.primitive);
    objects.push({
      id: set.id,
      type,
      name: set.name,
      color: "#9aa0a8",
      size: set.size,
      pos: [set.position[0], set.position[2]],
      y: set.position[1],
      rot: ((set.rotation?.[1] ?? 0) * 180) / Math.PI,
      keys: [],
    });
  }

  for (const cast of sheet.cast) {
    const isHuman = cast.proxy.toLowerCase().includes("humanoid");
    const creature = creatureTypeFromProxy(cast.proxy, cast.sizeHint);
    objects.push({
      id: cast.id,
      type: isHuman ? "character" : creature.type,
      name: cast.name,
      color: cast.colorCode ?? (isHuman ? "#8cbf7a" : "#cdb48f"),
      size: isHuman ? DEFAULT_OBJECT_DEFS.character.size : creature.size,
      pos: [0, 0],
      rot: 0,
      keys: [],
      entityId: cast.entityId,
    });
  }

  for (const prop of sheet.props) {
    objects.push({
      id: prop.id,
      type: "box",
      name: prop.name,
      color: "#9aa0a8",
      size: [1, 1, 1],
      pos: [0, 0],
      rot: 0,
      keys: [],
      entityId: prop.entityId,
    });
  }

  objects.push({
    id: "light-key",
    type: "light",
    name: "Key light",
    color: "#fff4e0",
    size: [0.3, 0.3, 0.3],
    pos: [4, -4],
    y: 6,
    rot: 0,
    keys: [],
    lightRole: "key",
    intensity: 1.2,
    glow: true,
  });
  objects.push({
    id: "light-fill",
    type: "light",
    name: "Fill",
    color: "#c8d8ff",
    size: [0.25, 0.25, 0.25],
    pos: [-4, 2],
    y: 3,
    rot: 0,
    keys: [],
    lightRole: "fill",
    intensity: 0.4,
  });

  const sortedShots = [...sheet.shots].sort((a, b) => a.startSec - b.startSec);
  let partEnd = 0;

  for (const [si, shot] of sortedShots.entries()) {
    const live =
      liveShots.find((s) => s.id === shot.liveShotId) ?? byN.get(shot.n);
    const shotId = live?.id ?? shot.liveShotId ?? `shot-${shot.n}`;
    const startSec = live?.startSec ?? shot.startSec;
    const endSec = live?.endSec ?? shot.endSec;
    const startF = Math.round(startSec * fps);
    const endF = Math.round(endSec * fps);
    partEnd = Math.max(partEnd, endF);
    const lensMm =
      shot.lensMm || live?.lensMm || defaultLensForShotType(shot.shotType);

    cuts.push({
      n: shot.n,
      start: startF,
      end: endF,
      desc: [shot.frameMustShow, live?.notes, shot.shotType]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 120),
      shotType: shot.shotType,
      shotId,
      sceneHeading: live?.sceneHeading,
      lensMm,
      cameraMove: shot.cameraMove || live?.cameraMove,
    });

    if (keep.has(shotId) && existing) {
      // Preserve camera keys in [startF, endF)
      for (const k of existing.camera.keys) {
        if (k.f >= startF && k.f < endF) {
          cameraKeys.push({ ...k });
        } else if (k.f === endF && si === sortedShots.length - 1) {
          cameraKeys.push({ ...k });
        }
      }
      // Preserve object keys in range; merge into objects by entityId/id
      for (const eo of existing.objects) {
        const match =
          objects.find((o) => o.id === eo.id) ??
          objects.find((o) => o.entityId && o.entityId === eo.entityId);
        if (!match) {
          // Keep hand-added objects
          if (!objects.some((o) => o.id === eo.id)) {
            objects.push({
              ...eo,
              keys: eo.keys.filter((k) => k.f >= startF && k.f <= endF),
            });
          }
          continue;
        }
        match.pos = eo.pos;
        match.y = eo.y;
        match.rot = eo.rot;
        match.color = eo.color;
        match.size = eo.size;
        const kept = eo.keys.filter((k) => k.f >= startF && k.f <= endF);
        match.keys = [...match.keys, ...kept];
      }
      continue;
    }

    // Rebuild this shot's camera keys
    const hold = si > 0;
    cameraKeys.push({
      id: nextKeyId(),
      f: startF,
      pos: shot.camera.startPosition,
      target: shot.camera.startLookAt,
      focal: lensMm,
      roll: 0,
      ease: hold ? "hold" : "inOut",
    });
    cameraKeys.push({
      id: nextKeyId(),
      f: endF,
      pos: shot.camera.endPosition,
      target: shot.camera.endLookAt,
      focal: lensMm,
      roll: 0,
      ease: "inOut",
    });

    for (const b of shot.blocking) {
      const obj = objects.find((o) => o.id === b.targetId);
      if (!obj) continue;
      obj.pos = [b.startPosition[0], b.startPosition[2]];
      obj.y = b.startPosition[1];
      obj.keys = [
        ...obj.keys.filter((k) => k.f < startF || k.f > endF),
        {
          f: startF,
          x: b.startPosition[0],
          z: b.startPosition[2],
          y: b.startPosition[1],
          rot: obj.rot,
          ease: "inOut" as const,
        },
        {
          f: endF,
          x: b.endPosition[0],
          z: b.endPosition[2],
          y: b.endPosition[1],
          rot: obj.rot,
          ease: "inOut" as const,
        },
      ].sort((a, c) => a.f - c.f);
    }

    for (const [i, ev] of shot.events.entries()) {
      objects.push({
        id: `event-${shot.n}-${i}`,
        type: "mark",
        name: ev.label,
        color: "#c9a44f",
        size: [0.6, 0.02, 0.6],
        pos: [i * 0.5, 0],
        rot: 0,
        keys: [],
      });
    }
  }

  // Sort + dedupe camera keys
  cameraKeys.sort((a, b) => a.f - b.f);
  const deduped: BlockoutCameraKey[] = [];
  for (const k of cameraKeys) {
    const last = deduped[deduped.length - 1];
    if (last && last.f === k.f) deduped[deduped.length - 1] = k;
    else deduped.push(k);
  }

  // Keep hand-added objects from existing that aren't in sheet
  if (existing && keep.size > 0) {
    for (const eo of existing.objects) {
      if (objects.some((o) => o.id === eo.id)) continue;
      if (eo.id.startsWith("event-")) continue;
      objects.push(eo);
    }
  }

  const frames = Math.max(1, partEnd);
  return {
    schema: BLOCKOUT_SCHEMA_ID,
    version: opts?.version ?? 1,
    ...(opts?.parentFileId ? { parentFileId: opts.parentFileId } : {}),
    project,
    sequenceId: opts?.sequenceId,
    name: sheet.sequenceTitle ?? project.title,
    title: sheet.sequenceTitle,
    fps,
    frames,
    aspect: project.aspectRatio,
    camera: { sensor: 36, keys: deduped },
    objects,
    env: existing?.env ?? {
      sky: "#1c222a",
      ground: true,
      fog: true,
    },
    shots: cuts,
    guides: existing?.guides,
  };
}

/**
 * @deprecated Prefer blockoutSheetToPartDocument. Returns a Map with a single
 * entry under sequence key for backward-compatible call sites during 11D.
 */
export function blockoutSheetToDocuments(
  sheet: SheetLike,
  project: BlockoutProject,
  liveShots: LiveShotMeta[],
  opts?: {
    version?: number;
    parentFileIdByShot?: Record<string, string>;
    sequenceId?: string;
    existing?: BlockoutDocument | null;
    keepShotIds?: Set<string>;
  },
): Map<string, BlockoutDocument> {
  const doc = blockoutSheetToPartDocument(sheet, project, liveShots, {
    version: opts?.version,
    sequenceId: opts?.sequenceId,
    existing: opts?.existing,
    keepShotIds: opts?.keepShotIds,
  });
  const key = opts?.sequenceId ?? "part";
  return new Map([[key, doc]]);
}

/** Patch sheet shot camera from a part document cut range. */
export function blockoutDocumentToSheetShotPatch(
  doc: BlockoutDocument,
  shotN: number,
): {
  n: number;
  lensMm?: number;
  cameraMove?: string;
  camera: {
    startPosition: Vec3;
    startLookAt: Vec3;
    endPosition: Vec3;
    endLookAt: Vec3;
    moveType: string;
  };
} | null {
  const cut = doc.shots.find((s) => s.n === shotN);
  if (!cut) return null;
  const keys = doc.camera.keys
    .filter((k) => k.f >= cut.start && k.f <= cut.end)
    .sort((a, b) => a.f - b.f);
  const start = keys[0];
  const end = keys[keys.length - 1] ?? start;
  if (!start || !end) return null;
  return {
    n: shotN,
    lensMm: cut.lensMm ?? start.focal,
    cameraMove: cut.cameraMove ?? "static",
    camera: {
      startPosition: start.pos,
      startLookAt: start.target,
      endPosition: end.pos,
      endLookAt: end.target,
      moveType: cut.cameraMove ?? "static",
    },
  };
}

export function createDefaultPartDocument(
  project: BlockoutProject,
  sequenceId?: string,
): BlockoutDocument {
  return emptyPartDocument(project, sequenceId);
}
