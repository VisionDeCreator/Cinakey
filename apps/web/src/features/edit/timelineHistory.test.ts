import { expect, it } from "vitest";
import { convexToJson, jsonToConvex } from "convex/values";
import { timelineWithMedia } from "../../../../../packages/shared/test/timelineFixture";
import { documentHash } from "./timelineHistory";
it("matches saved snapshots after transport reorders nested object properties", () => {
  const doc = timelineWithMedia({
    project: { id: "project", aspectRatio: "16:9", fps: 24 },
    clips: [{ order: 0, durationSec: 4, assetId: "asset" }],
  });
  const transported = jsonToConvex(
    convexToJson(JSON.parse(JSON.stringify(doc))),
  ) as unknown as typeof doc;
  expect(documentHash(transported)).toBe(documentHash(doc));
  expect(
    documentHash({ ...transported, version: 42, parentFileId: "parent" }),
  ).toBe(documentHash(doc));
  const changed = structuredClone(transported);
  changed.tracks[0]!.clips[0]!.startSec = 1;
  expect(documentHash(changed)).not.toBe(documentHash(doc));
});
