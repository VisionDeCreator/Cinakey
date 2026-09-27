export const SHOT_TYPES = [
  "wide",
  "medium",
  "close-up",
  "extreme close-up",
  "insert",
  "over-the-shoulder",
  "two-shot",
  "POV",
] as const;

export const CAMERA_MOVES = [
  "static",
  "pan",
  "tilt",
  "push",
  "pull",
  "tracking",
  "handheld",
  "crane",
] as const;

export const SHOT_STATUSES = [
  { value: "planned", label: "Planned" },
  { value: "blocked_out", label: "Blocked out" },
  { value: "generating", label: "Generating" },
  { value: "selected", label: "Selected" },
] as const;

export type ShotStatusValue = (typeof SHOT_STATUSES)[number]["value"];

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(sec % 1 === 0 ? 0 : 1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}
