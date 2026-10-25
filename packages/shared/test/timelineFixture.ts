import {
  TIMELINE_SCHEMA_ID,
  defaultTracks,
  newTimelineId,
  recomputeTimelineDuration,
  type TimelineDocument,
  type TimelineProjectMeta,
  type CaptionLine,
} from "../src/timeline";
export type MediaClipFixture = {
  order: number;
  durationSec: number;
  dialogueLineId?: string;
  dialogue?: string;
  assetId: string;
  proxyAssetId?: string;
  trimStartSec?: number;
  trimEndSec?: number;
  /** Fallback media duration when trim duration missing. */
  mediaDurationSec?: number;
};

export type CaptionFixture = {
  id: string;
  characterName: string;
  dialogue: string;
};

export type TimelineFixtureInput = {
  project: TimelineProjectMeta;
  clips: MediaClipFixture[];
  /** Map of dialogueLineId → line for caption seeding. */
  dialogueByLineId?: Record<string, CaptionFixture>;
  parentFileId?: string;
  version?: number;
};

function sourceWindow(
  media: MediaClipFixture,
  plannedSec: number,
): {
  inSec: number;
  outSec: number;
  durationSec: number;
} {
  const inSec = media.trimStartSec ?? 0;
  let outSec: number;
  if (media.trimEndSec !== undefined && media.trimEndSec > inSec) {
    outSec = media.trimEndSec;
  } else if (
    media.mediaDurationSec !== undefined &&
    media.mediaDurationSec > inSec
  ) {
    outSec = Math.min(inSec + plannedSec, media.mediaDurationSec);
  } else {
    outSec = inSec + plannedSec;
  }
  const sourceLen = Math.max(0.1, outSec - inSec);
  const durationSec = Math.min(plannedSec, sourceLen);
  return { inSec, outSec: inSec + durationSec, durationSec };
}

/** Build media-based test documents; this is not a product assembly workflow. */
export function timelineWithMedia(
  input: TimelineFixtureInput,
): TimelineDocument {
  const sorted = [...input.clips].sort((a, b) => {
    return a.order - b.order;
  });

  const tracks = defaultTracks();
  const video = tracks.find((t) => t.kind === "video")!;
  const dialogue = tracks.find((t) => t.kind === "dialogue")!;

  let cursor = 0;
  for (const media of sorted) {
    const planned = Math.max(0.1, media.durationSec);
    const { inSec, outSec, durationSec } = sourceWindow(media, planned);

    video.clips.push({
      id: newTimelineId("clip"),
      startSec: cursor,
      durationSec,
      inSec,
      outSec,
      speed: 1,
      source: {
        type: "asset",
        assetId: media.assetId,
        proxyAssetId: media.proxyAssetId,
      },
      volume: 1,
    });

    const line =
      media.dialogueLineId && input.dialogueByLineId
        ? input.dialogueByLineId[media.dialogueLineId]
        : undefined;
    const captionText = line?.dialogue?.trim() || media.dialogue?.trim() || "";
    if (captionText) {
      const lines: CaptionLine[] = [
        {
          id: newTimelineId("cap"),
          text: captionText,
          characterName: line?.characterName,
        },
      ];
      dialogue.clips.push({
        id: newTimelineId("clip"),
        startSec: cursor,
        durationSec,
        inSec: 0,
        outSec: durationSec,
        speed: 1,
        source: {
          type: "text",
          text: captionText,
          styleId: "caption",
          lines,
        },
      });
    }

    cursor += durationSec;
  }

  return recomputeTimelineDuration({
    schema: TIMELINE_SCHEMA_ID,
    version: input.version ?? 1,
    parentFileId: input.parentFileId,
    project: { ...input.project },
    durationSec: cursor,
    tracks,
  });
}
