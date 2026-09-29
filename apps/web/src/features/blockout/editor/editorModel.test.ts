import { describe, expect, it } from "vitest";
import {
  createObject,
  keyCameraAtFrame,
  placeInFrontOfCamera,
} from "./editorModel";
import { emptyPartDocument } from "@cinakey/shared";

describe("editorModel", () => {
  it("places objects in front of camera", () => {
    const at = placeInFrontOfCamera({
      pos: [0, 1.6, 6],
      target: [0, 1.4, 0],
      focal: 35,
      roll: 0,
    });
    expect(at.z).toBeLessThan(6);
  });

  it("keys camera at frame", () => {
    const doc = emptyPartDocument({
      id: "p",
      title: "T",
      aspectRatio: "16:9",
      fps: 24,
    });
    const { doc: next, key } = keyCameraAtFrame(doc, 12, {
      pos: [1, 2, 3],
      target: [0, 1, 0],
      focal: 50,
      roll: 0,
    });
    expect(key.f).toBe(12);
    expect(next.camera.keys.some((k) => k.f === 12)).toBe(true);
  });

  it("creates a character in front of camera", () => {
    const o = createObject("character", {
      pos: [0, 1.6, 6],
      target: [0, 1.4, 0],
      focal: 35,
      roll: 0,
    });
    expect(o.type).toBe("character");
    expect(o.keys).toEqual([]);
  });
});
