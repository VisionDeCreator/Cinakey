/** Prompt template constants (views, lenses, palette suffix, locking copy). */

export const PROMPT_TEMPLATE_VERSION = "1.0" as const;

export const COLOR_PALETTE_SUFFIX =
  "No readable text, no letters, no logos anywhere." as const;

export const COLOR_PALETTE_SUFFIX_ENVIRONMENT =
  "No readable text, no signs, no logos anywhere." as const;

export const COLOR_PALETTE_SUFFIX_PRODUCT =
  "No readable text, no letters, no logos, no brand names anywhere." as const;

export const DEFAULT_CHARACTER_VIEWS = [
  "full-body front view",
  "full-body back view",
  "full-body side view",
  "a full-body action pose",
  "two head close-ups (three-quarter and profile)",
] as const;

export const DEFAULT_CREATURE_VIEWS = [
  "full-body side view",
  "full-body front view",
  "a full-body action pose",
  "a close-up of its head",
] as const;

export const DEFAULT_PRODUCT_VIEWS =
  "two views: a full side view and a three-quarter view from above" as const;

/** Lens defaults by shot type (copilot may override with a reason). */
export const LENS_DEFAULTS_MM: Record<string, number> = {
  "extreme wide": 16,
  "extreme wide shot": 16,
  wide: 24,
  "wide shot": 24,
  full: 35,
  "full shot": 35,
  "medium-wide": 35,
  "medium wide": 35,
  medium: 45,
  "medium shot": 45,
  "medium close-up": 65,
  "close-up": 85,
  "extreme close-up": 100,
  "top-down": 24,
  aerial: 24,
  "top-down aerial": 24,
  "pov": 200,
  "point of view": 200,
  "scope pov": 200,
  "point of view through the scope": 200,
};

/** Camera height defaults in metres. */
export const CAMERA_HEIGHT_DEFAULTS_M = {
  eyeLevel: 1.6,
  low: 0.4,
  inTheGrass: 0.4,
  waterSurface: 0.1,
  droneMin: 15,
  droneMax: 40,
} as const;

export const SCRIPT_ART_STYLE_LOCKING = [
  "No cel-shading, no photoreal textures, no 3D render look, no style shift in fast action, close-ups, top-down shots or water shots.",
  "The last frame matches the first in style.",
] as const;

export const SCRIPT_IMAGE_QUALITY_DEFAULT =
  "Every frame sharp, crisp and clean. Faces, eyes, hands, fur and key subjects stay in sharp focus and clearly readable, even at full sprint. Motion is shown with painted speed streaks and flying debris in the background only; primary subjects are never blurred or smeared. No noise, no flicker, no warping, no melting shapes, no ghosting between frames." as const;

export type StandInPrimitive =
  | "plane"
  | "box"
  | "cylinder"
  | "sphere"
  | "strip"
  | "cliff edge"
  | "tree";

export type CastProxyKind = "humanoid mannequin" | "quadruped" | "creature proxy";

export type CameraMoveType =
  | "static"
  | "push-in"
  | "pull-out"
  | "pan"
  | "tilt"
  | "track"
  | "dolly"
  | "crane"
  | "orbit"
  | "drone/aerial"
  | "top-down"
  | "POV"
  | "handheld";
