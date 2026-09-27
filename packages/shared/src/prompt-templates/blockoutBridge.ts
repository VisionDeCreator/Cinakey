/**
 * Map blockout sheet structured data ↔ cinakey.blockout/1.0 per-shot documents.
 */

import type {
  BlockoutDocument,
  BlockoutNode,
  BlockoutProject,
  BlockoutTracks,
  Vec3,
} from "../blockout";
import {
  blockoutTransform,
  finalizeShot,
  singleShotDocument,
} from "../blockout";
import type { BlockoutSheetData } from "./schemas";
import { LENS_DEFAULTS_MM } from "./constants";

export type LiveShotMeta = {
  id: string;
  sceneId: string;
  order: number;
  durationSec: number;
  shotType: string;
  lensMm?: number;
  cameraMove?: string;
  notes?: string;
  characterIds: string[];
  n?: number;
};

function lookAtToRotation(
  from: Vec3,
  lookAt: Vec3,
): Vec3 {
  const dx = lookAt[0] - from[0];
  const dy = lookAt[1] - from[1];
  const dz = lookAt[2] - from[2];
  const yaw = Math.atan2(dx, -dz);
  const horizontal = Math.sqrt(dx * dx + dz * dz);
  const pitch = Math.atan2(dy, horizontal);
  return [pitch, yaw, 0];
}

function defaultLensForShotType(shotType: string): number {
  const key = shotType.toLowerCase();
  for (const [k, v] of Object.entries(LENS_DEFAULTS_MM)) {
    if (key.includes(k)) return v;
  }
  return 35;
}

function primitiveToNodeKind(
  primitive: string,
): { kind: BlockoutNode["kind"]; propType?: BlockoutNode["propType"] } {
  const p = primitive.toLowerCase();
  if (p.includes("tree") || p.includes("cylinder") || p.includes("sphere") || p.includes("box") || p.includes("cliff") || p.includes("strip") || p.includes("plane")) {
    return { kind: "set" };
  }
  return { kind: "set" };
}

/**
 * Convert a blockout sheet into per-shot BlockoutDocuments keyed by live shot id
 * (or synthetic id `shot-${n}` when liveShotId is missing).
 */
export function blockoutSheetToDocuments(
  sheet: BlockoutSheetData,
  project: BlockoutProject,
  liveShots: LiveShotMeta[],
  opts?: { version?: number; parentFileIdByShot?: Record<string, string> },
): Map<string, BlockoutDocument> {
  const byN = new Map(liveShots.map((s) => [s.n ?? s.order + 1, s]));
  const result = new Map<string, BlockoutDocument>();

  // Shared set / cast / prop / light nodes (base scene graph)
  const sharedNodes: BlockoutNode[] = [];
  sharedNodes.push({
    id: "ground",
    kind: "ground",
    name: "Ground",
    transform: blockoutTransform([0, 0, 0]),
  });

  for (const set of sheet.set) {
    const { kind } = primitiveToNodeKind(set.primitive);
    sharedNodes.push({
      id: set.id,
      kind,
      name: set.name,
      transform: blockoutTransform(
        set.position,
        set.rotation ?? [0, 0, 0],
        set.size,
      ),
    });
  }

  for (const cast of sheet.cast) {
    const isHuman = cast.proxy.toLowerCase().includes("humanoid");
    sharedNodes.push({
      id: cast.id,
      kind: "mannequin",
      name: cast.name,
      entityId: cast.entityId,
      pose: isHuman ? "standing" : "standing",
      color: cast.colorCode,
      transform: blockoutTransform([0, 0, 0]),
    });
  }

  for (const prop of sheet.props) {
    sharedNodes.push({
      id: prop.id,
      kind: "prop",
      name: prop.name,
      entityId: prop.entityId,
      propType: "box",
      transform: blockoutTransform([0, 0, 0]),
    });
  }

  // Lights from sheet
  const az = (sheet.light.sunAzimuthDeg * Math.PI) / 180;
  const el = (sheet.light.sunElevationDeg * Math.PI) / 180;
  const sunDist = 20;
  const sunPos: Vec3 = [
    Math.cos(el) * Math.sin(az) * sunDist,
    Math.sin(el) * sunDist,
    Math.cos(el) * Math.cos(az) * sunDist,
  ];
  sharedNodes.push({
    id: "light-key",
    kind: "light",
    name: "Key (sun)",
    lightRole: "key",
    intensity: 1.2,
    color: "#fff4e0",
    transform: blockoutTransform(sunPos),
  });
  sharedNodes.push({
    id: "light-fill",
    kind: "light",
    name: "Fill",
    lightRole: "fill",
    intensity: 0.4,
    color: "#c8d8ff",
    transform: blockoutTransform([-4, 3, 2]),
  });

  for (const shot of sheet.shots) {
    const live =
      liveShots.find((s) => s.id === shot.liveShotId) ??
      byN.get(shot.n);
    const shotId = live?.id ?? shot.liveShotId ?? `shot-${shot.n}`;
    const sceneId = live?.sceneId ?? "scene-1";
    const order = live?.order ?? shot.n - 1;
    const durationSec = shot.endSec - shot.startSec;
    const lensMm =
      shot.lensMm ||
      live?.lensMm ||
      defaultLensForShotType(shot.shotType);

    const cameraId = "shot-camera";
    const nodes: BlockoutNode[] = [
      ...sharedNodes.map((n) => ({ ...n, transform: { ...n.transform } })),
      {
        id: cameraId,
        kind: "camera",
        name: "Shot camera",
        transform: blockoutTransform(
          shot.camera.startPosition,
          lookAtToRotation(
            shot.camera.startPosition,
            shot.camera.startLookAt,
          ),
        ),
      },
    ];

    // Apply blocking start positions
    for (const b of shot.blocking) {
      const node = nodes.find((n) => n.id === b.targetId);
      if (node) {
        node.transform = blockoutTransform(
          b.startPosition,
          node.transform.rotation,
          node.transform.scale,
        );
        if (b.startPose && (b.startPose === "standing" || b.startPose === "sitting" || b.startPose === "walking")) {
          node.pose = b.startPose;
        }
      }
    }

    // Event markers as small set nodes
    for (const [i, ev] of shot.events.entries()) {
      nodes.push({
        id: `event-${shot.n}-${i}`,
        kind: "set",
        name: `Event: ${ev.label}`,
        transform: blockoutTransform([0, 0.5 + i * 0.2, 0], [0, 0, 0], [0.2, 0.2, 0.2]),
      });
    }

    const tracks: BlockoutTracks = {
      [cameraId]: [
        {
          t: 0,
          position: shot.camera.startPosition,
          rotation: lookAtToRotation(
            shot.camera.startPosition,
            shot.camera.startLookAt,
          ),
          scale: [1, 1, 1],
        },
        {
          t: durationSec,
          position: shot.camera.endPosition,
          rotation: lookAtToRotation(
            shot.camera.endPosition,
            shot.camera.endLookAt,
          ),
          scale: [1, 1, 1],
        },
      ],
    };

    for (const b of shot.blocking) {
      const keys = [
        {
          t: 0,
          position: b.startPosition,
          rotation: [0, 0, 0] as Vec3,
          scale: [1, 1, 1] as Vec3,
        },
        {
          t: durationSec,
          position: b.endPosition,
          rotation: [0, 0, 0] as Vec3,
          scale: [1, 1, 1] as Vec3,
        },
      ];
      for (const tk of b.timedKeys ?? []) {
        keys.push({
          t: Math.min(tk.t, durationSec),
          position: b.endPosition,
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        });
      }
      tracks[b.targetId] = keys.sort((a, c) => a.t - c.t);
    }

    const finalized = finalizeShot(
      {
        id: shotId,
        sceneId,
        order,
        durationSec,
        shotType: shot.shotType,
        lensMm,
        cameraMove: shot.cameraMove || live?.cameraMove,
        notes: [
          live?.notes,
          `Frame: ${shot.frameMustShow}`,
          `Continuity: ${shot.continuity}`,
          shot.audioCue ? `Audio: ${shot.audioCue}` : undefined,
        ]
          .filter(Boolean)
          .join(" | "),
        characterIds: live?.characterIds ?? [],
        camera: { nodeId: cameraId },
        scene: { nodes },
      },
      tracks,
      project.fps,
    );

    const doc = singleShotDocument(
      project,
      { id: sceneId, order: 0, heading: sheet.sequenceTitle },
      finalized,
      opts?.version ?? 1,
      opts?.parentFileIdByShot?.[shotId],
    );
    result.set(shotId, doc);
  }

  return result;
}

/**
 * Patch blockout sheet shot camera/blocking from a saved BlockoutDocument
 * (editor write-back).
 */
export function blockoutDocumentToSheetShotPatch(
  doc: BlockoutDocument,
  shotN: number,
): Partial<BlockoutSheetData["shots"][number]> | null {
  const shot = doc.scenes[0]?.shots[0];
  if (!shot) return null;
  const cam = shot.scene.nodes.find((n) => n.id === shot.camera.nodeId);
  const camKeys = shot.camera.keyframes;
  const start = camKeys[0] ?? {
    t: 0,
    position: cam?.transform.position ?? [0, 1.6, 6],
    rotation: cam?.transform.rotation ?? [0, 0, 0],
    scale: [1, 1, 1] as Vec3,
  };
  const end = camKeys[camKeys.length - 1] ?? start;

  const forward = (pos: Vec3, rot: Vec3): Vec3 => {
    // Approximate look-at from Euler: look down -Z rotated
    const yaw = rot[1];
    const pitch = rot[0];
    const dist = 3;
    return [
      pos[0] + Math.sin(yaw) * Math.cos(pitch) * dist,
      pos[1] + Math.sin(pitch) * dist,
      pos[2] - Math.cos(yaw) * Math.cos(pitch) * dist,
    ];
  };

  return {
    n: shotN,
    lensMm: shot.lensMm,
    cameraMove: shot.cameraMove ?? "static",
    camera: {
      startPosition: start.position,
      startLookAt: forward(start.position, start.rotation),
      endPosition: end.position,
      endLookAt: forward(end.position, end.rotation),
      moveType: shot.cameraMove ?? "static",
    },
  };
}
