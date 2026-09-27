import { describe, expect, it } from "vitest";
import {
  createEmptyScript,
  newScriptElementId,
  withRuntimeEstimates,
  type ScriptDocument,
} from "@cinakey/shared";

/** Pure helpers exercised here; materialize is covered via Convex integration later. */
describe("script materialize helpers", () => {
  it("stamps ids and runtime on a draft scene", () => {
    const doc: ScriptDocument = {
      ...createEmptyScript("screenplay"),
      scenes: [
        {
          id: newScriptElementId(),
          heading: "INT. LAB - NIGHT",
          beats: [
            {
              id: newScriptElementId(),
              action: "Lights flicker.",
              lines: [
                {
                  id: newScriptElementId(),
                  characterName: "ADA",
                  dialogue: "We have one shot.",
                },
              ],
            },
          ],
        },
      ],
    };
    const stamped = withRuntimeEstimates(doc);
    expect(stamped.totalEstimatedDurationSec).toBeGreaterThan(0);
    expect(stamped.scenes[0]!.estimatedDurationSec).toBeGreaterThan(0);
  });
});
