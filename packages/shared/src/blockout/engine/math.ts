import type { BlockoutEase } from "../types";

export const EASE_FNS: Record<BlockoutEase, (u: number) => number> = {
  linear: (u) => u,
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
  inOut: (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
  hold: () => 0,
};

export function applyEase(ease: BlockoutEase | undefined, u: number): number {
  return (EASE_FNS[ease ?? "inOut"] ?? EASE_FNS.inOut)(u);
}

/** Catmull-Rom spline sample between p1→p2 with neighbours p0, p3. */
export function catmullRom(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  u: number,
): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

/** Shortest-path angle interpolation (degrees). */
export function lerpAngleDeg(a: number, b: number, u: number): number {
  const dr = ((((b - a + 540) % 360) + 360) % 360) - 180;
  return a + dr * u;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function horizontalFovDeg(sensorMm: number, focalMm: number): number {
  return (2 * Math.atan(sensorMm / (2 * focalMm)) * 180) / Math.PI;
}

export function timecodeString(frame: number, fps: number): string {
  const ff = ((frame % fps) + fps) % fps;
  const s = Math.floor(frame / fps);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(ff)}`;
}
