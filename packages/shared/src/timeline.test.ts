import { describe, expect, it } from "vitest";
import { timelineWithMedia } from "../test/timelineFixture";
import {
  TIMELINE_SCHEMA_ID,
  assertTimelineDocument,
  createEmptyTimeline,
  deleteClip,
  moveClip,
  rippleTrim,
  rollTrim,
  splitClip,
  validateTimelineDocument,
} from "./timeline";

const project = { id: "proj_1", aspectRatio: "16:9", fps: 24 };

describe("dirrio.timeline/1.0", () => {
  it("creates and validates an empty timeline", () => {
    const doc = createEmptyTimeline(project);
    expect(doc.schema).toBe(TIMELINE_SCHEMA_ID);
    expect(doc.tracks).toHaveLength(5);
    expect(validateTimelineDocument(doc)).toBeNull();
    expect(assertTimelineDocument(doc)).toEqual(doc);
  });

  it("rejects invalid schema", () => {
    expect(validateTimelineDocument({ schema: "nope" })).toMatch(
      /Invalid|schema/i,
    );
  });

  it("builds a timeline fixture with ordered media clips and captions", () => {
    const doc = timelineWithMedia({
      project,
      dialogueByLineId: {
        line_a: {
          id: "line_a",
          characterName: "Alex",
          dialogue: "Hello there.",
        },
      },
      clips: [
        {
          order: 1,
          durationSec: 3,

          assetId: "asset_2",
          mediaDurationSec: 10,
        },
        {
          order: 0,
          durationSec: 2,
          dialogueLineId: "line_a",

          assetId: "asset_1",
          proxyAssetId: "proxy_1",
          trimStartSec: 1,
          trimEndSec: 4,
        },
      ],
    });

    expect(validateTimelineDocument(doc)).toBeNull();
    const video = doc.tracks.find((t) => t.kind === "video")!;
    const dialogue = doc.tracks.find((t) => t.kind === "dialogue")!;
    expect(video.clips).toHaveLength(2);
    // Ordered clips retain their media windows.
    expect(video.clips[0]!.source).toMatchObject({
      type: "asset",
    });
    expect(video.clips[0]!.startSec).toBe(0);
    expect(video.clips[0]!.durationSec).toBe(2);
    expect(video.clips[0]!.inSec).toBe(1);
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

  it("uses media trim window for source in/out", () => {
    const doc = timelineWithMedia({
      project,
      clips: [
        {
          order: 0,
          durationSec: 5,

          assetId: "master",
          trimStartSec: 10,
          trimEndSec: 12,
        },
      ],
    });
    const clip = doc.tracks.find((t) => t.kind === "video")!.clips[0]!;
    expect(clip.inSec).toBe(10);
    expect(clip.outSec).toBe(12);
    expect(clip.durationSec).toBe(2);
  });

  it("splits, moves, deletes, ripple and roll trims", () => {
    let doc = timelineWithMedia({
      project,
      clips: [
        {
          order: 0,
          durationSec: 4,
          assetId: "aa",
          mediaDurationSec: 10,
        },
        {
          order: 1,
          durationSec: 4,
          assetId: "ab",
          mediaDurationSec: 10,
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
    doc = timelineWithMedia({
      project,
      clips: [
        {
          order: 0,
          durationSec: 4,
          assetId: "aa",
          mediaDurationSec: 10,
        },
        {
          order: 1,
          durationSec: 4,
          assetId: "ab",
          mediaDurationSec: 10,
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
});
