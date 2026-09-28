import { describe, expect, it } from "vitest";
import {
  TIMELINE_SCHEMA_ID,
  assembleFromShotList,
  assertTimelineDocument,
  createEmptyTimeline,
  deleteClip,
  moveClip,
  rippleTrim,
  rollTrim,
  splitClip,
  swapTakeOnClip,
  validateTimelineDocument,
} from "./timeline";

const project = { id: "proj_1", aspectRatio: "16:9", fps: 24 };

describe("cinakey.timeline/1.0", () => {
  it("creates and validates an empty timeline", () => {
    const doc = createEmptyTimeline(project);
    expect(doc.schema).toBe(TIMELINE_SCHEMA_ID);
    expect(doc.tracks).toHaveLength(5);
    expect(validateTimelineDocument(doc)).toBeNull();
    expect(assertTimelineDocument(doc)).toEqual(doc);
  });

  it("rejects invalid schema", () => {
    expect(validateTimelineDocument({ schema: "nope" })).toMatch(/Invalid|schema/i);
  });

  it("assembles a rough cut from selected takes with captions", () => {
    const doc = assembleFromShotList({
      project,
      dialogueByLineId: {
        line_a: {
          id: "line_a",
          characterName: "Alex",
          dialogue: "Hello there.",
        },
      },
      shots: [
        {
          shotId: "shot_2",
          sceneOrder: 0,
          shotOrder: 1,
          durationSec: 3,
          take: {
            takeId: "take_2",
            assetId: "asset_2",
            mediaDurationSec: 10,
          },
        },
        {
          shotId: "shot_1",
          sceneOrder: 0,
          shotOrder: 0,
          durationSec: 2,
          dialogueLineId: "line_a",
          take: {
            takeId: "take_1",
            assetId: "asset_1",
            proxyAssetId: "proxy_1",
            trimStartSec: 1,
            trimEndSec: 4,
          },
        },
      ],
    });

    expect(validateTimelineDocument(doc)).toBeNull();
    const video = doc.tracks.find((t) => t.kind === "video")!;
    const dialogue = doc.tracks.find((t) => t.kind === "dialogue")!;
    expect(video.clips).toHaveLength(2);
    // Sorted by shot order: shot_1 then shot_2
    expect(video.clips[0]!.source).toMatchObject({
      type: "take",
      takeId: "take_1",
      shotId: "shot_1",
    });
    expect(video.clips[0]!.startSec).toBe(0);
    expect(video.clips[0]!.durationSec).toBe(2);
    expect(video.clips[0]!.inSec).toBe(1);
    expect(video.clips[0]!.linkedShotId).toBe("shot_1");
    expect(video.clips[1]!.startSec).toBe(2);
    expect(video.clips[1]!.durationSec).toBe(3);
    expect(dialogue.clips).toHaveLength(1);
    expect(dialogue.clips[0]!.source).toMatchObject({
      type: "text",
      styleId: "caption",
      text: "Hello there.",
    });
    expect(doc.durationSec).toBe(5);
  });

  it("uses sequence trim window for source in/out", () => {
    const doc = assembleFromShotList({
      project,
      shots: [
        {
          shotId: "shot_s",
          sceneOrder: 0,
          shotOrder: 0,
          durationSec: 5,
          take: {
            takeId: "take_s",
            assetId: "master",
            trimStartSec: 10,
            trimEndSec: 12,
          },
        },
      ],
    });
    const clip = doc.tracks.find((t) => t.kind === "video")!.clips[0]!;
    expect(clip.inSec).toBe(10);
    expect(clip.outSec).toBe(12);
    expect(clip.durationSec).toBe(2);
  });

  it("splits, moves, deletes, ripple and roll trims", () => {
    let doc = assembleFromShotList({
      project,
      shots: [
        {
          shotId: "a",
          sceneOrder: 0,
          shotOrder: 0,
          durationSec: 4,
          take: { takeId: "ta", assetId: "aa", mediaDurationSec: 10 },
        },
        {
          shotId: "b",
          sceneOrder: 0,
          shotOrder: 1,
          durationSec: 4,
          take: { takeId: "tb", assetId: "ab", mediaDurationSec: 10 },
        },
      ],
    });
    const video = () => doc.tracks.find((t) => t.kind === "video")!;
    const firstId = video().clips[0]!.id;

    doc = splitClip(doc, firstId, 2);
    expect(video().clips).toHaveLength(3);
    expect(video().clips[0]!.durationSec).toBe(2);
    expect(video().clips[1]!.startSec).toBe(2);

    const midId = video().clips[1]!.id;
    doc = moveClip(doc, midId, 9);
    expect(video().clips.find((c) => c.id === midId)!.startSec).toBe(9);

    doc = deleteClip(doc, midId);
    expect(video().clips.find((c) => c.id === midId)).toBeUndefined();

    // Re-assemble clean two-clip timeline for ripple/roll
    doc = assembleFromShotList({
      project,
      shots: [
        {
          shotId: "a",
          sceneOrder: 0,
          shotOrder: 0,
          durationSec: 4,
          take: { takeId: "ta", assetId: "aa", mediaDurationSec: 10 },
        },
        {
          shotId: "b",
          sceneOrder: 0,
          shotOrder: 1,
          durationSec: 4,
          take: { takeId: "tb", assetId: "ab", mediaDurationSec: 10 },
        },
      ],
    });
    const leftId = video().clips[0]!.id;
    doc = rippleTrim(doc, leftId, "out", 3);
    expect(video().clips[0]!.durationSec).toBe(3);
    expect(video().clips[1]!.startSec).toBe(3);

    doc = rollTrim(doc, leftId, 2);
    expect(video().clips[0]!.durationSec).toBeCloseTo(2);
    expect(video().clips[1]!.startSec).toBeCloseTo(2);
  });

  it("swaps take on a linked clip in place", () => {
    let doc = assembleFromShotList({
      project,
      shots: [
        {
          shotId: "shot_1",
          sceneOrder: 0,
          shotOrder: 0,
          durationSec: 3,
          take: { takeId: "old", assetId: "a1", mediaDurationSec: 10 },
        },
      ],
    });
    const clipId = doc.tracks.find((t) => t.kind === "video")!.clips[0]!.id;
    doc = swapTakeOnClip(doc, clipId, {
      takeId: "new",
      shotId: "shot_1",
      assetId: "a2",
      proxyAssetId: "p2",
      trimStartSec: 0,
      trimEndSec: 5,
    });
    const clip = doc.tracks.find((t) => t.kind === "video")!.clips[0]!;
    expect(clip.source).toMatchObject({
      type: "take",
      takeId: "new",
      assetId: "a2",
      proxyAssetId: "p2",
    });
    expect(clip.startSec).toBe(0);
    expect(clip.durationSec).toBe(3);
  });
});
