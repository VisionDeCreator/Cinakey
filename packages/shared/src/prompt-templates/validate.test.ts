import { describe, expect, it } from "vitest";
import { validateAssetPromptText } from "./validate";

const sparseEnvironment = `THE SAVANNA

Wide golden grassland at dusk.`;

describe("validateAssetPromptText", () => {
  it("flags ART STYLE when no style reference image", () => {
    const result = validateAssetPromptText("environment", sparseEnvironment);
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/ART STYLE/);
    expect(result.warning).toMatch(/MOOD AND COLOR/);
    expect(result.warning).toMatch(/THE LAND|SKY AND LIGHT|LIGHT/);
    expect(result.warning).toMatch(/no people|no animals|no creatures/);
  });

  it("skips ART STYLE when hasStyleReference is true", () => {
    const result = validateAssetPromptText("environment", sparseEnvironment, {
      hasStyleReference: true,
    });
    expect(result.ok).toBe(false);
    expect(result.warning).not.toMatch(/ART STYLE/);
    expect(result.warning).toMatch(/MOOD AND COLOR/);
    expect(result.warning).toMatch(/THE LAND|SKY AND LIGHT|LIGHT/);
  });

  it("passes when required sections are present with style reference", () => {
    const text = `Wide environment illustration of a flooded Norse temple hall. No people, no creatures.

MOOD AND COLOR
Warm golds and deep greens.

THE HALL
Massive carved columns in dark-jade water.

LIGHT
Golden shafts through the collapsed vault.`;
    const result = validateAssetPromptText("environment", text, {
      hasStyleReference: true,
    });
    expect(result).toEqual({ ok: true });
  });

  it("accepts legacy COLOR PALETTE as MOOD AND COLOR", () => {
    const text = `COLOR PALETTE: golds.

BODY: long serpentine form.

HEAD: dragon-like snout.

MARKINGS: glowing cyan spots.`;
    const result = validateAssetPromptText("creature", text, {
      hasStyleReference: true,
    });
    expect(result).toEqual({ ok: true });
  });
});
