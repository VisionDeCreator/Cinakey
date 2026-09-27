import { tracksFromShot, validateBlockoutDocument } from "@cinakey/shared";
import { describe, expect, it } from "vitest";
import {
  applyTransformEdit,
  buildEditorDocument,
  createDefaultShotState,
  formatTimecode,
  upsertKeyframe,
  type ShotMeta,
} from "./editorModel";

const shot: ShotMeta = {
  _id: "shot1",
  sceneId: "scene1",
  order: 0,
  durationSec: 5,
  shotType: "medium",
  lensMm: 50,
  characterIds: ["c1", "c2"],
};

describe("editorModel", () => {
  it("seeds one tagged mannequin per character plus camera, lights and set", () => {
    const state = createDefaultShotState(shot, [
      { id: "c1", name: "Ana" },
      { id: "c2", name: "Ben" },
    ]);
    const mannequins = state.nodes.filter((n) => n.kind === "mannequin");
    expect(mannequins.map((m) => m.entityId)).toEqual(["c1", "c2"]);
    expect(state.nodes.filter((n) => n.kind === "light").map((n) => n.lightRole)).toEqual([
      "key",
      "fill",
      "back",
    ]);
    expect(state.lensMm).toBe(50);
  });

  it("auto-keys animated nodes and edits the base transform of static ones", () => {
    let state = createDefaultShotState(shot, [{ id: "c1", name: "Ana" }]);
    const cam = state.cameraNodeId;
    const moved = { position: [0, 1.6, 3] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
    state = applyTransformEdit(state, cam, 0, moved);
    expect(state.tracks[cam]).toBeUndefined();
    expect(state.nodes.find((n) => n.id === cam)!.transform.position).toEqual([0, 1.6, 3]);

    state = { ...state, tracks: upsertKeyframe(state.tracks, cam, 0, moved) };
    state = applyTransformEdit(state, cam, 5, { ...moved, position: [0, 1.6, 1] });
    expect(state.tracks[cam]!.map((k) => k.t)).toEqual([0, 5]);

    const doc = buildEditorDocument(
      { id: "p", title: "P", aspectRatio: "16:9", fps: 24 },
      { id: "scene1", order: 0 },
      shot,
      state,
    );
    expect(validateBlockoutDocument(doc)).toBeNull();
    expect(tracksFromShot(doc.scenes[0]!.shots[0]!)).toEqual(state.tracks);
  });

  it("formats SMPTE-style timecode", () => {
    expect(formatTimecode(0, 24)).toBe("00:00:00:00");
    expect(formatTimecode(61.5, 24)).toBe("00:01:01:12");
  });
});
