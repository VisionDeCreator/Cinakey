import {
  newTimelineId,
  recomputeTimelineDuration,
  type TimelineClip,
  type TimelineDocument,
} from "@cinakey/shared";
import type { StudioInsert } from "../studio/StudioWorkspace";

/** Insert on one lane, preserving both sides of any clip under the drop point. */
export function insertMedia(
  doc: TimelineDocument,
  media: StudioInsert,
  playheadSec: number,
  id = newTimelineId("clip"),
): { doc: TimelineDocument; id: string; startSec: number } {
  const kind =
    media.type === "music" ? "music" : media.type === "audio" ? "sfx" : "video";
  const requested = doc.tracks.find((track) => track.id === media.trackId);
  const compatible = (track: TimelineDocument["tracks"][number]) =>
    kind === "video"
      ? track.kind === "video"
      : ["music", "sfx", "dialogue"].includes(track.kind);
  const target =
    requested && compatible(requested)
      ? requested
      : doc.tracks.find((track) => track.kind === kind);
  if (!target) throw new Error("No compatible media track is available.");
  if (
    ![media.inSec, media.outSec, media.durationSec].every(Number.isFinite) ||
    media.inSec < 0 ||
    media.outSec <= media.inSec ||
    media.durationSec <= 0
  )
    throw new Error(
      "Preview this asset to load its duration before adding it.",
    );
  const startSec = Math.max(
    0,
    Math.round((media.startSec ?? playheadSec) * doc.project.fps) /
      doc.project.fps,
  );
  if (!Number.isFinite(startSec)) throw new Error("Invalid insertion time.");
  const clip: TimelineClip = {
    id,
    startSec,
    durationSec: media.durationSec,
    inSec: media.inSec,
    outSec: media.outSec,
    speed: 1,
    source: { type: "asset", assetId: media.assetId },
    volume: 1,
  };
  const next = {
    ...doc,
    tracks: doc.tracks.map((track) => {
      if (track.id !== target.id) return track;
      const clips = track.clips.flatMap((existing) => {
        const end = existing.startSec + existing.durationSec;
        if (end <= startSec) return [existing];
        if (existing.startSec >= startSec)
          return [
            { ...existing, startSec: existing.startSec + clip.durationSec },
          ];
        const offset = startSec - existing.startSec;
        const sourceCut =
          existing.inSec +
          ((existing.outSec - existing.inSec) * offset) / existing.durationSec;
        return [
          { ...existing, durationSec: offset, outSec: sourceCut },
          {
            ...existing,
            id: newTimelineId("clip"),
            startSec: startSec + clip.durationSec,
            durationSec: end - startSec,
            inSec: sourceCut,
          },
        ];
      });
      return {
        ...track,
        clips: [...clips, clip].sort((a, b) => a.startSec - b.startSec),
      };
    }),
  };
  return { doc: recomputeTimelineDuration(next), id, startSec };
}

export async function resolveMediaDuration(
  url: string,
  type: string,
): Promise<number> {
  const element = document.createElement(type === "video" ? "video" : "audio");
  try {
    return await new Promise<number>((resolve, reject) => {
      const finish = (error?: string) => {
        clearTimeout(timer);
        element.onloadedmetadata = null;
        element.onerror = null;
        if (
          error ||
          !Number.isFinite(element.duration) ||
          element.duration <= 0
        )
          reject(new Error(error ?? "Media has no usable duration."));
        else resolve(element.duration);
      };
      const timer = setTimeout(
        () =>
          finish("Media metadata timed out. Try previewing the source first."),
        15000,
      );
      element.onloadedmetadata = () => finish();
      element.onerror = () =>
        finish("Cannot read this media. Try another format.");
      element.preload = "metadata";
      element.src = url;
    });
  } finally {
    element.removeAttribute("src");
    element.load();
  }
}
