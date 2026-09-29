/**
 * Migrate cinakey.blockout/1.0 (per-shot Theatre docs) → 2.0 part document.
 */

import { BLOCKOUT_SCHEMA_ID, BLOCKOUT_SCHEMA_V1 } from "./types";
import type {
  BlockoutCameraKey,
  BlockoutCutMarker,
  BlockoutDocument,
  BlockoutDocumentV1,
  BlockoutObject,
  BlockoutObjectType,
  BlockoutProject,
  BlockoutShotV1,
  Vec3,
} from "./types";
import { emptyPartDocument } from "./validate";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Live shot timing for assembling a part from per-shot 1.0 files. */
export type MigrateShotMeta = {
  id: string;
  order: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  shotType: string;
  notes?: string;
  sceneHeading?: string;
  lensMm?: number;
  cameraMove?: string;
};

function lookAtFromEuler(pos: Vec3, rot: Vec3, dist = 4): Vec3 {
  const yaw = rot[1];
  const pitch = rot[0];
  return [
    pos[0] + Math.sin(yaw) * Math.cos(pitch) * dist,
    pos[1] + Math.sin(pitch) * dist,
    pos[2] - Math.cos(yaw) * Math.cos(pitch) * dist,
  ];
}

function nodeToObject(
  node: BlockoutShotV1["scene"]["nodes"][number],
  frameOffset: number,
  fps: number,
  shot: BlockoutShotV1,
): BlockoutObject | null {
  if (node.kind === "ground" || node.kind === "camera") return null;

  let type: BlockoutObjectType = "box";
  if (node.kind === "mannequin") type = "character";
  else if (node.kind === "light") type = "light";
  else if (node.kind === "prop" && node.propType) {
    type = node.propType;
  } else if (node.kind === "set") {
    const n = node.name.toLowerCase();
    if (n.includes("wall")) type = "wall";
    else if (n.includes("tree")) type = "tree";
    else if (n.includes("column")) type = "column";
    else type = "box";
  }

  const scale = node.transform.scale;
  const size: Vec3 =
    type === "character"
      ? [0.5, 1.75 * (scale[1] || 1), 0.5]
      : [
          Math.abs(scale[0]) || 1,
          Math.abs(scale[1]) || 1,
          Math.abs(scale[2]) || 1,
        ];

  const char = shot.characters.find((c) => c.nodeId === node.id);
  const keys =
    char?.keyframes.map((k) => ({
      f: Math.round(frameOffset + k.t * fps),
      x: k.position[0],
      z: k.position[2],
      y: k.position[1],
      rot: (k.rotation[1] * 180) / Math.PI,
      ease: "inOut" as const,
    })) ?? [];

  // Also pull Theatre-free tracks from camera summary if mannequin had node keys
  // (already covered via characters). For props with keyframes in camera.keyframes only —
  // 1.0 stored prop tracks only in theatre; we approximate from base transform.

  return {
    id: `${shot.id}:${node.id}`,
    type,
    name: node.name,
    color: node.color ?? (type === "character" ? "#8cbf7a" : "#9aa0a8"),
    size,
    pos: [node.transform.position[0], node.transform.position[2]],
    y: node.transform.position[1],
    rot: (node.transform.rotation[1] * 180) / Math.PI,
    keys,
    entityId: node.entityId,
    lightRole: node.lightRole,
    intensity: node.intensity,
  };
}

function shotCameraKeys(
  shot: BlockoutShotV1,
  frameOffset: number,
  fps: number,
  holdAtStart: boolean,
  idPrefix: string,
): BlockoutCameraKey[] {
  const camNode = shot.scene.nodes.find((n) => n.id === shot.camera.nodeId);
  const basePos = camNode?.transform.position ?? ([0, 1.6, 6] as Vec3);
  const baseRot = camNode?.transform.rotation ?? ([0, 0, 0] as Vec3);
  const kfs = shot.camera.keyframes;
  const keys: BlockoutCameraKey[] = [];

  if (kfs.length === 0) {
    keys.push({
      id: `${idPrefix}-0`,
      f: frameOffset,
      pos: basePos,
      target: lookAtFromEuler(basePos, baseRot),
      focal: shot.lensMm,
      roll: (baseRot[2] * 180) / Math.PI,
      ease: holdAtStart ? "hold" : "inOut",
    });
    return keys;
  }

  for (const [i, k] of kfs.entries()) {
    keys.push({
      id: `${idPrefix}-${i}`,
      f: Math.round(frameOffset + k.t * fps),
      pos: k.position,
      target: lookAtFromEuler(k.position, k.rotation),
      focal: shot.lensMm,
      roll: (k.rotation[2] * 180) / Math.PI,
      ease: i === 0 && holdAtStart ? "hold" : "inOut",
    });
  }
  return keys;
}

/**
 * Assemble a 2.0 part document from one or more 1.0 shot documents + timing meta.
 * Cut boundaries use hold keys so playback cuts exactly on script timings.
 */
export function migrateShotsToPartDocument(
  shotDocs: Array<{ doc: BlockoutDocumentV1; meta: MigrateShotMeta }>,
  project: BlockoutProject,
  sequenceId?: string,
): BlockoutDocument {
  const fps = project.fps;
  const sorted = [...shotDocs].sort((a, b) => a.meta.order - b.meta.order);
  if (sorted.length === 0) {
    return emptyPartDocument(project, sequenceId);
  }

  const endSec = Math.max(...sorted.map((s) => s.meta.endSec));
  const frames = Math.max(1, Math.round(endSec * fps));
  const cameraKeys: BlockoutCameraKey[] = [];
  const objects: BlockoutObject[] = [];
  const cuts: BlockoutCutMarker[] = [];
  const guides: BlockoutDocument["guides"] = {};
  const seenObjectNames = new Set<string>();

  for (const [si, { doc, meta }] of sorted.entries()) {
    const shot = doc.scenes[0]?.shots[0];
    if (!shot) continue;
    const startF = Math.round(meta.startSec * fps);
    const endF = Math.round(meta.endSec * fps);

    cuts.push({
      n: si + 1,
      start: startF,
      end: endF,
      desc: meta.notes ?? shot.notes ?? shot.shotType,
      shotType: shot.shotType,
      shotId: meta.id,
      sceneHeading: meta.sceneHeading,
      lensMm: shot.lensMm,
      cameraMove: shot.cameraMove,
    });

    cameraKeys.push(...shotCameraKeys(shot, startF, fps, si > 0, `s${si}`));

    for (const node of shot.scene.nodes) {
      const obj = nodeToObject(node, startF, fps, shot);
      if (!obj) continue;
      // First occurrence of shared set pieces wins; per-shot characters keep unique ids
      if (
        node.kind === "set" ||
        node.kind === "prop" ||
        node.kind === "light"
      ) {
        const key = `${obj.type}:${obj.name}`;
        if (seenObjectNames.has(key)) continue;
        seenObjectNames.add(key);
        objects.push({ ...obj, id: obj.id.replace(/^[^:]+:/, "") });
      } else {
        objects.push(obj);
      }
    }

    if (shot.guides && meta.id) {
      guides[meta.id] = {
        keyframeAssetId: shot.guides.keyframeAssetId,
        depthAssetId: shot.guides.depthAssetId,
      };
    }
  }

  // Dedupe camera keys at same frame (prefer later / hold)
  cameraKeys.sort((a, b) => a.f - b.f);
  const dedupedCam: BlockoutCameraKey[] = [];
  for (const k of cameraKeys) {
    const last = dedupedCam[dedupedCam.length - 1];
    if (last && last.f === k.f) {
      dedupedCam[dedupedCam.length - 1] = k;
    } else {
      dedupedCam.push(k);
    }
  }

  return {
    schema: BLOCKOUT_SCHEMA_ID,
    version: 1,
    project,
    sequenceId,
    name: project.title || "Part",
    title: project.title,
    fps,
    frames,
    aspect: project.aspectRatio,
    camera: { sensor: 36, keys: dedupedCam },
    objects,
    env: {},
    shots: cuts,
    guides: Object.keys(guides).length ? guides : undefined,
  };
}

/** If value is v1, migrate a single-shot doc to a tiny part; if v2, return as-is. */
export function migrateToV2(
  value: unknown,
  opts?: {
    project?: BlockoutProject;
    sequenceId?: string;
    meta?: MigrateShotMeta;
  },
): BlockoutDocument {
  if (!isRecord(value)) {
    return emptyPartDocument(opts?.project, opts?.sequenceId);
  }
  if (value.schema === BLOCKOUT_SCHEMA_ID) {
    return value as BlockoutDocument;
  }
  if (value.schema !== BLOCKOUT_SCHEMA_V1) {
    return emptyPartDocument(opts?.project, opts?.sequenceId);
  }
  const doc = value as BlockoutDocumentV1;
  const shot = doc.scenes[0]?.shots[0];
  const meta: MigrateShotMeta = opts?.meta ?? {
    id: shot?.id ?? "shot-0",
    order: shot?.order ?? 0,
    startSec: 0,
    endSec: shot?.durationSec ?? 6,
    durationSec: shot?.durationSec ?? 6,
    shotType: shot?.shotType ?? "MS",
    notes: shot?.notes,
    lensMm: shot?.lensMm,
    cameraMove: shot?.cameraMove,
  };
  return migrateShotsToPartDocument(
    [{ doc, meta }],
    opts?.project ?? doc.project,
    opts?.sequenceId,
  );
}

export function isV1Document(value: unknown): value is BlockoutDocumentV1 {
  return isRecord(value) && value.schema === BLOCKOUT_SCHEMA_V1;
}
