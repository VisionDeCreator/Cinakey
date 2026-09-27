/**
 * 3D blockout document (cinakey.blockout/1.0).
 *
 * One shape serves both storage and export: a per-shot save is a document
 * with one scene holding one shot; scene/project exports merge several shot
 * documents. The authoritative rebuild inputs are `scene.nodes` (declarative
 * three.js scene graph) and `theatre.projectState` (Theatre.js save format);
 * `camera` and `characters` are denormalized summaries for readers that do
 * not run Theatre (e.g. generation prompts).
 */

export const BLOCKOUT_SCHEMA_ID = "cinakey.blockout/1.0" as const;

/** Schema ids this build can read. Minor versions must stay additive. */
export const BLOCKOUT_READABLE_SCHEMAS: readonly string[] = [BLOCKOUT_SCHEMA_ID];

export const BLOCKOUT_THEATRE_SHEET_ID = "Shot";
export const THEATRE_DEFINITION_VERSION = "0.4.0";

export type Vec3 = [number, number, number];

export type BlockoutTransform = {
  position: Vec3;
  /** Euler XYZ, radians. */
  rotation: Vec3;
  scale: Vec3;
};

export type BlockoutNodeKind =
  | "ground"
  | "set"
  | "mannequin"
  | "prop"
  | "light"
  | "camera";

export type MannequinPose = "standing" | "sitting" | "walking";
export type BlockoutPropType = "box" | "chair" | "table" | "door" | "car";
export type BlockoutLightRole = "key" | "fill" | "back";

export const BLOCKOUT_NODE_KINDS: readonly BlockoutNodeKind[] = [
  "ground",
  "set",
  "mannequin",
  "prop",
  "light",
  "camera",
];
export const MANNEQUIN_POSES: readonly MannequinPose[] = [
  "standing",
  "sitting",
  "walking",
];
export const BLOCKOUT_PROP_TYPES: readonly BlockoutPropType[] = [
  "box",
  "chair",
  "table",
  "door",
  "car",
];
export const BLOCKOUT_LIGHT_ROLES: readonly BlockoutLightRole[] = [
  "key",
  "fill",
  "back",
];

export type BlockoutNode = {
  id: string;
  kind: BlockoutNodeKind;
  name: string;
  /** Base (un-animated) transform. */
  transform: BlockoutTransform;
  propType?: BlockoutPropType;
  lightRole?: BlockoutLightRole;
  pose?: MannequinPose;
  /** Character entity id (mannequins). */
  entityId?: string;
  /** Free-text action for mannequins, e.g. "walks to the door". */
  action?: string;
  /** CSS hex colour. */
  color?: string;
  /** Light intensity. */
  intensity?: number;
};

export type BlockoutKeyframe = {
  /** Seconds from shot start. */
  t: number;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

/** Animation tracks keyed by node id (editor-facing form of Theatre state). */
export type BlockoutTracks = Record<string, BlockoutKeyframe[]>;

export type BlockoutCharacter = {
  /** Character entity id. */
  id: string;
  name?: string;
  nodeId: string;
  pose: MannequinPose;
  action?: string;
  /** Base position. */
  position: Vec3;
  keyframes: BlockoutKeyframe[];
};

export type BlockoutTheatre = {
  sheetId: string;
  /** Theatre.js project save payload (definitionVersion 0.4.0). */
  projectState: unknown;
};

export type BlockoutShot = {
  id: string;
  sceneId: string;
  order: number;
  durationSec: number;
  shotType: string;
  lensMm: number;
  cameraMove?: string;
  dialogue?: string;
  notes?: string;
  characterIds: string[];
  keyframeImage?: { assetId: string };
  camera: {
    nodeId: string;
    lensMm: number;
    keyframes: BlockoutKeyframe[];
  };
  characters: BlockoutCharacter[];
  scene: {
    nodes: BlockoutNode[];
    background?: string;
  };
  theatre: BlockoutTheatre;
  guides?: {
    keyframeAssetId?: string;
    depthAssetId?: string;
  };
};

export type BlockoutScene = {
  id: string;
  order: number;
  heading?: string;
  shots: BlockoutShot[];
};

export type BlockoutProject = {
  id: string;
  title: string;
  aspectRatio: string;
  fps: number;
};

export type BlockoutDocument = {
  schema: typeof BLOCKOUT_SCHEMA_ID;
  /** Save counter for the stored per-shot file. */
  version: number;
  /** Previous blockout storage id (version chain). */
  parentFileId?: string;
  exportedAt?: string;
  project: BlockoutProject;
  scenes: BlockoutScene[];
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber);
}

function isTransform(v: unknown): v is BlockoutTransform {
  return (
    isRecord(v) && isVec3(v.position) && isVec3(v.rotation) && isVec3(v.scale)
  );
}

function isKeyframe(v: unknown): v is BlockoutKeyframe {
  return (
    isRecord(v) &&
    isFiniteNumber(v.t) &&
    isVec3(v.position) &&
    isVec3(v.rotation) &&
    isVec3(v.scale)
  );
}

function nodeError(node: unknown, i: number): string | null {
  if (!isRecord(node)) return `nodes[${i}] is not an object`;
  if (typeof node.id !== "string" || node.id.length === 0)
    return `nodes[${i}].id missing`;
  if (!BLOCKOUT_NODE_KINDS.includes(node.kind as BlockoutNodeKind))
    return `nodes[${i}].kind invalid`;
  if (typeof node.name !== "string") return `nodes[${i}].name missing`;
  if (!isTransform(node.transform)) return `nodes[${i}].transform invalid`;
  if (
    node.pose !== undefined &&
    !MANNEQUIN_POSES.includes(node.pose as MannequinPose)
  )
    return `nodes[${i}].pose invalid`;
  if (
    node.propType !== undefined &&
    !BLOCKOUT_PROP_TYPES.includes(node.propType as BlockoutPropType)
  )
    return `nodes[${i}].propType invalid`;
  if (
    node.lightRole !== undefined &&
    !BLOCKOUT_LIGHT_ROLES.includes(node.lightRole as BlockoutLightRole)
  )
    return `nodes[${i}].lightRole invalid`;
  return null;
}

function shotError(shot: unknown, path: string): string | null {
  if (!isRecord(shot)) return `${path} is not an object`;
  if (typeof shot.id !== "string") return `${path}.id missing`;
  if (typeof shot.sceneId !== "string") return `${path}.sceneId missing`;
  if (!isFiniteNumber(shot.order)) return `${path}.order missing`;
  if (!isFiniteNumber(shot.durationSec) || shot.durationSec <= 0)
    return `${path}.durationSec invalid`;
  if (typeof shot.shotType !== "string") return `${path}.shotType missing`;
  if (!isFiniteNumber(shot.lensMm) || shot.lensMm <= 0)
    return `${path}.lensMm invalid`;
  if (!Array.isArray(shot.characterIds))
    return `${path}.characterIds missing`;
  const camera = shot.camera;
  if (
    !isRecord(camera) ||
    typeof camera.nodeId !== "string" ||
    !isFiniteNumber(camera.lensMm) ||
    !Array.isArray(camera.keyframes) ||
    !camera.keyframes.every(isKeyframe)
  )
    return `${path}.camera invalid`;
  if (!Array.isArray(shot.characters)) return `${path}.characters missing`;
  for (const [i, c] of shot.characters.entries()) {
    if (
      !isRecord(c) ||
      typeof c.id !== "string" ||
      typeof c.nodeId !== "string" ||
      !isVec3(c.position) ||
      !Array.isArray(c.keyframes)
    )
      return `${path}.characters[${i}] invalid`;
  }
  const scene = shot.scene;
  if (!isRecord(scene) || !Array.isArray(scene.nodes))
    return `${path}.scene.nodes missing`;
  const ids = new Set<string>();
  for (const [i, n] of scene.nodes.entries()) {
    const err = nodeError(n, i);
    if (err) return `${path}.scene.${err}`;
    const id = (n as BlockoutNode).id;
    if (ids.has(id)) return `${path}.scene.nodes duplicate id ${id}`;
    ids.add(id);
  }
  if (!ids.has(camera.nodeId as string))
    return `${path}.camera.nodeId not in scene`;
  const theatre = shot.theatre;
  if (
    !isRecord(theatre) ||
    typeof theatre.sheetId !== "string" ||
    !isRecord(theatre.projectState)
  )
    return `${path}.theatre invalid`;
  return null;
}

/** Returns a human-readable reason, or null when the document is valid. */
export function validateBlockoutDocument(value: unknown): string | null {
  if (!isRecord(value)) return "Not an object";
  if (
    typeof value.schema !== "string" ||
    !BLOCKOUT_READABLE_SCHEMAS.includes(value.schema)
  )
    return `Unsupported schema ${String(value.schema)}`;
  if (!isFiniteNumber(value.version)) return "version missing";
  const project = value.project;
  if (
    !isRecord(project) ||
    typeof project.id !== "string" ||
    typeof project.title !== "string" ||
    typeof project.aspectRatio !== "string" ||
    !isFiniteNumber(project.fps) ||
    project.fps <= 0
  )
    return "project invalid";
  if (!Array.isArray(value.scenes)) return "scenes missing";
  for (const [si, scene] of value.scenes.entries()) {
    if (
      !isRecord(scene) ||
      typeof scene.id !== "string" ||
      !isFiniteNumber(scene.order) ||
      !Array.isArray(scene.shots)
    )
      return `scenes[${si}] invalid`;
    for (const [hi, shot] of scene.shots.entries()) {
      const err = shotError(shot, `scenes[${si}].shots[${hi}]`);
      if (err) return err;
    }
  }
  return null;
}

export function isBlockoutDocument(value: unknown): value is BlockoutDocument {
  return validateBlockoutDocument(value) === null;
}

export function assertBlockoutDocument(value: unknown): BlockoutDocument {
  const err = validateBlockoutDocument(value);
  if (err !== null) {
    throw new Error(`Invalid cinakey.blockout/1.0 document: ${err}`);
  }
  return value as BlockoutDocument;
}

// ---------------------------------------------------------------------------
// Theatre.js state <-> tracks
// ---------------------------------------------------------------------------

type TheatreKeyframe = {
  id: string;
  position: number;
  value: number;
  handles: [number, number, number, number];
  connectedRight: boolean;
  type: "bezier";
};

type TheatreTrack = {
  type: "BasicKeyframedTrack";
  __debugName: string;
  keyframes: TheatreKeyframe[];
};

type TheatreObjectTracks = {
  trackData: Record<string, TheatreTrack>;
  trackIdByPropPath: Record<string, string>;
};

export type TheatreProjectState = {
  sheetsById: Record<
    string,
    {
      staticOverrides: { byObject: Record<string, unknown> };
      sequence: {
        type: "PositionalSequence";
        length: number;
        subUnitsPerUnit: number;
        tracksByObject: Record<string, TheatreObjectTracks>;
      };
    }
  >;
  definitionVersion: string;
  revisionHistory: string[];
};

const TRANSFORM_PROPS = ["position", "rotation", "scale"] as const;
const AXES = ["x", "y", "z"] as const;
const EASE_IN_OUT: [number, number, number, number] = [0.5, 1, 0.5, 0];

function roundTime(t: number): number {
  return Math.round(t * 1000) / 1000;
}

/** Sort keyframes and collapse duplicates at the same time (last wins). */
export function normalizeKeyframes(keyframes: BlockoutKeyframe[]): BlockoutKeyframe[] {
  const byTime = new Map<number, BlockoutKeyframe>();
  for (const k of keyframes) byTime.set(roundTime(k.t), { ...k, t: roundTime(k.t) });
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

export function buildTheatreProjectState(input: {
  tracks: BlockoutTracks;
  durationSec: number;
  fps: number;
  sheetId?: string;
}): TheatreProjectState {
  const sheetId = input.sheetId ?? BLOCKOUT_THEATRE_SHEET_ID;
  const tracksByObject: Record<string, TheatreObjectTracks> = {};
  for (const [nodeId, raw] of Object.entries(input.tracks)) {
    const keyframes = normalizeKeyframes(raw);
    if (keyframes.length === 0) continue;
    const obj: TheatreObjectTracks = { trackData: {}, trackIdByPropPath: {} };
    for (const prop of TRANSFORM_PROPS) {
      AXES.forEach((axis, ai) => {
        const trackId = `${nodeId}.${prop}.${axis}`;
        obj.trackIdByPropPath[JSON.stringify([prop, axis])] = trackId;
        obj.trackData[trackId] = {
          type: "BasicKeyframedTrack",
          __debugName: `${nodeId}:["${prop}","${axis}"]`,
          keyframes: keyframes.map((k, ki) => ({
            id: `${trackId}.${ki}`,
            position: k.t,
            value: k[prop][ai]!,
            handles: [...EASE_IN_OUT],
            connectedRight: true,
            type: "bezier",
          })),
        };
      });
    }
    tracksByObject[nodeId] = obj;
  }
  return {
    sheetsById: {
      [sheetId]: {
        staticOverrides: { byObject: {} },
        sequence: {
          type: "PositionalSequence",
          length: input.durationSec,
          subUnitsPerUnit: Math.max(1, Math.round(input.fps)),
          tracksByObject,
        },
      },
    },
    definitionVersion: THEATRE_DEFINITION_VERSION,
    revisionHistory: [],
  };
}

/**
 * Read transform keyframes back out of a Theatre project state. Components
 * without a track at a keyframe time fall back to the node's base transform.
 */
export function readTheatreTracks(
  projectState: unknown,
  nodes: BlockoutNode[],
  sheetId: string = BLOCKOUT_THEATRE_SHEET_ID,
): BlockoutTracks {
  const tracks: BlockoutTracks = {};
  if (!isRecord(projectState) || !isRecord(projectState.sheetsById)) return tracks;
  const sheet = projectState.sheetsById[sheetId];
  if (!isRecord(sheet) || !isRecord(sheet.sequence)) return tracks;
  const byObject = sheet.sequence.tracksByObject;
  if (!isRecord(byObject)) return tracks;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  for (const [nodeId, objTracks] of Object.entries(byObject)) {
    const node = nodeById.get(nodeId);
    if (!node || !isRecord(objTracks)) continue;
    const idByPath = objTracks.trackIdByPropPath;
    const data = objTracks.trackData;
    if (!isRecord(idByPath) || !isRecord(data)) continue;

    const channels = new Map<string, Array<{ t: number; v: number }>>();
    const times = new Set<number>();
    for (const [path, trackId] of Object.entries(idByPath)) {
      const track = typeof trackId === "string" ? data[trackId] : undefined;
      if (!isRecord(track) || !Array.isArray(track.keyframes)) continue;
      const points: Array<{ t: number; v: number }> = [];
      for (const k of track.keyframes) {
        if (isRecord(k) && isFiniteNumber(k.position) && isFiniteNumber(k.value)) {
          const t = roundTime(k.position);
          points.push({ t, v: k.value });
          times.add(t);
        }
      }
      channels.set(path, points);
    }
    if (times.size === 0) continue;

    const sample = (prop: (typeof TRANSFORM_PROPS)[number], ai: number, t: number) => {
      const points = channels.get(JSON.stringify([prop, AXES[ai]]));
      const hit = points?.find((p) => p.t === t);
      return hit ? hit.v : node.transform[prop][ai]!;
    };
    tracks[nodeId] = [...times]
      .sort((a, b) => a - b)
      .map((t) => {
        const vec = (prop: (typeof TRANSFORM_PROPS)[number]): Vec3 => [
          sample(prop, 0, t),
          sample(prop, 1, t),
          sample(prop, 2, t),
        ];
        return { t, position: vec("position"), rotation: vec("rotation"), scale: vec("scale") };
      });
  }
  return tracks;
}

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

export function blockoutTransform(
  position: Vec3 = [0, 0, 0],
  rotation: Vec3 = [0, 0, 0],
  scale: Vec3 = [1, 1, 1],
): BlockoutTransform {
  return { position, rotation, scale };
}

/** Recompute the denormalized camera/characters summaries and Theatre state. */
export function finalizeShot(
  shot: Omit<BlockoutShot, "camera" | "characters" | "theatre"> & {
    camera: { nodeId: string };
  },
  tracks: BlockoutTracks,
  fps: number,
): BlockoutShot {
  const nodeIds = new Set(shot.scene.nodes.map((n) => n.id));
  const cleanTracks: BlockoutTracks = {};
  for (const [id, ks] of Object.entries(tracks)) {
    if (!nodeIds.has(id) || ks.length === 0) continue;
    cleanTracks[id] = normalizeKeyframes(ks).filter((k) => k.t <= shot.durationSec);
  }
  const characters: BlockoutCharacter[] = shot.scene.nodes
    .filter((n) => n.kind === "mannequin")
    .map((n) => ({
      id: n.entityId ?? "",
      name: n.name,
      nodeId: n.id,
      pose: n.pose ?? "standing",
      action: n.action,
      position: n.transform.position,
      keyframes: cleanTracks[n.id] ?? [],
    }));
  return {
    ...shot,
    camera: {
      nodeId: shot.camera.nodeId,
      lensMm: shot.lensMm,
      keyframes: cleanTracks[shot.camera.nodeId] ?? [],
    },
    characters,
    theatre: {
      sheetId: BLOCKOUT_THEATRE_SHEET_ID,
      projectState: buildTheatreProjectState({
        tracks: cleanTracks,
        durationSec: shot.durationSec,
        fps,
      }),
    },
  };
}

export function tracksFromShot(shot: BlockoutShot): BlockoutTracks {
  return readTheatreTracks(shot.theatre.projectState, shot.scene.nodes, shot.theatre.sheetId);
}

export function singleShotDocument(
  project: BlockoutProject,
  scene: { id: string; order: number; heading?: string },
  shot: BlockoutShot,
  version = 1,
  parentFileId?: string,
): BlockoutDocument {
  return {
    schema: BLOCKOUT_SCHEMA_ID,
    version,
    ...(parentFileId ? { parentFileId } : {}),
    project,
    scenes: [{ ...scene, shots: [shot] }],
  };
}

export function allShots(doc: BlockoutDocument): BlockoutShot[] {
  return doc.scenes.flatMap((s) => s.shots);
}

/** Combine several (usually per-shot) documents into one export document. */
export function mergeBlockoutDocuments(
  docs: BlockoutDocument[],
  project: BlockoutProject,
): BlockoutDocument {
  const scenes = new Map<string, BlockoutScene>();
  for (const doc of docs) {
    for (const scene of doc.scenes) {
      const existing = scenes.get(scene.id);
      if (existing) {
        existing.shots.push(...scene.shots);
        existing.heading ??= scene.heading;
      } else {
        scenes.set(scene.id, { ...scene, shots: [...scene.shots] });
      }
    }
  }
  const merged = [...scenes.values()].sort((a, b) => a.order - b.order);
  for (const s of merged) s.shots.sort((a, b) => a.order - b.order);
  return {
    schema: BLOCKOUT_SCHEMA_ID,
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    scenes: merged,
  };
}

/**
 * Pick the shot to import into `target` from any blockout document: the shot
 * with the same id, else `sourceShotId`, else the only shot. The result is
 * rebound to the target's id, scene and order; its scene/animation are kept.
 */
export function extractShotForImport(
  doc: BlockoutDocument,
  target: { id: string; sceneId: string; order: number },
  sourceShotId?: string,
): BlockoutShot {
  const shots = allShots(doc);
  const picked =
    shots.find((s) => s.id === (sourceShotId ?? target.id)) ??
    (shots.length === 1 ? shots[0] : undefined);
  if (!picked) {
    throw new Error(
      shots.length === 0
        ? "The blockout file contains no shots"
        : "Choose which shot in the file to import",
    );
  }
  return { ...picked, id: target.id, sceneId: target.sceneId, order: target.order };
}
