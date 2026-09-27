import { describe, expect, it } from "vitest";
import { normalizeProposedScript } from "./normalizeScriptProposal";

describe("normalizeProposedScript", () => {
  it("repairs a partial LLM payload into cinakey.script/1.0", () => {
    const doc = normalizeProposedScript({
      format: "screenplay",
      scenes: [
        {
          heading: "EXT. FOREST - DAY",
          action: "A chase through the trees.",
          lines: [
            { character: "HERO", text: "Keep going!" },
            "BANDIT: You're mine!",
          ],
        },
      ],
    });
    expect(doc).not.toBeNull();
    expect(doc!.schema).toBe("cinakey.script/1.0");
    expect(doc!.scenes).toHaveLength(1);
    expect(doc!.scenes[0]!.heading).toBe("EXT. FOREST - DAY");
    expect(doc!.scenes[0]!.beats[0]!.lines.length).toBeGreaterThanOrEqual(2);
    expect(doc!.scenes[0]!.beats[0]!.lines[0]!.characterName).toBe("HERO");
  });

  it("returns null for empty scenes", () => {
    expect(normalizeProposedScript({ scenes: [] })).toBeNull();
    expect(normalizeProposedScript({})).toBeNull();
  });
});
