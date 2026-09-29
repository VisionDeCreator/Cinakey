import type { BlockoutCameraKey, BlockoutEase, Vec3 } from "../types";
import { applyEase, catmullRom } from "./math";

export type CameraPose = {
  pos: Vec3;
  target: Vec3;
  focal: number;
  roll: number;
};

function copyKey(k: BlockoutCameraKey): CameraPose {
  return {
    pos: [k.pos[0], k.pos[1], k.pos[2]],
    target: [k.target[0], k.target[1], k.target[2]],
    focal: k.focal,
    roll: k.roll || 0,
  };
}

/**
 * Evaluate camera at frame f.
 * Position and target: Catmull-Rom; focal and roll: linear.
 * A "hold" key is a hard cut — the curve never borrows tangents across it.
 */
export function camAt(
  keys: BlockoutCameraKey[],
  f: number,
  out?: CameraPose,
): CameraPose {
  const result: CameraPose = out ?? {
    pos: [0, 1.6, 6],
    target: [0, 1.4, 0],
    focal: 35,
    roll: 0,
  };
  const ks = [...keys].sort((a, b) => a.f - b.f);
  if (!ks.length) {
    result.pos = [0, 1.6, 6];
    result.target = [0, 1.4, 0];
    result.focal = 35;
    result.roll = 0;
    return result;
  }
  if (ks.length === 1 || f <= ks[0]!.f)
    return Object.assign(result, copyKey(ks[0]!));
  const last = ks[ks.length - 1]!;
  if (f >= last.f) return Object.assign(result, copyKey(last));

  let i = 0;
  while (i < ks.length - 1 && ks[i + 1]!.f <= f) i++;
  const a = ks[i]!;
  const b = ks[i + 1]!;
  const p0 = ks[i - 1] && ks[i - 1]!.ease !== "hold" ? ks[i - 1]! : a;
  const p3 = b.ease !== "hold" && ks[i + 2] ? ks[i + 2]! : b;
  const span = Math.max(1e-9, b.f - a.f);
  const u = applyEase(a.ease, (f - a.f) / span);

  result.pos = [0, 1, 2].map((j) =>
    catmullRom(p0.pos[j]!, a.pos[j]!, b.pos[j]!, p3.pos[j]!, u),
  ) as Vec3;
  result.target = [0, 1, 2].map((j) =>
    catmullRom(p0.target[j]!, a.target[j]!, b.target[j]!, p3.target[j]!, u),
  ) as Vec3;
  result.focal = a.focal + (b.focal - a.focal) * u;
  result.roll = (a.roll || 0) + ((b.roll || 0) - (a.roll || 0)) * u;
  return result;
}

export function sortCameraKeys(keys: BlockoutCameraKey[]): BlockoutCameraKey[] {
  return [...keys].sort((a, b) => a.f - b.f);
}

export function defaultEase(): BlockoutEase {
  return "inOut";
}
