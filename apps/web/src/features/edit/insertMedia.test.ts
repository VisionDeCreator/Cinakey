import { expect, it } from "vitest";
import { createEmptyTimeline, assertTimelineDocument } from "@cinakey/shared";
import { insertMedia } from "./insertMedia";
import { createHistory, pushDocument, undo } from "./timelineHistory";
const empty = () =>
  createEmptyTimeline({ id: "p", aspectRatio: "16:9", fps: 24 });
const media = {
  assetId: "video",
  type: "video",
  durationSec: 6,
  inSec: 2,
  outSec: 8,
};
it("edits an imported asset without scene, shot, or generation records and undoes as one action", () => {
  const doc = empty();
  const result = insertMedia(doc, media, 0, "imported");
  expect(assertTimelineDocument(result.doc)).toEqual(result.doc);
  expect(result.doc.tracks[0]!.clips[0]).toMatchObject({
    id: "imported",
    source: { type: "asset", assetId: "video" },
    inSec: 2,
    outSec: 8,
  });
  expect(result.doc.durationSec).toBe(6);
  expect(undo(pushDocument(createHistory(doc), result.doc)).present).toEqual(
    doc,
  );
});
it("splits and shifts footage at a drop without losing its original source ranges", () => {
  const original = insertMedia(empty(), media, 0, "original").doc;
  const inserted = insertMedia(
    original,
    {
      ...media,
      assetId: "second",
      durationSec: 2,
      inSec: 0,
      outSec: 2,
      startSec: 3,
    },
    0,
    "second",
  ).doc;
  expect(
    inserted.tracks[0]!.clips.map((clip) => [
      clip.startSec,
      clip.durationSec,
      clip.inSec,
      clip.outSec,
    ]),
  ).toEqual([
    [0, 3, 2, 5],
    [3, 2, 0, 2],
    [5, 3, 5, 8],
  ]);
  expect(inserted.durationSec).toBe(8);
  expect(original.tracks[0]!.clips).toHaveLength(1);
});
it("routes audio to an audio lane even when dropped on video, and preserves the video", () => {
  const original = insertMedia(empty(), media, 0).doc;
  const result = insertMedia(
    original,
    { ...media, type: "music", trackId: original.tracks[0]!.id },
    1,
  ).doc;
  expect(result.tracks[0]).toEqual(original.tracks[0]);
  expect(
    result.tracks.find((track) => track.kind === "music")!.clips,
  ).toHaveLength(1);
});
it("rejects unknown durations and snaps drop timing to project frames", () => {
  expect(() =>
    insertMedia(empty(), { ...media, outSec: 0, durationSec: 0 }, 0),
  ).toThrow();
  expect(insertMedia(empty(), { ...media, startSec: 1.019 }, 0).startSec).toBe(
    1,
  );
});
