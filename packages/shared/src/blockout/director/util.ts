export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function smoothstep(t: number) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function r3(v: number) {
  return Math.round(v * 1000) / 1000;
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function lensForShotType(shotType: string): number {
  const t = shotType.toLowerCase();
  if (t.includes("scope")) return 200;
  if (t.includes("pov")) return 28;
  if (t.includes("extreme close")) return 100;
  if (t.includes("close")) return 50;
  if (t.includes("medium")) return 35;
  if (t.includes("aerial") || t.includes("top") || t.includes("drone"))
    return 24;
  if (t.includes("extreme wide") || t.includes("ews")) return 18;
  if (t.includes("wide")) return 24;
  return 35;
}

export function fwd(rotDeg: number): [number, number] {
  const a = (rotDeg * Math.PI) / 180;
  return [Math.sin(a), Math.cos(a)];
}

export function headingOf(
  fn: (t: number) => { x: number; z: number },
  t: number,
  duration: number,
  defaultDeg = 90,
  eps = 0.06,
): number {
  const a = fn(Math.max(0, t - eps));
  const b = fn(Math.min(duration, t + eps));
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (dx * dx + dz * dz < 1e-4) return defaultDeg;
  return (Math.atan2(dx, dz) * 180) / Math.PI;
}
