import {
  blockoutTransform,
  finalizeShot,
  normalizeKeyframes,
  singleShotDocument,
  type BlockoutDocument,
  type BlockoutKeyframe,
  type BlockoutLightRole,
  type BlockoutNode,
  type BlockoutProject,
  type BlockoutPropType,
  type BlockoutShot,
  type BlockoutTracks,
  type BlockoutTransform,
} from "@cinakey/shared";

export const DEFAULT_LENS_MM = 35;

export type EditorShotState = {
  nodes: BlockoutNode[];
  cameraNodeId: string;
  tracks: BlockoutTracks;
  lensMm: number;
  guides?: BlockoutShot["guides"];
};

export type ShotMeta = {
  _id: string;
  sceneId: string;
  order: number;
  durationSec: number;
  shotType: string;
  lensMm?: number;
  cameraMove?: string;
  dialogue?: string;
  notes?: string;
  characterIds: string[];
  keyframeAssetId?: string;
};

export function newNodeId(kind: string): string {
  return `${kind}-${Math.random().toString(36).slice(2, 8)}`;
}

export const PROP_LABELS: Record<BlockoutPropType, string> = {
  box: "Box",
  chair: "Chair",
  table: "Table",
  door: "Door",
  car: "Car",
};

export const LIGHT_DEFAULTS: Record<BlockoutLightRole, { name: string; position: [number, number, number] }> = {
  key: { name: "Key light", position: [4, 6, 4] },
  fill: { name: "Fill light", position: [-5, 3, 3] },
  back: { name: "Back light", position: [0, 5, -6] },
};

export function createMannequin(
  index: number,
  character?: { id: string; name: string },
): BlockoutNode {
  return {
    id: newNodeId("mannequin"),
    kind: "mannequin",
    name: character?.name ?? `Figure ${index + 1}`,
    ...(character ? { entityId: character.id } : {}),
    pose: "standing",
    transform: blockoutTransform([((index % 6) - 2.5) * 1.1, 0, -Math.floor(index / 6) * 1.2]),
  };
}

export function createProp(type: BlockoutPropType, offset = 0): BlockoutNode {
  return {
    id: newNodeId("prop"),
    kind: "prop",
    name: PROP_LABELS[type],
    propType: type,
    transform: blockoutTransform([1.5 + (offset % 4) * 0.6, 0, -1 - Math.floor(offset / 4) * 0.8]),
  };
}

export function createSetPiece(): BlockoutNode {
  return {
    id: newNodeId("set"),
    kind: "set",
    name: "Wall",
    transform: blockoutTransform([0, 0, -2], [0, 0, 0], [4, 3, 0.2]),
  };
}

export function createLight(role: BlockoutLightRole): BlockoutNode {
  const d = LIGHT_DEFAULTS[role];
  return {
    id: newNodeId("light"),
    kind: "light",
    name: d.name,
    lightRole: role,
    transform: blockoutTransform(d.position),
  };
}

/** Starting scene for a shot with no blockout yet. */
export function createDefaultShotState(
  shot: ShotMeta,
  characters: Array<{ id: string; name: string }>,
): EditorShotState {
  const cameraNodeId = "shot-camera";
  const count = characters.length;
  const mannequins: BlockoutNode[] = characters.map((c, i) => ({
    id: newNodeId("mannequin"),
    kind: "mannequin",
    name: c.name,
    entityId: c.id,
    pose: "standing",
    transform: blockoutTransform([(i - (count - 1) / 2) * 1.2, 0, 0]),
  }));
  return {
    cameraNodeId,
    lensMm: shot.lensMm ?? DEFAULT_LENS_MM,
    tracks: {},
    nodes: [
      { id: "ground", kind: "ground", name: "Ground", transform: blockoutTransform() },
      {
        id: "set-back-wall",
        kind: "set",
        name: "Back wall",
        transform: blockoutTransform([0, 0, -4], [0, 0, 0], [10, 3, 0.2]),
      },
      { ...createLight("key"), id: "light-key" },
      { ...createLight("fill"), id: "light-fill" },
      { ...createLight("back"), id: "light-back" },
      {
        id: cameraNodeId,
        kind: "camera",
        name: "Shot camera",
        transform: blockoutTransform([0, 1.6, 6], [-0.05, 0, 0]),
      },
      ...mannequins,
    ],
  };
}

export function stateFromShot(shot: BlockoutShot, tracks: BlockoutTracks): EditorShotState {
  return {
    nodes: shot.scene.nodes,
    cameraNodeId: shot.camera.nodeId,
    tracks,
    lensMm: shot.lensMm,
    ...(shot.guides ? { guides: shot.guides } : {}),
  };
}

export function hasKeyframes(tracks: BlockoutTracks, nodeId: string): boolean {
  return (tracks[nodeId]?.length ?? 0) > 0;
}

export function upsertKeyframe(
  tracks: BlockoutTracks,
  nodeId: string,
  t: number,
  transform: BlockoutTransform,
): BlockoutTracks {
  const k: BlockoutKeyframe = { t, ...transform };
  return { ...tracks, [nodeId]: normalizeKeyframes([...(tracks[nodeId] ?? []), k]) };
}

export function removeKeyframe(tracks: BlockoutTracks, nodeId: string, t: number): BlockoutTracks {
  const rest = (tracks[nodeId] ?? []).filter((k) => Math.abs(k.t - t) > 1e-3);
  const next = { ...tracks };
  if (rest.length) next[nodeId] = rest;
  else delete next[nodeId];
  return next;
}

export function keyframeAt(tracks: BlockoutTracks, nodeId: string, t: number): BlockoutKeyframe | undefined {
  return tracks[nodeId]?.find((k) => Math.abs(k.t - t) <= 1e-3);
}

/**
 * Apply a transform edit at time `t`: animated nodes get a keyframe at the
 * playhead (auto-key); static nodes change their base transform.
 */
export function applyTransformEdit(
  state: EditorShotState,
  nodeId: string,
  t: number,
  transform: BlockoutTransform,
): EditorShotState {
  if (hasKeyframes(state.tracks, nodeId)) {
    return { ...state, tracks: upsertKeyframe(state.tracks, nodeId, t, transform) };
  }
  return {
    ...state,
    nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, transform } : n)),
  };
}

export function snapToFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

export function formatTimecode(t: number, fps: number): string {
  const totalFrames = Math.round(t * fps);
  const f = Math.max(1, Math.round(fps));
  const frames = totalFrames % f;
  const totalSec = Math.floor(totalFrames / f);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(totalSec / 3600))}:${pad(Math.floor(totalSec / 60) % 60)}:${pad(totalSec % 60)}:${pad(frames)}`;
}

/** Build the single-shot document the editor saves. */
export function buildEditorDocument(
  project: BlockoutProject,
  scene: { id: string; order: number; heading?: string },
  shot: ShotMeta,
  state: EditorShotState,
): BlockoutDocument {
  const finalized = finalizeShot(
    {
      id: shot._id,
      sceneId: shot.sceneId,
      order: shot.order,
      durationSec: shot.durationSec,
      shotType: shot.shotType,
      lensMm: state.lensMm,
      characterIds: shot.characterIds,
      ...(shot.cameraMove ? { cameraMove: shot.cameraMove } : {}),
      ...(shot.dialogue ? { dialogue: shot.dialogue } : {}),
      ...(shot.notes ? { notes: shot.notes } : {}),
      ...(shot.keyframeAssetId ? { keyframeImage: { assetId: shot.keyframeAssetId } } : {}),
      camera: { nodeId: state.cameraNodeId },
      scene: { nodes: state.nodes },
      ...(state.guides ? { guides: state.guides } : {}),
    },
    state.tracks,
    project.fps,
  );
  return singleShotDocument(project, scene, finalized);
}
