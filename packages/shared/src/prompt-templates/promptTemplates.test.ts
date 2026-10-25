import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assetSheetSectionKeys,
  CHARACTER_EXAMPLE_ART_STYLE,
  characterSheetFixture,
  characterSheetSchema,
  CREATURE_EXAMPLE_ART_STYLE,
  creatureSheetFixture,
  creatureSheetSchema,
  ENVIRONMENT_EXAMPLE_ART_STYLE,
  environmentSheetFixture,
  environmentSheetSchema,
  lookDevPatchFromAssetSheet,
  normalizePromptText,
  parseScriptPromptText,
  PRODUCT_EXAMPLE_ART_STYLE,
  productSheetFixture,
  productSheetSchema,
  renderCharacterSheet,
  renderCreatureSheet,
  renderEnvironmentSheet,
  renderProductSheet,
  renderScriptPrompt,
  scriptPromptFixture,
  scriptPromptSchema,
  validateScriptPromptText,
} from "./index";

const examplesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../prompt-templates/examples",
);

function loadExample(name: string): string {
  return normalizePromptText(readFileSync(join(examplesDir, name), "utf8"));
}

function expectSameSectionStructure(rendered: string, example: string) {
  const renderedKeys = assetSheetSectionKeys(normalizePromptText(rendered));
  const exampleKeys = assetSheetSectionKeys(example);
  expect(renderedKeys).toEqual(exampleKeys);
}

describe("asset sheet schemas", () => {
  it("accepts character fixture", () => {
    expect(characterSheetSchema.parse(characterSheetFixture)).toEqual(
      characterSheetFixture,
    );
  });
  it("rejects empty character subject", () => {
    expect(() =>
      characterSheetSchema.parse({ ...characterSheetFixture, subjectLine: "" }),
    ).toThrow();
  });
  it("accepts creature / environment / product fixtures", () => {
    expect(creatureSheetSchema.parse(creatureSheetFixture)).toBeTruthy();
    expect(environmentSheetSchema.parse(environmentSheetFixture)).toBeTruthy();
    expect(productSheetSchema.parse(productSheetFixture)).toBeTruthy();
  });
});

describe("asset sheet renderers vs examples", () => {
  it("character sheet matches section structure", () => {
    const rendered = renderCharacterSheet(
      characterSheetFixture,
      CHARACTER_EXAMPLE_ART_STYLE,
    );
    const example = loadExample("character-sheet.txt");
    expectSameSectionStructure(rendered, example);
    expect(normalizePromptText(rendered)).toBe(example);
  });

  it("creature sheet matches section structure", () => {
    const rendered = renderCreatureSheet(
      creatureSheetFixture,
      CREATURE_EXAMPLE_ART_STYLE,
    );
    const example = loadExample("creature-sheet.txt");
    expectSameSectionStructure(rendered, example);
    expect(normalizePromptText(rendered)).toBe(example);
  });

  it("environment sheet matches section structure", () => {
    const rendered = renderEnvironmentSheet(
      environmentSheetFixture,
      ENVIRONMENT_EXAMPLE_ART_STYLE,
    );
    const example = loadExample("environment-illustration.txt");
    expectSameSectionStructure(rendered, example);
    expect(normalizePromptText(rendered)).toBe(example);
  });

  it("product sheet matches section structure", () => {
    const rendered = renderProductSheet(
      productSheetFixture,
      PRODUCT_EXAMPLE_ART_STYLE,
    );
    const example = loadExample("product-illustration.txt");
    expectSameSectionStructure(rendered, example);
    expect(normalizePromptText(rendered)).toBe(example);
  });
});

describe("script prompt", () => {
  it("validates fixture", () => {
    expect(scriptPromptSchema.parse(scriptPromptFixture)).toBeTruthy();
  });

  it("renders REFERENCES, ART STYLE, IMAGE QUALITY, SHOTS, CONSISTENCY sections in order", () => {
    const text = renderScriptPrompt(scriptPromptFixture);
    const markers = [
      "REFERENCES",
      "ART STYLE — LOCKED TO THE REFERENCE IMAGES:",
      "IMAGE QUALITY — ALWAYS SHARP AND CLEAN:",
      "THE BOY —",
      "LOCATION —",
      "SHOTS (",
      "CONSISTENCY:",
      "MOTION AND PHYSICS:",
      "LIGHTING:",
      "TECHNICAL:",
      "MUSIC:",
      "AUDIO",
    ];
    let last = -1;
    for (const m of markers) {
      const idx = text.indexOf(m);
      expect(idx, `missing ${m}`).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("shot format matches example style", () => {
    const text = renderScriptPrompt(scriptPromptFixture);
    expect(text).toContain(
      "Shot 3 (3.0s–4.0s) — Extreme close-up, low in the grass:",
    );
  });

  it("parses rendered fixture shots and references", () => {
    const text = renderScriptPrompt(scriptPromptFixture);
    const parsed = parseScriptPromptText(text);
    expect(parsed.references).toHaveLength(
      scriptPromptFixture.references.length,
    );
    expect(parsed.references[0]!.entityLabel).toBe("the boy");
    expect(parsed.shots).toHaveLength(scriptPromptFixture.shots.length);
    expect(parsed.shots[2]!.shotType).toBe("Extreme close-up");
    expect(parsed.shots[2]!.cameraMove).toBe("low in the grass");
    expect(parsed.shots[0]!.startSec).toBe(0);
    expect(parsed.shots[0]!.endSec).toBe(1.5);
    expect(parsed.totalDurationSec).toBe(30);
    expect(parsed.multiShot).toBe(true);
    expect(parsed.location.imageN).toBe(3);
    expect(parsed.castBlocks.length).toBeGreaterThanOrEqual(3);
  });

  it("parses golden example shot count and validates", () => {
    const example = loadExample("script-prompt.txt");
    const parsed = parseScriptPromptText(example);
    expect(parsed.shots.length).toBe(24);
    expect(parsed.shots[23]!.n).toBe(24);
    expect(parsed.references).toHaveLength(6);
    expect(validateScriptPromptText(example)).toEqual({ ok: true });
  });

  it("warns on non-contiguous shots and unknown refs", () => {
    const badTimes = renderScriptPrompt({
      ...scriptPromptFixture,
      shots: [
        {
          n: 1,
          startSec: 0,
          endSec: 1,
          shotType: "Wide",
          action: "a",
        },
        {
          n: 2,
          startSec: 2,
          endSec: 3,
          shotType: "Wide",
          action: "b",
        },
      ],
      totalDurationSec: 3,
    });
    expect(validateScriptPromptText(badTimes).ok).toBe(false);
    expect(validateScriptPromptText(badTimes).warning).toMatch(/contiguous/i);

    const withUnknown = `${renderScriptPrompt(scriptPromptFixture)}\nExtra @image_99 mention.`;
    expect(validateScriptPromptText(withUnknown).warning).toMatch(/@image_99/);
  });
});

describe("lookDevPatchFromAssetSheet", () => {
  it("maps character fields into Look Dev sheet patch", () => {
    const patch = lookDevPatchFromAssetSheet(
      "character",
      characterSheetFixture,
    );
    expect(patch.description).toContain("teenage boy");
    expect(patch.sheetPatch.look).toContain("Deep brown skin");
    expect(patch.sheetPatch.wardrobe).toContain("leather");
    expect(patch.sheetPatch.personality).toContain("goggles");
  });
});
