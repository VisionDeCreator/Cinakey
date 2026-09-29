import type { BlockoutDocument } from "../types";

/**
 * Selective-keep merge: preserve camera/object keys in kept shot ranges.
 * Never re-attach director-owned cast/path/tree orphans (avoids duplicate packs).
 */
export function mergeKeptRanges(
  directed: BlockoutDocument,
  existing: BlockoutDocument,
  keepShotIds: Set<string>,
): BlockoutDocument {
  if (keepShotIds.size === 0) return directed;

  const keepCuts = directed.shots.filter(
    (s) => s.shotId && keepShotIds.has(s.shotId),
  );
  if (keepCuts.length === 0) return directed;

  const inKeep = (f: number) => keepCuts.some((c) => f >= c.start && f < c.end);

  const cameraKeys = [
    ...directed.camera.keys.filter((k) => !inKeep(k.f)),
    ...existing.camera.keys.filter((k) => inKeep(k.f)).map((k) => ({ ...k })),
  ].sort((a, b) => a.f - b.f);

  // Repair older director output that put `hold` on a moving shot's first key
  // (the camera froze all shot, then jumped). A hold followed by another key
  // inside the same cut is never a cut, so make it animate.
  for (const cut of keepCuts) {
    const inCut = cameraKeys.filter((k) => k.f >= cut.start && k.f < cut.end);
    for (let i = 0; i < inCut.length - 1; i++) {
      if (inCut[i]!.ease === "hold") inCut[i]!.ease = "linear";
    }
  }

  const objects = directed.objects.map((o) => {
    const eo = existing.objects.find((x) => x.id === o.id);
    if (!eo) return o;
    const keys = [
      ...o.keys.filter((k) => !inKeep(k.f)),
      ...eo.keys.filter((k) => inKeep(k.f)),
    ].sort((a, b) => a.f - b.f);
    return { ...o, keys };
  });

  const directorOwned = (id: string) =>
    /^(cast-|path-|tree-|rock-|fire|light-|ground-|river|moon|sun|set-|fx-)/i.test(
      id,
    );
  for (const eo of existing.objects) {
    if (objects.some((o) => o.id === eo.id)) continue;
    if (directorOwned(eo.id)) continue;
    objects.push(eo);
  }

  return {
    ...directed,
    camera: { ...directed.camera, keys: cameraKeys },
    objects,
  };
}
