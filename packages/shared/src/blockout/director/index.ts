/**
 * Shot-by-shot pre-viz director.
 *
 * Reads a Phase 7C script (CAST + LOCATION + timed SHOTS) and builds a full
 * part-scoped cinakey.blockout/2.0 document: world stand-ins, cast blocking
 * along a speed-integrated travel path, and per-shot camera keys with hold cuts.
 *
 * Deterministic (no Theatre.js, no LLM, no Python generator).
 */

import type { ScriptPromptData } from "../../prompt-templates/schemas";
import {
  BLOCKOUT_SCHEMA_ID,
  type BlockoutDocument,
  type BlockoutProject,
} from "../types";
import { buildCameraKeys, type DirectorShotLink } from "./cameras";
import { buildCast, primaryMount } from "./cast";
import {
  buildCastObjects,
  buildMotionContext,
  runCorridorPoints,
} from "./castMotion";
import { mergeKeptRanges } from "./merge";
import { buildTravelPath, detectChaseBeats } from "./path";
import { hashSeed, mulberry32 } from "./util";
import { buildWorldObjects } from "./world";

export type DirectBlockoutOpts = {
  sequenceId?: string;
  sequenceTitle?: string;
  liveShots?: DirectorShotLink[];
  existing?: BlockoutDocument | null;
  keepShotIds?: Set<string>;
};

export type { DirectorShotLink };

/**
 * Build a full part blockout document from a script's CAST / LOCATION / SHOTS.
 */
export function directPartDocumentFromScript(
  script: ScriptPromptData,
  project: BlockoutProject,
  opts: DirectBlockoutOpts = {},
): BlockoutDocument {
  const fps = project.fps;
  const shots = [...script.shots].sort((a, b) => a.startSec - b.startSec);
  const totalSec = Math.max(
    script.totalDurationSec,
    shots[shots.length - 1]?.endSec ?? 6,
  );
  const frames = Math.max(1, Math.round(totalSec * fps));
  const seed = hashSeed(
    `${opts.sequenceTitle ?? project.title}|${shots.map((s) => s.action).join("|")}`,
  );
  const rng = mulberry32(seed);

  const cast = buildCast(script);
  const beats = detectChaseBeats(
    shots,
    totalSec,
    script.location.description,
    primaryMount(cast)?.name,
  );
  const path = buildTravelPath(beats);
  const ctx = buildMotionContext(
    path,
    shots,
    fps,
    frames,
    script.location.description,
    cast.find((r) => r.role === "prey" && r.target)?.name,
  );

  const castObjects = buildCastObjects(cast, ctx, shots);
  const corridor = runCorridorPoints(ctx);
  const world = buildWorldObjects(script, path, ctx, corridor, rng);
  const { cameraKeys, cuts } = buildCameraKeys(
    shots,
    path,
    cast,
    ctx,
    opts.liveShots,
    fps,
  );

  // Dedupe object ids (cast expansion can overlap with world ids in edge cases)
  const seen = new Set<string>();
  const objects = [...castObjects, ...world].filter((o) => {
    if (seen.has(o.id)) return false;
    seen.add(o.id);
    return true;
  });

  // Drop duplicate cast display names (stale merge artifact guard)
  const nameCounts = new Map<string, number>();
  for (const o of objects) {
    if (!/^(character|hare|raptor)$/.test(o.type)) continue;
    nameCounts.set(o.name, (nameCounts.get(o.name) ?? 0) + 1);
  }
  const hasDupNames = [...nameCounts.values()].some((c) => c > 1);

  let directed: BlockoutDocument = {
    schema: BLOCKOUT_SCHEMA_ID,
    version: 1,
    project,
    sequenceId: opts.sequenceId,
    name: opts.sequenceTitle ?? project.title,
    title: opts.sequenceTitle ?? project.title,
    fps,
    frames,
    aspect: project.aspectRatio,
    camera: { sensor: 36, keys: cameraKeys },
    objects,
    env: {
      sky: skyFor(script),
      ground: false,
      fog: false,
    },
    shots: cuts,
    notes: [
      "Hard cuts are camera keys with ease hold. Moving shots end on a hold key.",
      "Travel is +x. Side cameras sit on +z; front cameras sit ahead on +x.",
      !beats.wantsCliff
        ? `Path length ~${path.X(beats.duration).toFixed(1)} m.`
        : beats.gapKind === "river"
          ? `River bank at x=${path.edge.toFixed(1)}. River ${path.gap.toFixed(0)} m wide.`
          : `Cliff edge at x=${path.edge.toFixed(1)}. Chasm ${path.gap.toFixed(0)} m. Far platform ${Math.abs(path.farY)} m lower.`,
    ].join(" "),
  };

  // Selective keep — skip when duplicate cast names force a clean rebuild
  if (
    opts.existing &&
    opts.keepShotIds &&
    opts.keepShotIds.size > 0 &&
    !hasDupNames
  ) {
    const existingDup = (() => {
      const counts = new Map<string, number>();
      for (const o of opts.existing!.objects) {
        if (!/^(character|hare|raptor)$/.test(o.type)) continue;
        counts.set(o.name, (counts.get(o.name) ?? 0) + 1);
      }
      return [...counts.values()].some((c) => c > 1);
    })();
    if (!existingDup) {
      directed = mergeKeptRanges(directed, opts.existing, opts.keepShotIds);
    }
  }

  return directed;
}

/** Night → dark; sunset / dusk → warm; otherwise day. */
function skyFor(script: ScriptPromptData): string {
  const text =
    `${script.location.description} ${script.shots.map((s) => s.action).join(" ")}`.toLowerCase();
  if (/\bnight|\bmoon|\bmidnight|\bstars\b/.test(text)) return "#2a2d33";
  if (
    /\bsunset|\bsunrise|\bdusk|\bdawn|\bgolden\s+hour|\bsetting\s+sun/.test(
      text,
    )
  )
    return "#8a7480";
  return "#87a0b8";
}

export { buildTravelPath, detectChaseBeats } from "./path";
export { buildCast } from "./cast";
