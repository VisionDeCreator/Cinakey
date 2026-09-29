/**
 * 3D blockout document (cinakey.blockout/2.0).
 *
 * One part-scoped document per sequence (script part ≤ Seedance max duration).
 * Animation is evaluated by the pure blockout engine (no Theatre.js).
 * Readers still accept cinakey.blockout/1.0 via migrateToV2.
 */

export const BLOCKOUT_SCHEMA_V1 = "cinakey.blockout/1.0" as const;
export const BLOCKOUT_SCHEMA_ID = "cinakey.blockout/2.0" as const;

/** Schema ids this build can read. */
export const BLOCKOUT_READABLE_SCHEMAS: readonly string[] = [
  BLOCKOUT_SCHEMA_V1,
  BLOCKOUT_SCHEMA_ID,
];

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export type BlockoutEase = "linear" | "in" | "out" | "inOut" | "hold";

export const BLOCKOUT_EASES: readonly BlockoutEase[] = [
  "linear",
  "in",
  "out",
  "inOut",
  "hold",
];

export type BlockoutObjectType =
  | "character"
  | "creature"
  | "box"
  | "chair"
  | "table"
  | "door"
  | "car"
  | "wall"
  | "column"
  | "tree"
  | "sphere"
  | "fire"
  | "strip"
  | "mark"
  | "hare"
  | "raptor"
  | "light";

export const BLOCKOUT_OBJECT_TYPES: readonly BlockoutObjectType[] = [
  "character",
  "creature",
  "box",
  "chair",
  "table",
  "door",
  "car",
  "wall",
  "column",
  "tree",
  "sphere",
  "fire",
  "strip",
  "mark",
  "hare",
  "raptor",
  "light",
];

export type BlockoutLightRole = "key" | "fill" | "back" | "sun";

export const BLOCKOUT_LIGHT_ROLES: readonly BlockoutLightRole[] = [
  "key",
  "fill",
  "back",
  "sun",
];

export type BlockoutCameraKey = {
  id: string;
  /** Frame index from part start. */
  f: number;
  pos: Vec3;
  target: Vec3;
  focal: number;
  roll: number;
  ease: BlockoutEase;
};

export type BlockoutObjectKey = {
  f: number;
  x: number;
  z: number;
  /** Lift (y). Defaults to object.y when omitted. */
  y?: number;
  rot: number;
  ease: BlockoutEase;
};

export type BlockoutObject = {
  id: string;
  type: BlockoutObjectType;
  name: string;
  color: string;
  /** Width, height, depth in metres. */
  size: Vec3;
  /** Ground position [x, z]. */
  pos: Vec2;
  /** Lift (y) when static / base. */
  y?: number;
  /** Facing degrees (y-rotation). */
  rot: number;
  keys: BlockoutObjectKey[];
  entityId?: string;
  lightRole?: BlockoutLightRole;
  intensity?: number;
  color2?: string;
  label?: boolean;
  glow?: boolean;
};

export type BlockoutCutMarker = {
  n: number;
  start: number;
  end: number;
  desc: string;
  shotType?: string;
  shotId?: string;
  sceneHeading?: string;
  lensMm?: number;
  cameraMove?: string;
};

export type BlockoutEnv = {
  sky?: string;
  ground?: boolean;
  groundColor?: string;
  fog?: boolean;
  fogNear?: number;
  fogFar?: number;
};

export type BlockoutGuidesByShot = Record<
  string,
  { keyframeAssetId?: string; depthAssetId?: string }
>;

export type BlockoutProject = {
  id: string;
  title: string;
  aspectRatio: string;
  fps: number;
};

/** Part-scoped blockout document (schema 2.0). */
export type BlockoutDocument = {
  schema: typeof BLOCKOUT_SCHEMA_ID;
  version: number;
  parentFileId?: string;
  exportedAt?: string;
  project: BlockoutProject;
  sequenceId?: string;
  name: string;
  title?: string;
  fps: number;
  frames: number;
  aspect: string;
  camera: {
    sensor: number;
    keys: BlockoutCameraKey[];
  };
  objects: BlockoutObject[];
  env?: BlockoutEnv;
  /** Script shot cut markers (frame indices). */
  shots: BlockoutCutMarker[];
  guides?: BlockoutGuidesByShot;
  /** Freeform director / import notes. */
  notes?: string;
};

// ---------------------------------------------------------------------------
// Legacy 1.0 types (for migration only)
// ---------------------------------------------------------------------------

export type BlockoutTransform = {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

export type BlockoutNodeKind =
  "ground" | "set" | "mannequin" | "prop" | "light" | "camera";

export type MannequinPose = "standing" | "sitting" | "walking";
export type BlockoutPropType = "box" | "chair" | "table" | "door" | "car";

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

export type BlockoutNode = {
  id: string;
  kind: BlockoutNodeKind;
  name: string;
  transform: BlockoutTransform;
  propType?: BlockoutPropType;
  lightRole?: "key" | "fill" | "back";
  pose?: MannequinPose;
  entityId?: string;
  action?: string;
  color?: string;
  intensity?: number;
};

export type BlockoutKeyframe = {
  t: number;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

export type BlockoutTracks = Record<string, BlockoutKeyframe[]>;

export type BlockoutCharacter = {
  id: string;
  name?: string;
  nodeId: string;
  pose: MannequinPose;
  action?: string;
  position: Vec3;
  keyframes: BlockoutKeyframe[];
};

export type BlockoutTheatre = {
  sheetId: string;
  projectState: unknown;
};

export type BlockoutShotV1 = {
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

export type BlockoutSceneV1 = {
  id: string;
  order: number;
  heading?: string;
  shots: BlockoutShotV1[];
};

/** Legacy per-shot / merged document. */
export type BlockoutDocumentV1 = {
  schema: typeof BLOCKOUT_SCHEMA_V1;
  version: number;
  parentFileId?: string;
  exportedAt?: string;
  project: BlockoutProject;
  scenes: BlockoutSceneV1[];
};

/** @deprecated Use BlockoutShotV1; kept for gradual migration of callers. */
export type BlockoutShot = BlockoutShotV1;
/** @deprecated Use BlockoutSceneV1 */
export type BlockoutScene = BlockoutSceneV1;

export const ASPECT_DIMS: Record<string, [number, number]> = {
  "16:9": [1280, 720],
  "9:16": [720, 1280],
  "21:9": [1680, 720],
  "4:3": [960, 720],
  "1:1": [720, 720],
};

export const LENS_CHIPS_MM = [14, 18, 24, 35, 50, 85, 135] as const;

export const DEFAULT_OBJECT_DEFS: Record<
  Exclude<BlockoutObjectType, "light" | "creature">,
  { label: string; size: Vec3; color: string }
> = {
  character: { label: "Character", size: [0.5, 1.75, 0.5], color: "#8cbf7a" },
  box: { label: "Box", size: [1.2, 1, 1.2], color: "#9aa0a8" },
  chair: { label: "Chair", size: [0.5, 0.9, 0.5], color: "#9aa0a8" },
  table: { label: "Table", size: [1.2, 0.75, 0.8], color: "#9aa0a8" },
  door: { label: "Door", size: [1, 2.1, 0.1], color: "#9aa0a8" },
  wall: { label: "Wall", size: [4, 2.4, 0.2], color: "#9aa0a8" },
  column: { label: "Column", size: [0.6, 3, 0.6], color: "#9aa0a8" },
  car: { label: "Car", size: [1.8, 1.45, 4.4], color: "#6aa3c8" },
  hare: { label: "Hare", size: [0.7, 2.7, 1.9], color: "#cdb48f" },
  raptor: { label: "Raptor", size: [0.8, 1.9, 3.6], color: "#33363b" },
  tree: { label: "Tree", size: [0.7, 9, 5], color: "#4a4e55" },
  sphere: { label: "Sphere", size: [0.5, 0.5, 0.5], color: "#d2d5da" },
  fire: { label: "Campfire", size: [0.5, 0.6, 0.5], color: "#e8772e" },
  strip: { label: "Path strip", size: [3, 0.02, 8], color: "#565a61" },
  mark: { label: "Mark", size: [0.6, 0.02, 0.6], color: "#c9a44f" },
};

export const CAMERA_MOVE_PRESETS = [
  ["static", "Locked off"],
  ["push", "Push in"],
  ["pull", "Pull out"],
  ["truck", "Truck L → R"],
  ["orbit", "Orbit 90°"],
  ["crane", "Crane up"],
  ["dzoom", "Dolly zoom"],
  ["dutch", "Dutch tilt"],
] as const;

export type CameraMovePresetId = (typeof CAMERA_MOVE_PRESETS)[number][0];
