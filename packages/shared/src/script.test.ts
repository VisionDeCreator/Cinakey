import { describe, expect, it } from "vitest";
import {
  createEmptyScript,
  diffScripts,
  estimateScriptRuntime,
  extractCharacterNames,
  extractLocationNames,
  isScriptDocument,
  normalizeEntityName,
  withRuntimeEstimates,
  type ScriptDocument,
} from "./script";

function sampleDoc(): ScriptDocument {
  return {
    schema: "cinakey.script/1.0",
    format: "screenplay",
    scenes: [
      {
        id: "s1",
        heading: "INT. COFFEE SHOP - DAY",
        beats: [
          {
            id: "b1",
            action: "Maya sits alone.",
            lines: [
              {
                id: "l1",
                characterName: "MAYA",
                dialogue: "I never thought it would end like this.",
              },
              {
                id: "l2",
                characterName: "JORDAN",
                parenthetical: "softly",
                dialogue: "Neither did I.",
              },
            ],
          },
        ],
      },
    ],
    entityLinks: [],
  };
}

describe("cinakey.script/1.0", () => {
  it("creates an empty valid document", () => {
    const doc = createEmptyScript("av");
    expect(isScriptDocument(doc)).toBe(true);
    expect(doc.format).toBe("av");
    expect(doc.scenes).toEqual([]);
  });

  it("estimates runtime from dialogue and action", () => {
    const estimate = estimateScriptRuntime(sampleDoc());
    expect(estimate.perScene).toHaveLength(1);
    expect(estimate.perScene[0]!.sceneId).toBe("s1");
    expect(estimate.totalSec).toBeGreaterThan(0);
    expect(estimate.totalSec).toBe(estimate.perScene[0]!.durationSec);
  });

  it("stamps runtime onto the document", () => {
    const stamped = withRuntimeEstimates(sampleDoc());
    expect(stamped.totalEstimatedDurationSec).toBeGreaterThan(0);
    expect(stamped.scenes[0]!.estimatedDurationSec).toBe(
      stamped.totalEstimatedDurationSec,
    );
  });

  it("extracts characters and locations", () => {
    const doc = sampleDoc();
    expect(extractCharacterNames(doc)).toEqual(["MAYA", "JORDAN"]);
    expect(extractLocationNames(doc)).toEqual(["COFFEE SHOP"]);
    expect(normalizeEntityName("  maya  ")).toBe("MAYA");
  });

  it("diffs scripts by stable ids", () => {
    const before = sampleDoc();
    const after: ScriptDocument = {
      ...before,
      scenes: [
        {
          ...before.scenes[0]!,
          heading: "INT. COFFEE SHOP - NIGHT",
          beats: [
            {
              ...before.scenes[0]!.beats[0]!,
              lines: [
                before.scenes[0]!.beats[0]!.lines[0]!,
                {
                  id: "l3",
                  characterName: "MAYA",
                  dialogue: "Wait.",
                },
              ],
            },
          ],
        },
      ],
    };
    const ops = diffScripts(before, after);
    expect(ops.some((o) => o.op === "change" && o.path.includes("heading"))).toBe(
      true,
    );
    expect(ops.some((o) => o.op === "add" && o.path.includes("l3"))).toBe(true);
    expect(ops.some((o) => o.op === "remove" && o.path.includes("l2"))).toBe(true);
  });
});
