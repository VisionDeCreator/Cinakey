import {
  ASPECT_DIMS,
  BLOCKOUT_EASES,
  BLOCKOUT_LIGHT_ROLES,
  BLOCKOUT_OBJECT_TYPES,
  BLOCKOUT_READABLE_SCHEMAS,
  BLOCKOUT_SCHEMA_ID,
  BLOCKOUT_SCHEMA_V1,
  type BlockoutCameraKey,
  type BlockoutDocument,
  type BlockoutDocumentV1,
  type BlockoutEase,
  type BlockoutLightRole,
  type BlockoutObject,
  type BlockoutObjectType,
} from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber);
}

function isVec2(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && v.every(isFiniteNumber);
}

/** One-line validation for import (matches reference HTML checks). */
export function validateBlockoutDocument(value: unknown): string | null {
  if (!isRecord(value)) return "Not an object";
  if (
    typeof value.schema !== "string" ||
    !BLOCKOUT_READABLE_SCHEMAS.includes(value.schema)
  ) {
    return `Unsupported schema ${String(value.schema)}`;
  }
  if (value.schema === BLOCKOUT_SCHEMA_V1) {
    return validateV1(value);
  }
  return validateV2(value);
}

function validateV2(value: Record<string, unknown>): string | null {
  if (!isFiniteNumber(value.version)) return "version missing";
  const project = value.project;
  if (
    !isRecord(project) ||
    typeof project.id !== "string" ||
    typeof project.title !== "string" ||
    typeof project.aspectRatio !== "string" ||
    !isFiniteNumber(project.fps) ||
    project.fps <= 0
  ) {
    return "project invalid";
  }
  if (!isFiniteNumber(value.fps) || value.fps <= 0) return "fps missing";
  if (!isFiniteNumber(value.frames) || value.frames <= 0)
    return "frames missing";
  if (typeof value.aspect !== "string") return "aspect missing";
  if (typeof value.name !== "string") return "name missing";

  const camera = value.camera;
  if (!isRecord(camera) || !Array.isArray(camera.keys)) {
    return "Missing fields. A shot needs fps, frames, camera.keys and objects.";
  }
  if (!isFiniteNumber(camera.sensor) || camera.sensor <= 0) {
    return "camera.sensor invalid";
  }
  for (const [i, k] of camera.keys.entries()) {
    const err = cameraKeyError(k, i);
    if (err) return err;
  }
  if (!Array.isArray(value.objects)) {
    return "Missing fields. A shot needs fps, frames, camera.keys and objects.";
  }
  for (const [i, o] of value.objects.entries()) {
    const err = objectError(o, i);
    if (err) return err;
  }
  if (value.shots !== undefined && !Array.isArray(value.shots)) {
    return "shots invalid";
  }
  return null;
}

function cameraKeyError(k: unknown, i: number): string | null {
  if (!isRecord(k)) return `camera.keys[${i}] invalid`;
  if (!isFiniteNumber(k.f)) return `camera.keys[${i}].f missing`;
  if (!isVec3(k.pos)) return `camera.keys[${i}].pos invalid`;
  if (!isVec3(k.target)) return `camera.keys[${i}].target invalid`;
  if (!isFiniteNumber(k.focal)) return `camera.keys[${i}].focal invalid`;
  if (
    k.ease !== undefined &&
    !BLOCKOUT_EASES.includes(k.ease as BlockoutEase)
  ) {
    return `camera.keys[${i}].ease invalid`;
  }
  return null;
}

function objectError(o: unknown, i: number): string | null {
  if (!isRecord(o)) return `objects[${i}] invalid`;
  if (typeof o.id !== "string") return `objects[${i}].id missing`;
  if (
    typeof o.type !== "string" ||
    !BLOCKOUT_OBJECT_TYPES.includes(o.type as BlockoutObjectType)
  ) {
    return `objects[${i}].type invalid`;
  }
  if (typeof o.name !== "string") return `objects[${i}].name missing`;
  if (!isVec3(o.size)) return `objects[${i}].size invalid`;
  if (!isVec2(o.pos)) return `objects[${i}].pos invalid`;
  if (!isFiniteNumber(o.rot)) return `objects[${i}].rot invalid`;
  if (!Array.isArray(o.keys)) return `objects[${i}].keys missing`;
  return null;
}

function validateV1(value: Record<string, unknown>): string | null {
  if (!isFiniteNumber(value.version)) return "version missing";
  const project = value.project;
  if (
    !isRecord(project) ||
    typeof project.id !== "string" ||
    typeof project.title !== "string" ||
    typeof project.aspectRatio !== "string" ||
    !isFiniteNumber(project.fps) ||
    project.fps <= 0
  ) {
    return "project invalid";
  }
  if (!Array.isArray(value.scenes)) return "scenes missing";
  for (const [si, scene] of value.scenes.entries()) {
    if (
      !isRecord(scene) ||
      typeof scene.id !== "string" ||
      !isFiniteNumber(scene.order) ||
      !Array.isArray(scene.shots)
    ) {
      return `scenes[${si}] invalid`;
    }
  }
  return null;
}

export function isBlockoutDocument(value: unknown): value is BlockoutDocument {
  return (
    validateBlockoutDocument(value) === null &&
    isRecord(value) &&
    value.schema === BLOCKOUT_SCHEMA_ID
  );
}

export function isBlockoutDocumentV1(
  value: unknown,
): value is BlockoutDocumentV1 {
  return (
    validateBlockoutDocument(value) === null &&
    isRecord(value) &&
    value.schema === BLOCKOUT_SCHEMA_V1
  );
}

export function assertBlockoutDocument(value: unknown): BlockoutDocument {
  const err = validateBlockoutDocument(value);
  if (err !== null) {
    throw new Error(`Invalid cinakey.blockout document: ${err}`);
  }
  if (!isRecord(value) || value.schema !== BLOCKOUT_SCHEMA_ID) {
    throw new Error("Expected cinakey.blockout/2.0 (call migrateToV2 first)");
  }
  return value as BlockoutDocument;
}

/** Normalize a parsed JSON blob into a usable v2 document (fill defaults). */
export function normalizeImportedDocument(
  raw: unknown,
  uid = () => `id${Math.random().toString(36).slice(2, 8)}`,
): { doc: BlockoutDocument; error: string | null } {
  if (!isRecord(raw)) {
    return { doc: emptyPartDocument(), error: "That is not valid JSON" };
  }
  // Accept reference HTML shape (no schema) or our schemas
  if (!raw.schema) {
    const ok =
      isRecord(raw.camera) &&
      Array.isArray(raw.camera.keys) &&
      Array.isArray(raw.objects) &&
      isFiniteNumber(raw.fps) &&
      raw.fps > 0 &&
      isFiniteNumber(raw.frames) &&
      raw.frames > 0;
    if (!ok) {
      return {
        doc: emptyPartDocument(),
        error:
          "Missing fields. A shot needs fps, frames, camera.keys and objects.",
      };
    }
    const aspect =
      typeof raw.aspect === "string" && ASPECT_DIMS[raw.aspect]
        ? raw.aspect
        : "16:9";
    const camera = raw.camera as Record<string, unknown>;
    const keys = (camera.keys as unknown[]).map((k, i) =>
      normalizeCamKey(k, uid, i),
    );
    const objects = (raw.objects as unknown[]).map((o, i) =>
      normalizeObj(o, uid, i),
    );
    const fps = raw.fps as number;
    const doc: BlockoutDocument = {
      schema: BLOCKOUT_SCHEMA_ID,
      version: 1,
      project: {
        id: "import",
        title: typeof raw.title === "string" ? raw.title : "Imported",
        aspectRatio: aspect,
        fps,
      },
      name: typeof raw.name === "string" ? raw.name : "SHOT",
      title: typeof raw.title === "string" ? raw.title : undefined,
      fps,
      frames: raw.frames as number,
      aspect,
      camera: {
        sensor: isFiniteNumber(camera.sensor) ? camera.sensor : 36,
        keys,
      },
      objects,
      env: isRecord(raw.env) ? (raw.env as BlockoutDocument["env"]) : undefined,
      shots: Array.isArray(raw.shots)
        ? (raw.shots as BlockoutDocument["shots"])
        : [],
    };
    return { doc, error: null };
  }

  const err = validateBlockoutDocument(raw);
  if (err) return { doc: emptyPartDocument(), error: err };
  if (raw.schema === BLOCKOUT_SCHEMA_V1) {
    return {
      doc: emptyPartDocument(),
      error: "Legacy 1.0 file — open via migrateToV2",
    };
  }
  return { doc: raw as BlockoutDocument, error: null };
}

function normalizeCamKey(
  k: unknown,
  uid: () => string,
  i: number,
): BlockoutCameraKey {
  const r = isRecord(k) ? k : {};
  return {
    id: typeof r.id === "string" ? r.id : uid(),
    f: isFiniteNumber(r.f) ? r.f : i,
    pos: isVec3(r.pos) ? r.pos : [0, 1.6, 6],
    target: isVec3(r.target) ? r.target : [0, 1.4, 0],
    focal: isFiniteNumber(r.focal) ? r.focal : 35,
    roll: isFiniteNumber(r.roll) ? r.roll : 0,
    ease: BLOCKOUT_EASES.includes(r.ease as BlockoutEase)
      ? (r.ease as BlockoutEase)
      : "inOut",
  };
}

function normalizeObj(
  o: unknown,
  uid: () => string,
  i: number,
): BlockoutObject {
  const r = isRecord(o) ? o : {};
  const type = BLOCKOUT_OBJECT_TYPES.includes(r.type as BlockoutObjectType)
    ? (r.type as BlockoutObjectType)
    : "box";
  return {
    id: typeof r.id === "string" ? r.id : uid(),
    type,
    name: typeof r.name === "string" ? r.name : `Object ${i + 1}`,
    color: typeof r.color === "string" ? r.color : "#9aa0a8",
    size: isVec3(r.size) ? r.size : [1, 1, 1],
    pos: isVec2(r.pos) ? r.pos : [0, 0],
    y: isFiniteNumber(r.y) ? r.y : undefined,
    rot: isFiniteNumber(r.rot) ? r.rot : 0,
    keys: Array.isArray(r.keys)
      ? r.keys.filter(isRecord).map((k) => ({
          f: isFiniteNumber(k.f) ? k.f : 0,
          x: isFiniteNumber(k.x) ? k.x : 0,
          z: isFiniteNumber(k.z) ? k.z : 0,
          y: isFiniteNumber(k.y) ? k.y : undefined,
          rot: isFiniteNumber(k.rot) ? k.rot : 0,
          ease: BLOCKOUT_EASES.includes(k.ease as BlockoutEase)
            ? (k.ease as BlockoutEase)
            : "inOut",
        }))
      : [],
    entityId: typeof r.entityId === "string" ? r.entityId : undefined,
    lightRole: BLOCKOUT_LIGHT_ROLES.includes(r.lightRole as BlockoutLightRole)
      ? (r.lightRole as BlockoutLightRole)
      : undefined,
    intensity: isFiniteNumber(r.intensity) ? r.intensity : undefined,
    glow: r.glow === true ? true : undefined,
    label: r.label === false ? false : undefined,
  };
}

export function emptyPartDocument(
  project?: BlockoutDocument["project"],
  sequenceId?: string,
): BlockoutDocument {
  const fps = project?.fps ?? 24;
  const aspect = project?.aspectRatio ?? "16:9";
  return {
    schema: BLOCKOUT_SCHEMA_ID,
    version: 1,
    project: project ?? {
      id: "p",
      title: "Untitled",
      aspectRatio: aspect,
      fps,
    },
    sequenceId,
    name: "Part",
    fps,
    frames: Math.round(6 * fps),
    aspect,
    camera: {
      sensor: 36,
      keys: [
        {
          id: "k0",
          f: 0,
          pos: [0, 1.6, 6],
          target: [0, 1.4, 0],
          focal: 35,
          roll: 0,
          ease: "inOut",
        },
      ],
    },
    objects: [],
    env: {},
    shots: [],
  };
}
