/**
 * Timeline document (cinakey.timeline/1.0).
 *
 * Stored as a JSON file on timelineVersions.timelineFileId. Tracks hold clips
 * that reference takes, uploaded assets, or generated text/captions.
 */

import { z } from "zod";

export const TIMELINE_SCHEMA_ID = "cinakey.timeline/1.0" as const;

/** Schema ids this build can read. Minor versions must stay additive. */
export const TIMELINE_READABLE_SCHEMAS: readonly string[] = [TIMELINE_SCHEMA_ID];

/** MVP export caps (documented in source of truth). */
export const TIMELINE_EXPORT_MAX_LONG_EDGE = 1920;
export const TIMELINE_EXPORT_MAX_DURATION_SEC = 300;

export const TITLE_STYLE_IDS = ["lower-third", "centered", "caption"] as const;
export type TitleStyleId = (typeof TITLE_STYLE_IDS)[number];

export const TRACK_KINDS = [
  "video",
  "dialogue",
  "music",
  "sfx",
  "titles",
] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

export type CaptionLine = {
  id: string;
  text: string;
  /** Optional character attribution for dialogue captions. */
  characterName?: string;
};

export type TakeClipSource = {
  type: "take";
  takeId: string;
  shotId: string;
  assetId: string;
  proxyAssetId?: string;
};

export type AssetClipSource = {
  type: "asset";
  assetId: string;
};

export type TextClipSource = {
  type: "text";
  text: string;
  styleId: TitleStyleId;
  lines?: CaptionLine[];
};

export type ClipSource = TakeClipSource | AssetClipSource | TextClipSource;

export type TimelineClip = {
  id: string;
  /** Timeline position (seconds from sequence start). */
  startSec: number;
  /** On-timeline length after speed. */
  durationSec: number;
  /** Source in-point (seconds into media). */
  inSec: number;
  /** Source out-point (seconds into media). */
  outSec: number;
  speed: number;
  source: ClipSource;
  volume?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  /** Denormalized shot link for take-backed video clips. */
  linkedShotId?: string;
};

export type TimelineTrack = {
  id: string;
  kind: TrackKind;
  name: string;
  muted?: boolean;
  locked?: boolean;
  clips: TimelineClip[];
};

export type TimelineMarker = {
  id: string;
  t: number;
  label: string;
};

export type TimelineProjectMeta = {
  id: string;
  aspectRatio: string;
  fps: number;
};

export type TimelineDocument = {
  schema: typeof TIMELINE_SCHEMA_ID;
  version: number;
  parentFileId?: string;
  project: TimelineProjectMeta;
  durationSec: number;
  tracks: TimelineTrack[];
  markers?: TimelineMarker[];
};

const captionLineSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  characterName: z.string().optional(),
});

const takeSourceSchema = z.object({
  type: z.literal("take"),
  takeId: z.string().min(1),
  shotId: z.string().min(1),
  assetId: z.string().min(1),
  proxyAssetId: z.string().min(1).optional(),
});

const assetSourceSchema = z.object({
  type: z.literal("asset"),
  assetId: z.string().min(1),
});

const textSourceSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  styleId: z.enum(TITLE_STYLE_IDS),
  lines: z.array(captionLineSchema).optional(),
});

const clipSourceSchema = z.discriminatedUnion("type", [
  takeSourceSchema,
  assetSourceSchema,
  textSourceSchema,
]);

const clipSchema = z.object({
  id: z.string().min(1),
  startSec: z.number().finite().nonnegative(),
  durationSec: z.number().finite().positive(),
  inSec: z.number().finite().nonnegative(),
  outSec: z.number().finite().nonnegative(),
  speed: z.number().finite().positive(),
  source: clipSourceSchema,
  volume: z.number().finite().min(0).max(2).optional(),
  fadeInSec: z.number().finite().nonnegative().optional(),
  fadeOutSec: z.number().finite().nonnegative().optional(),
  linkedShotId: z.string().min(1).optional(),
});

const trackSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(TRACK_KINDS),
  name: z.string(),
  muted: z.boolean().optional(),
  locked: z.boolean().optional(),
  clips: z.array(clipSchema),
});

const markerSchema = z.object({
  id: z.string().min(1),
  t: z.number().finite().nonnegative(),
  label: z.string(),
});

const timelineDocumentSchema = z.object({
  schema: z.literal(TIMELINE_SCHEMA_ID),
  version: z.number().finite().nonnegative(),
  parentFileId: z.string().optional(),
  project: z.object({
    id: z.string().min(1),
    aspectRatio: z.string().min(1),
    fps: z.number().finite().positive(),
  }),
  durationSec: z.number().finite().nonnegative(),
  tracks: z.array(trackSchema),
  markers: z.array(markerSchema).optional(),
});

export function newTimelineId(prefix = "tl"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultTracks(): TimelineTrack[] {
  return [
    { id: newTimelineId("trk"), kind: "video", name: "Video", clips: [] },
    { id: newTimelineId("trk"), kind: "dialogue", name: "Dialogue", clips: [] },
    { id: newTimelineId("trk"), kind: "music", name: "Music", clips: [] },
    { id: newTimelineId("trk"), kind: "sfx", name: "SFX", clips: [] },
    { id: newTimelineId("trk"), kind: "titles", name: "Titles", clips: [] },
  ];
}

export function createEmptyTimeline(project: TimelineProjectMeta): TimelineDocument {
  return {
    schema: TIMELINE_SCHEMA_ID,
    version: 1,
    project: { ...project },
    durationSec: 0,
    tracks: defaultTracks(),
  };
}

/** Recompute durationSec as the end of the last clip across all tracks. */
export function recomputeTimelineDuration(doc: TimelineDocument): TimelineDocument {
  let maxEnd = 0;
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      maxEnd = Math.max(maxEnd, clip.startSec + clip.durationSec);
    }
  }
  return { ...doc, durationSec: maxEnd };
}

export function validateTimelineDocument(value: unknown): string | null {
  const result = timelineDocumentSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    if (!issue) return "Invalid timeline document";
    const path = issue.path.length > 0 ? issue.path.join(".") + ": " : "";
    return `${path}${issue.message}`;
  }
  for (const track of result.data.tracks) {
    for (const clip of track.clips) {
      if (clip.outSec < clip.inSec) {
        return `clip ${clip.id}: outSec must be >= inSec`;
      }
    }
  }
  return null;
}

export function isTimelineDocument(value: unknown): value is TimelineDocument {
  return validateTimelineDocument(value) === null;
}

export function assertTimelineDocument(value: unknown): TimelineDocument {
  const err = validateTimelineDocument(value);
  if (err !== null) {
    throw new Error(`Invalid cinakey.timeline/1.0 document: ${err}`);
  }
  return value as TimelineDocument;
}

export function findTrack(
  doc: TimelineDocument,
  kind: TrackKind,
): TimelineTrack | undefined {
  return doc.tracks.find((t) => t.kind === kind);
}

export function findClip(
  doc: TimelineDocument,
  clipId: string,
): { track: TimelineTrack; clip: TimelineClip; index: number } | null {
  for (const track of doc.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) {
      return { track, clip: track.clips[index]!, index };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Assemble from shot list
// ---------------------------------------------------------------------------

export type AssembleShotInput = {
  shotId: string;
  sceneOrder: number;
  shotOrder: number;
  durationSec: number;
  dialogueLineId?: string;
  dialogue?: string;
  take: {
    takeId: string;
    assetId: string;
    proxyAssetId?: string;
    trimStartSec?: number;
    trimEndSec?: number;
    /** Fallback media duration when trim/shot duration missing. */
    mediaDurationSec?: number;
  };
};

export type AssembleDialogueLine = {
  id: string;
  characterName: string;
  dialogue: string;
};

export type AssembleFromShotListInput = {
  project: TimelineProjectMeta;
  shots: AssembleShotInput[];
  /** Map of dialogueLineId → line for caption seeding. */
  dialogueByLineId?: Record<string, AssembleDialogueLine>;
  parentFileId?: string;
  version?: number;
};

function sourceWindow(take: AssembleShotInput["take"], plannedSec: number): {
  inSec: number;
  outSec: number;
  durationSec: number;
} {
  const inSec = take.trimStartSec ?? 0;
  let outSec: number;
  if (take.trimEndSec !== undefined && take.trimEndSec > inSec) {
    outSec = take.trimEndSec;
  } else if (take.mediaDurationSec !== undefined && take.mediaDurationSec > inSec) {
    outSec = Math.min(inSec + plannedSec, take.mediaDurationSec);
  } else {
    outSec = inSec + plannedSec;
  }
  const sourceLen = Math.max(0.1, outSec - inSec);
  const durationSec = Math.min(plannedSec, sourceLen);
  return { inSec, outSec: inSec + durationSec, durationSec };
}

/**
 * Build a rough cut: every shot's selected take in order at planned duration,
 * plus dialogue captions when line text is available.
 */
export function assembleFromShotList(
  input: AssembleFromShotListInput,
): TimelineDocument {
  const sorted = [...input.shots].sort((a, b) => {
    if (a.sceneOrder !== b.sceneOrder) return a.sceneOrder - b.sceneOrder;
    return a.shotOrder - b.shotOrder;
  });

  const tracks = defaultTracks();
  const video = tracks.find((t) => t.kind === "video")!;
  const dialogue = tracks.find((t) => t.kind === "dialogue")!;

  let cursor = 0;
  for (const shot of sorted) {
    const planned = Math.max(0.1, shot.durationSec);
    const { inSec, outSec, durationSec } = sourceWindow(shot.take, planned);

    video.clips.push({
      id: newTimelineId("clip"),
      startSec: cursor,
      durationSec,
      inSec,
      outSec,
      speed: 1,
      source: {
        type: "take",
        takeId: shot.take.takeId,
        shotId: shot.shotId,
        assetId: shot.take.assetId,
        proxyAssetId: shot.take.proxyAssetId,
      },
      volume: 1,
      linkedShotId: shot.shotId,
    });

    const line =
      shot.dialogueLineId && input.dialogueByLineId
        ? input.dialogueByLineId[shot.dialogueLineId]
        : undefined;
    const captionText =
      line?.dialogue?.trim() ||
      shot.dialogue?.trim() ||
      "";
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
        linkedShotId: shot.shotId,
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

// ---------------------------------------------------------------------------
// Edit operations (pure)
// ---------------------------------------------------------------------------

function mapTracks(
  doc: TimelineDocument,
  map: (track: TimelineTrack) => TimelineTrack,
): TimelineDocument {
  return recomputeTimelineDuration({
    ...doc,
    tracks: doc.tracks.map(map),
  });
}

export function deleteClip(
  doc: TimelineDocument,
  clipId: string,
): TimelineDocument {
  return mapTracks(doc, (track) => ({
    ...track,
    clips: track.clips.filter((c) => c.id !== clipId),
  }));
}

/** Split a clip at an absolute timeline time. Returns unchanged if t is outside. */
export function splitClip(
  doc: TimelineDocument,
  clipId: string,
  t: number,
): TimelineDocument {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const { clip, track } = found;
  const local = t - clip.startSec;
  if (local <= 0.05 || local >= clip.durationSec - 0.05) return doc;

  const sourceSpan = clip.outSec - clip.inSec;
  const ratio = local / clip.durationSec;
  const midSource = clip.inSec + sourceSpan * ratio;

  const left: TimelineClip = {
    ...clip,
    durationSec: local,
    outSec: midSource,
  };
  const right: TimelineClip = {
    ...clip,
    id: newTimelineId("clip"),
    startSec: t,
    durationSec: clip.durationSec - local,
    inSec: midSource,
  };

  return mapTracks(doc, (tr) => {
    if (tr.id !== track.id) return tr;
    const clips = tr.clips.flatMap((c) =>
      c.id === clipId ? [left, right] : [c],
    );
    return { ...tr, clips };
  });
}

export function moveClip(
  doc: TimelineDocument,
  clipId: string,
  newStartSec: number,
  targetTrackId?: string,
): TimelineDocument {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const start = Math.max(0, newStartSec);

  return mapTracks(doc, (track) => {
    const without = track.clips.filter((c) => c.id !== clipId);
    const destId = targetTrackId ?? found.track.id;
    if (track.id === destId) {
      return {
        ...track,
        clips: [...without, { ...found.clip, startSec: start }].sort(
          (a, b) => a.startSec - b.startSec,
        ),
      };
    }
    if (track.id === found.track.id) {
      return { ...track, clips: without };
    }
    return track;
  });
}

/**
 * Ripple trim: change clip edge and shift later clips on the same track by delta.
 * edge "in" = left edge; "out" = right edge.
 */
export function rippleTrim(
  doc: TimelineDocument,
  clipId: string,
  edge: "in" | "out",
  newTimelineEdgeSec: number,
): TimelineDocument {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const { clip, track } = found;
  const end = clip.startSec + clip.durationSec;

  if (edge === "in") {
    const newStart = Math.max(0, Math.min(newTimelineEdgeSec, end - 0.05));
    const delta = newStart - clip.startSec;
    if (Math.abs(delta) < 1e-6) return doc;
    const sourceDelta = delta * clip.speed;
    const updated: TimelineClip = {
      ...clip,
      startSec: newStart,
      durationSec: clip.durationSec - delta,
      inSec: clip.inSec + sourceDelta,
    };
    return mapTracks(doc, (tr) => {
      if (tr.id !== track.id) return tr;
      return {
        ...tr,
        clips: tr.clips
          .map((c) => {
            if (c.id === clipId) return updated;
            if (c.startSec >= end - 1e-6) {
              return { ...c, startSec: c.startSec - delta };
            }
            return c;
          })
          .sort((a, b) => a.startSec - b.startSec),
      };
    });
  }

  const newEnd = Math.max(clip.startSec + 0.05, newTimelineEdgeSec);
  const delta = newEnd - end;
  if (Math.abs(delta) < 1e-6) return doc;
  const sourceDelta = delta * clip.speed;
  const updated: TimelineClip = {
    ...clip,
    durationSec: clip.durationSec + delta,
    outSec: clip.outSec + sourceDelta,
  };
  return mapTracks(doc, (tr) => {
    if (tr.id !== track.id) return tr;
    return {
      ...tr,
      clips: tr.clips
        .map((c) => {
          if (c.id === clipId) return updated;
          if (c.startSec >= end - 1e-6) {
            return { ...c, startSec: c.startSec + delta };
          }
          return c;
        })
        .sort((a, b) => a.startSec - b.startSec),
    };
  });
}

/**
 * Roll trim: edit the shared cut between two adjacent clips on the same track.
 * `clipId` is the left clip; its out and the next clip's in move together.
 */
export function rollTrim(
  doc: TimelineDocument,
  leftClipId: string,
  newCutSec: number,
): TimelineDocument {
  const found = findClip(doc, leftClipId);
  if (!found) return doc;
  const { track, index } = found;
  const left = found.clip;
  const right = track.clips[index + 1];
  if (!right) return doc;
  const cutMin = left.startSec + 0.05;
  const cutMax = right.startSec + right.durationSec - 0.05;
  const cut = Math.max(cutMin, Math.min(cutMax, newCutSec));

  const leftDelta = cut - (left.startSec + left.durationSec);
  const rightDelta = cut - right.startSec;

  const nextLeft: TimelineClip = {
    ...left,
    durationSec: left.durationSec + leftDelta,
    outSec: left.outSec + leftDelta * left.speed,
  };
  const nextRight: TimelineClip = {
    ...right,
    startSec: cut,
    durationSec: right.durationSec - rightDelta,
    inSec: right.inSec + rightDelta * right.speed,
  };

  return mapTracks(doc, (tr) => {
    if (tr.id !== track.id) return tr;
    return {
      ...tr,
      clips: tr.clips.map((c) => {
        if (c.id === left.id) return nextLeft;
        if (c.id === right.id) return nextRight;
        return c;
      }),
    };
  });
}

export function updateClip(
  doc: TimelineDocument,
  clipId: string,
  patch: Partial<
    Pick<
      TimelineClip,
      | "volume"
      | "fadeInSec"
      | "fadeOutSec"
      | "speed"
      | "source"
      | "inSec"
      | "outSec"
      | "durationSec"
      | "startSec"
      | "linkedShotId"
    >
  >,
): TimelineDocument {
  return mapTracks(doc, (track) => ({
    ...track,
    clips: track.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
  }));
}

/** Replace take source on a linked clip in place. */
export function swapTakeOnClip(
  doc: TimelineDocument,
  clipId: string,
  take: {
    takeId: string;
    shotId: string;
    assetId: string;
    proxyAssetId?: string;
    trimStartSec?: number;
    trimEndSec?: number;
  },
): TimelineDocument {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const { clip } = found;
  const inSec = take.trimStartSec ?? 0;
  const outSec =
    take.trimEndSec !== undefined && take.trimEndSec > inSec
      ? take.trimEndSec
      : inSec + clip.durationSec;
  const sourceLen = Math.max(0.1, outSec - inSec);
  const durationSec = Math.min(clip.durationSec, sourceLen);

  return updateClip(doc, clipId, {
    inSec,
    outSec: inSec + durationSec,
    durationSec,
    linkedShotId: take.shotId,
    source: {
      type: "take",
      takeId: take.takeId,
      shotId: take.shotId,
      assetId: take.assetId,
      proxyAssetId: take.proxyAssetId,
    },
  });
}

export function addClip(
  doc: TimelineDocument,
  trackId: string,
  clip: TimelineClip,
): TimelineDocument {
  return mapTracks(doc, (track) => {
    if (track.id !== trackId) return track;
    return {
      ...track,
      clips: [...track.clips, clip].sort((a, b) => a.startSec - b.startSec),
    };
  });
}

/** Snap a time to nearby clip edges / playhead within threshold. */
export function snapTime(
  doc: TimelineDocument,
  t: number,
  playheadSec: number | null,
  thresholdSec: number,
): number {
  const points: number[] = [0];
  if (playheadSec !== null) points.push(playheadSec);
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      points.push(clip.startSec, clip.startSec + clip.durationSec);
    }
  }
  let best = t;
  let bestDist = thresholdSec;
  for (const p of points) {
    const d = Math.abs(p - t);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export function clipsAtTime(
  doc: TimelineDocument,
  t: number,
  kinds?: TrackKind[],
): Array<{ track: TimelineTrack; clip: TimelineClip }> {
  const out: Array<{ track: TimelineTrack; clip: TimelineClip }> = [];
  for (const track of doc.tracks) {
    if (kinds && !kinds.includes(track.kind)) continue;
    if (track.muted) continue;
    for (const clip of track.clips) {
      if (t >= clip.startSec && t < clip.startSec + clip.durationSec) {
        out.push({ track, clip });
      }
    }
  }
  return out;
}
