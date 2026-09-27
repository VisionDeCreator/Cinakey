/** Shared domain types used by both Convex and the frontend. */

export type ProjectTab =
  | "script"
  | "look-dev"
  | "blockout"
  | "shots"
  | "edit"
  | "assets";

export type NavItemId = "projects" | "assets" | "settings";

export type AspectRatio = "16:9" | "9:16" | "1:1";

export type PipelineStage =
  | "script"
  | "lookDev"
  | "blockout"
  | "shots"
  | "edit"
  | "assets";

export type StageStatus = "empty" | "started";

export type PipelineProgress = Record<PipelineStage, StageStatus>;

export type ProjectBrief = {
  logline: string;
  audience?: string;
  tone?: string;
};

export type AssetType =
  | "video"
  | "image"
  | "audio"
  | "music"
  | "logo"
  | "json"
  | "other";

/** Client-side upload limits (must match server validation). */
export const ASSET_MAX_BYTES: Record<AssetType, number> = {
  image: 25 * 1024 * 1024,
  logo: 10 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  music: 50 * 1024 * 1024,
  video: 500 * 1024 * 1024,
  json: 5 * 1024 * 1024,
  other: 25 * 1024 * 1024,
};

export const ASSET_ALLOWED_MIME: Record<AssetType, readonly string[]> = {
  image: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  logo: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
  audio: ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4"],
  music: ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4"],
  json: ["application/json"],
  other: [],
};
