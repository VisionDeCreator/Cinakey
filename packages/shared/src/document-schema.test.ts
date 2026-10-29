import { describe, expect, it } from "vitest";
import {
  assertTimelineDocument,
  createEmptyTimeline,
  validateTimelineDocument,
} from "./timeline";
import { assertSheetDocument, createEmptySheet } from "./sheet";
import {
  assertBlockoutDocument,
  emptyPartDocument,
  migrateToV2,
  validateBlockoutDocument,
} from "./blockout";

describe("document namespace compatibility", () => {
  it("preserves saved timeline content and emits the current namespace", () => {
    const original = createEmptyTimeline({
      id: "project",
      fps: 24,
      aspectRatio: "16:9",
    });
    const imported = { ...original, schema: "previous.timeline/1.0" };
    expect(validateTimelineDocument(imported)).toBeNull();
    expect(assertTimelineDocument(imported)).toEqual(original);
    expect(imported.schema).toBe("previous.timeline/1.0");
    expect(
      validateTimelineDocument({ ...imported, tracks: "invalid" }),
    ).not.toBeNull();
    expect(
      validateTimelineDocument({
        ...imported,
        schema: "previous.timeline/2.0",
      }),
    ).not.toBeNull();
  });
  it("preserves sheet versions and references when importing an older namespace", () => {
    const original = {
      ...createEmptySheet("character"),
      version: 7,
      identitySlots: { front: "asset" },
    };
    expect(
      assertSheetDocument({ ...original, schema: "previous.sheet/1.0" }),
    ).toEqual(original);
    expect(() =>
      assertSheetDocument({ ...original, schema: "previous.sheet/3.0" }),
    ).toThrow();
  });
  it("preserves staging documents through migration, validation and canonical export", () => {
    const original = emptyPartDocument();
    const imported = { ...original, schema: "previous.blockout/2.0" };
    expect(validateBlockoutDocument(imported)).toBeNull();
    expect(migrateToV2(imported)).toEqual(original);
    expect(assertBlockoutDocument(imported)).toEqual(original);
    expect(
      validateBlockoutDocument({
        ...imported,
        schema: "previous.blockout/3.0",
      }),
    ).not.toBeNull();
  });
});
