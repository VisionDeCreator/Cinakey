import { describe, expect, it } from "vitest";
import {
  assembleLookDevPrompt,
  assembleShotKeyframePrompt,
  createEmptySheet,
  lockedIdsFromSheet,
  mergeSheet,
  styleSheetToPromptText,
} from "./sheet";

describe("cinakey.sheet/1.0 helpers", () => {
  it("creates an empty character sheet", () => {
    const sheet = createEmptySheet("character");
    expect(sheet.schema).toBe("cinakey.sheet/1.0");
    expect(sheet.version).toBe(1);
    expect(sheet.entityKind).toBe("character");
  });

  it("merges patches and bumps version with parent", () => {
    const base = createEmptySheet("character");
    const next = mergeSheet(base, { look: "green coat" }, "parent-file");
    expect(next.look).toBe("green coat");
    expect(next.version).toBe(2);
    expect(next.parentFileId).toBe("parent-file");
  });

  it("collects locked ids from identity and hero slots", () => {
    const sheet = mergeSheet(createEmptySheet("character"), {
      identitySlots: { front: "a1", profile: "a2" },
      expressionSlots: [{ label: "Smile", assetId: "a3" }],
    });
    expect(lockedIdsFromSheet(sheet).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("assembles look-dev prompts with style + entity + rules", () => {
    const style = mergeSheet(createEmptySheet("style"), {
      palette: "warm amber",
      lighting: "soft window light",
    });
    const character = mergeSheet(createEmptySheet("character"), {
      look: "green coat",
      age: "30s",
    });
    const prompt = assembleLookDevPrompt({
      styleSheet: style,
      entitySheet: character,
      entityName: "Maya",
      rules: ["No extreme close-ups"],
      userPrompt: "portrait reference",
    });
    expect(prompt).toContain("Palette: warm amber");
    expect(prompt).toContain("Character: Maya");
    expect(prompt).toContain("Project rules");
    expect(prompt).toContain("portrait reference");
    expect(styleSheetToPromptText(style)).toContain("Lighting");
  });

  it("assembles shot keyframe prompts from shot + sheets + rules", () => {
    const style = mergeSheet(createEmptySheet("style"), {
      palette: "cool blue",
      mood: "tense",
    });
    const character = mergeSheet(createEmptySheet("character"), {
      look: "green coat",
    });
    const location = mergeSheet(createEmptySheet("location"), {
      notes: "Rainy café window",
    });
    const prompt = assembleShotKeyframePrompt({
      shot: {
        shotType: "close-up",
        lensMm: 50,
        cameraMove: "static",
        durationSec: 3,
        dialogue: "You're late again.",
      },
      styleSheet: style,
      characters: [{ name: "Maya", sheet: character }],
      location: { name: "Café", sheet: location },
      rules: ["Warm natural light"],
    });
    expect(prompt).toContain("Palette: cool blue");
    expect(prompt).toContain("Character: Maya");
    expect(prompt).toContain("Location: Café");
    expect(prompt).toContain("Shot type: close-up");
    expect(prompt).toContain("50mm");
    expect(prompt).toContain("You're late again.");
    expect(prompt).toContain("Project rules");
    expect(prompt).toContain("storyboard");
  });
});
