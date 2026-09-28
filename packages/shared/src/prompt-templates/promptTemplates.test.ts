import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  blockoutSheetToDocuments,
  characterSheetSchema,
  creatureSheetSchema,
  environmentSheetSchema,
  productSheetSchema,
  scriptPromptSchema,
  blockoutSheetSchema,
  normalizePromptText,
  renderBlockoutSheet,
  renderCharacterSheet,
  renderCreatureSheet,
  renderEnvironmentSheet,
  renderProductSheet,
  renderScriptPrompt,
  assetSheetSectionKeys,
  assembleSingleShotPrompt,
  CHARACTER_EXAMPLE_ART_STYLE,
  CREATURE_EXAMPLE_ART_STYLE,
  ENVIRONMENT_EXAMPLE_ART_STYLE,
  PRODUCT_EXAMPLE_ART_STYLE,
  characterSheetFixture,
  creatureSheetFixture,
  environmentSheetFixture,
  productSheetFixture,
  scriptPromptFixture,
  blockoutSheetFixture,
  deriveCastBlockFromAssetSheet,
  deriveDescription,
  lookDevPatchFromAssetSheet,
  parseScriptPromptText,
  validateScriptPromptText,
} from "./index";

const examplesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../prompt-templates/examples",
);

function loadExample(name: string): string {
  return normalizePromptText(
    readFileSync(join(examplesDir, name), "utf8"),
  );
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
    expect(parsed.references).toHaveLength(scriptPromptFixture.references.length);
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

describe("assembleSingleShotPrompt", () => {
  it("slices to one remapped shot with multiShot false", () => {
    const single = assembleSingleShotPrompt(scriptPromptFixture, 3);
    expect(single.multiShot).toBe(false);
    expect(single.shots).toHaveLength(1);
    expect(single.shots[0]!.n).toBe(1);
    expect(single.shots[0]!.startSec).toBe(0);
    expect(single.shots[0]!.endSec).toBe(1);
    expect(single.totalDurationSec).toBe(1);
    expect(single.shots[0]!.action).toBe(scriptPromptFixture.shots[2]!.action);
    const text = renderScriptPrompt(single);
    expect(text).toContain("single-shot");
    expect(text).toContain("Shot 1 (0.0s–1.0s)");
  });
});

describe("deriveCastBlockFromAssetSheet", () => {
  it("builds description from character sheet fields", () => {
    const block = deriveCastBlockFromAssetSheet("character", characterSheetFixture, {
      name: "boy",
      imageN: 1,
      suffix: ", identical in every shot",
    });
    expect(block.description).toContain("Deep brown skin");
    expect(block.description).toContain("goggles");
    expect(deriveDescription("character", characterSheetFixture)).toBe(
      block.description,
    );
  });
});

describe("lookDevPatchFromAssetSheet", () => {
  it("maps character fields into Look Dev sheet patch", () => {
    const patch = lookDevPatchFromAssetSheet("character", characterSheetFixture);
    expect(patch.description).toContain("teenage boy");
    expect(patch.sheetPatch.look).toContain("Deep brown skin");
    expect(patch.sheetPatch.wardrobe).toContain("leather");
    expect(patch.sheetPatch.personality).toContain("goggles");
  });
});

describe("blockout sheet", () => {
  it("validates fixture", () => {
    expect(blockoutSheetSchema.parse(blockoutSheetFixture)).toBeTruthy();
  });

  it("renders SHOT 03 and SHOT 22 worked examples", () => {
    const text = renderBlockoutSheet(blockoutSheetFixture);
    expect(text).toContain(
      "SHOT 03 · 3.0–4.0s (1.0s) · Extreme close-up · 100mm · slow push-in.",
    );
    expect(text).toContain("Frame must show: eyes centre, goggles on forehead");
    expect(text).toContain("Continuity: goggles UP");
    expect(text).toContain(
      "SHOT 22 · 25.0–26.0s (1.0s) · POV through scope · 200mm · slight settle.",
    );
    expect(text).toContain("Continuity: goggles DOWN, rifle drawn");
  });

  it("maps to cinakey.blockout documents", () => {
    const docs = blockoutSheetToDocuments(
      blockoutSheetFixture,
      { id: "p1", title: "Hunt", aspectRatio: "16:9", fps: 24 },
      [
        {
          id: "shot-3",
          sceneId: "sc1",
          order: 2,
          durationSec: 1,
          shotType: "Extreme close-up",
          characterIds: [],
          n: 3,
        },
        {
          id: "shot-22",
          sceneId: "sc1",
          order: 21,
          durationSec: 1,
          shotType: "POV through scope",
          characterIds: [],
          n: 22,
        },
      ],
    );
    expect(docs.size).toBe(2);
    const s3 = docs.get("shot-3");
    expect(s3?.schema).toBe("cinakey.blockout/1.0");
    expect(s3?.scenes[0]?.shots[0]?.lensMm).toBe(100);
    expect(s3?.scenes[0]?.shots[0]?.camera.keyframes.length).toBeGreaterThan(0);
  });
});
