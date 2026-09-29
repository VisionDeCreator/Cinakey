/**
 * `cinakey.staging/1.0` — a script-agnostic staging plan.
 *
 * An LLM reads any script and writes this plan (set, cast, per-shot action and
 * camera) in a small fixed vocabulary; `compileStagingPlan` turns it into a
 * part-scoped `cinakey.blockout/2.0` document deterministically.
 *
 * Conventions: metres; ground plane is x/z with y up; +x is "forward" (the
 * direction of travel when anything travels); headings are degrees where
 * 90 = facing +x, 0 = facing +z, 180 = facing -x, -90 / 270 = facing -z.
 *
 * Parsing is forgiving: unknown enum values fall back to defaults and
 * out-of-range numbers are clamped, so slightly-off model output still
 * compiles.
 */

import { z } from "zod";

export const STAGING_SCHEMA_ID = "cinakey.staging/1.0" as const;

const num = (lo: number, hi: number, fallback: number) =>
  z.coerce
    .number()
    .catch(fallback)
    .transform((v) => Math.min(hi, Math.max(lo, v)));
const xz = z
  .tuple([num(-2000, 2000, 0), num(-2000, 2000, 0)])
  .or(
    z
      .object({ x: num(-2000, 2000, 0), z: num(-2000, 2000, 0) })
      .transform((p) => [p.x, p.z] as [number, number]),
  );
const vec3 = z.tuple([num(0.02, 400, 1), num(0.02, 400, 1), num(0.02, 400, 1)]);
const id = z.string().min(1).max(64);

export const TERRAINS = [
  "open",
  "forest",
  "urban",
  "interior",
  "desert",
  "snow",
  "water",
  "mountain",
] as const;
export const TIMES_OF_DAY = [
  "day",
  "golden",
  "dusk",
  "night",
  "dawn",
  "interior",
] as const;

export const FEATURE_KINDS = [
  "tree",
  "trees",
  "rock",
  "rocks",
  "building",
  "wall",
  "floor",
  "table",
  "chair",
  "sofa",
  "bed",
  "counter",
  "door",
  "window",
  "car",
  "column",
  "box",
  "fire",
  "lamp",
  "river",
  "chasm",
  "road",
  "path",
  "bridge",
  "water",
  "sun",
  "moon",
  "mark",
] as const;

export const CARRY_STYLES = [
  "hand",
  "low",
  "back",
  "shoulder",
  "overhead",
] as const;

export const CAST_KINDS = [
  "person",
  "quadruped",
  "bird",
  "creature",
  "vehicle",
  "prop",
] as const;

export const ACTIONS = [
  "stand",
  "walk",
  "run",
  "sprint",
  "sit",
  "crouch",
  "lie",
  "jump",
  "leap",
  "fall",
  "turn",
  "look",
  "reach",
  "fire",
  "fight",
  "drive",
  "fly",
  "idle",
  "mount",
  "dismount",
] as const;

export const SHOT_SIZES = [
  "ecu",
  "cu",
  "mcu",
  "medium",
  "cowboy",
  "full",
  "wide",
  "ews",
  "insert",
] as const;
export const CAMERA_ANGLES = [
  "eye",
  "low",
  "high",
  "overhead",
  "ground",
] as const;
export const CAMERA_SIDES = [
  "front",
  "front_left",
  "left",
  "back_left",
  "back",
  "back_right",
  "right",
  "front_right",
] as const;
export const CAMERA_MOVES = [
  "static",
  "pan",
  "follow",
  "track",
  "push_in",
  "pull_out",
  "crane_up",
  "crane_down",
  "orbit",
  "handheld",
] as const;

export const stagingFeatureSchema = z.object({
  id: id.optional(),
  kind: z.enum(FEATURE_KINDS).catch("box"),
  name: z.string().max(80).optional(),
  /** Ground position [x, z]. For river / chasm: the near edge centre. */
  at: xz.catch([0, 0]),
  /** Width (x), height, depth (z). River / chasm: [gap width, depth, length]. */
  size: vec3.optional().catch(undefined),
  rot: num(-720, 720, 0).optional(),
  /** trees / rocks: how many, scattered within `spread` metres of `at`. */
  count: num(1, 200, 1).optional(),
  spread: num(0, 500, 10).optional(),
  /** road / path: centreline points. */
  points: z.array(xz).max(64).optional().catch(undefined),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .catch(undefined),
});

/** Accept the spellings models use for riding: mount / ridesOn / riding / mountedFrom … */
const castAliases = (v: unknown) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const o = { ...(v as Record<string, unknown>) };
  const str = (x: unknown) =>
    typeof x === "string" && x.length > 0 ? x : undefined;
  o.rides ??=
    str(o.mount) ??
    str(o.ridesOn) ??
    str(o.riding) ??
    str(o.mountId) ??
    str(o.vehicle);
  o.ridesFrom ??= o.mountedFrom ?? o.mountAt ?? o.ridesFromSec ?? o.mountTime;
  return o;
};

export const stagingCastSchema = z.preprocess(
  castAliases,
  z.object({
    id,
    name: z.string().min(1).max(80),
    kind: z.enum(CAST_KINDS).catch("person"),
    /** Script reference image number (@image_N), when the cast member has one. */
    imageN: z.coerce.number().int().optional().catch(undefined),
    size: vec3.optional().catch(undefined),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional()
      .catch(undefined),
    /** Starting ground position and heading. */
    at: xz.catch([0, 0]),
    facing: num(-720, 720, 90).optional(),
    /** Rides this cast id (person on a horse, driver in a car). */
    rides: id.optional(),
    /** From this time (s) — before it the rider stands beside the mount. */
    ridesFrom: num(0, 3600, 0).optional(),
    /** Held by this cast id (prop in a hand). */
    carriedBy: id.optional(),
    /** How a carried prop is held (default "hand"). */
    carry: z.enum(CARRY_STYLES).optional().catch(undefined),
    /** Visible only within these [start, end] second ranges (omit = always). */
    visible: z
      .array(z.tuple([num(0, 3600, 0), num(0, 3600, 0)]))
      .max(16)
      .optional()
      .catch(undefined),
  }),
);

export const stagingMoveSchema = z.object({
  who: id,
  action: z.enum(ACTIONS).catch("stand"),
  /** Fractions of the shot [0..1] when this move starts / ends. */
  from: num(0, 1, 0).optional(),
  to: num(0, 1, 1).optional(),
  /** Where the move starts; omit to continue from wherever `who` is. */
  start: xz.optional().catch(undefined),
  /** Waypoints then destination (ground [x, z]). Omit for in-place actions. */
  path: z.array(xz).max(24).optional().catch(undefined),
  /** Heading to face at the end (deg), or a cast / feature id to face. */
  face: z
    .union([
      z.number(),
      z
        .string()
        .regex(/^-?\d+(\.\d+)?$/)
        .transform(Number),
      id,
    ])
    .transform((v) =>
      typeof v === "number" ? Math.max(-720, Math.min(720, v)) : v,
    )
    .optional()
    .catch(undefined),
  /** Jump / leap apex height (m). */
  height: num(0, 40, 1).optional(),
  /** mount: the cast id climbed onto / into (horse, car …). */
  target: id.optional().catch(undefined),
  /** leap / jump: the river / chasm / feature id jumped over (the arc spans it). */
  over: id.optional().catch(undefined),
  /** Move relative to another cast member (alongside, behind, escorting). */
  follow: id.optional().catch(undefined),
  /** With follow: [metres ahead (+) / behind (−), metres to their left (+) / right (−)]. */
  offset: z
    .tuple([num(-60, 60, 0), num(-60, 60, 0)])
    .optional()
    .catch(undefined),
  /** A carried prop changes how it is held from this move on. */
  carry: z.enum(CARRY_STYLES).optional().catch(undefined),
});

export const stagingCameraSchema = z.object({
  size: z.enum(SHOT_SIZES).catch("medium"),
  angle: z.enum(CAMERA_ANGLES).catch("eye"),
  side: z.enum(CAMERA_SIDES).catch("front_left"),
  move: z.enum(CAMERA_MOVES).catch("static"),
  /** Cast or feature id the camera frames. */
  subject: id.optional().catch(undefined),
  /** Second subject: two-shot / over-the-shoulder (camera behind subject2). */
  subject2: id.optional().catch(undefined),
  overShoulder: z.coerce.boolean().optional().catch(undefined),
  /** Point-of-view from this cast id's eyes, looking at `subject`. */
  pov: id.optional().catch(undefined),
  lensMm: num(10, 300, 35).optional(),
  /** Put the camera at this cast member / feature / ground point, looking at the subject. */
  from: z.union([id, xz]).optional().catch(undefined),
  /** Cut to black on the last beat of the shot (the shot itself is visible). */
  blackAtEnd: z.coerce.boolean().optional().catch(undefined),
  /** Black frame (cut to black / fade out). */
  black: z.coerce.boolean().optional().catch(undefined),
});

export const stagingShotSchema = z.object({
  n: z.coerce.number().int(),
  camera: stagingCameraSchema,
  moves: z.array(stagingMoveSchema).max(40).default([]).catch([]),
});

export const stagingPlanSchema = z.object({
  schema: z.literal(STAGING_SCHEMA_ID).catch(STAGING_SCHEMA_ID),
  set: z.object({
    terrain: z.enum(TERRAINS).catch("open"),
    timeOfDay: z.enum(TIMES_OF_DAY).catch("day"),
    features: z.array(stagingFeatureSchema).max(120).default([]).catch([]),
  }),
  cast: z.array(stagingCastSchema).max(40),
  shots: z.array(stagingShotSchema).min(1).max(80),
});

export type StagingPlan = z.infer<typeof stagingPlanSchema>;
export type StagingFeature = z.infer<typeof stagingFeatureSchema>;
export type StagingCast = z.infer<typeof stagingCastSchema>;
export type StagingMove = z.infer<typeof stagingMoveSchema>;
export type StagingCamera = z.infer<typeof stagingCameraSchema>;
export type StagingShot = z.infer<typeof stagingShotSchema>;

/** Parse model output (string or object) into a plan; returns the Zod issues on failure. */
export function parseStagingPlan(
  raw: unknown,
): { ok: true; plan: StagingPlan } | { ok: false; error: string } {
  let value = raw;
  if (typeof raw === "string") {
    const text = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "");
    try {
      value = JSON.parse(text);
    } catch (err) {
      return { ok: false, error: `Not valid JSON: ${(err as Error).message}` };
    }
  }
  const result = stagingPlanSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues
        .slice(0, 12)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  // Referential sanity: drop moves / cameras that name unknown cast or features.
  const plan = result.data;
  const castIds = new Set(plan.cast.map((c) => c.id));
  const featIds = new Set(
    plan.set.features.map((f) => f.id).filter(Boolean) as string[],
  );
  const known = (x?: string) =>
    x === undefined || castIds.has(x) || featIds.has(x);
  for (const c of plan.cast) {
    if (c.rides && !castIds.has(c.rides)) c.rides = undefined;
    if (c.carriedBy && !castIds.has(c.carriedBy)) c.carriedBy = undefined;
  }
  for (const s of plan.shots) {
    s.moves = s.moves.filter((m) => castIds.has(m.who));
    for (const m of s.moves) {
      if (m.target && !castIds.has(m.target)) m.target = undefined;
      if (m.follow && !castIds.has(m.follow)) m.follow = undefined;
      if (m.over && !featIds.has(m.over)) m.over = undefined;
      if (
        m.action === "mount" &&
        !m.target &&
        typeof m.face === "string" &&
        castIds.has(m.face)
      ) {
        m.target = m.face;
      }
    }
    if (!known(s.camera.subject)) s.camera.subject = undefined;
    if (!known(s.camera.subject2)) s.camera.subject2 = undefined;
    if (s.camera.pov && !castIds.has(s.camera.pov)) s.camera.pov = undefined;
    if (typeof s.camera.from === "string" && !known(s.camera.from))
      s.camera.from = undefined;
  }
  if (plan.cast.length === 0)
    return { ok: false, error: "cast: at least one cast member is required" };
  return { ok: true, plan };
}
