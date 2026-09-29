import type { BlockoutObject, BlockoutObjectKey } from "../types";
import { applyEase, lerpAngleDeg } from "./math";

export type ObjectPose = {
  x: number;
  z: number;
  y: number;
  rot: number;
};

function keyPose(o: BlockoutObject, k: BlockoutObjectKey): ObjectPose {
  return {
    x: k.x,
    z: k.z,
    y: k.y != null ? k.y : (o.y ?? 0),
    rot: k.rot,
  };
}

/** Evaluate object transform at frame f (linear position + shortest-path rotation). */
export function objAt(o: BlockoutObject, f: number): ObjectPose {
  const ks = [...(o.keys ?? [])].sort((a, b) => a.f - b.f);
  const oy = o.y ?? 0;
  if (!ks.length) {
    return { x: o.pos[0], z: o.pos[1], y: oy, rot: o.rot };
  }
  if (ks.length === 1 || f <= ks[0]!.f) return keyPose(o, ks[0]!);
  const last = ks[ks.length - 1]!;
  if (f >= last.f) return keyPose(o, last);

  let i = 0;
  while (i < ks.length - 1 && ks[i + 1]!.f <= f) i++;
  const a = keyPose(o, ks[i]!);
  const b = keyPose(o, ks[i + 1]!);
  const span = Math.max(1e-9, ks[i + 1]!.f - ks[i]!.f);
  const u = applyEase(ks[i]!.ease, (f - ks[i]!.f) / span);
  return {
    x: a.x + (b.x - a.x) * u,
    z: a.z + (b.z - a.z) * u,
    y: a.y + (b.y - a.y) * u,
    rot: lerpAngleDeg(a.rot, b.rot, u),
  };
}

export function sortObjectKeys(keys: BlockoutObjectKey[]): BlockoutObjectKey[] {
  return [...keys].sort((a, b) => a.f - b.f);
}
