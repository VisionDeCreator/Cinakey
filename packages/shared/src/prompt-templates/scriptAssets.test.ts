import { describe, expect, it } from "vitest";
import { parseScriptPromptText } from "./parse";
import {
  inferAssetTypeFromScriptRef,
  requiredAssetsFromScript,
  seedAssetPromptFromScriptDescription,
} from "./scriptAssets";

const SAMPLE = `REFERENCES
@image_1 = the boy. Use it for his exact face, hair and clothing.
@image_2 = the giant cheetah. Use it for its exact body and saddle.
@image_3 = the savanna. Use it for the exact grassland and sky.
@image_4 = the rifle. Use it for its exact wooden stock and brass scope.

ART STYLE — LOCKED TO THE REFERENCE IMAGES:
Soft painted anime illustration.

IMAGE QUALITY — ALWAYS SHARP AND CLEAN:
Every frame sharp.

THE BOY — @image_1, identical in every shot:
A lean teenage boy with deep brown skin and amber goggles.

THE CHEETAH — @image_2: a horse-sized cheetah with a golden coat.

THE RIFLE — @image_4: a long hunting rifle with brass fittings.

LOCATION — @image_3: golden savanna at sunset. No readable text.

SHOTS (6 seconds total, multi-shot, 16:9):
Shot 1 (0.0s–3.0s) — Wide shot: the @image_3 savanna.
Shot 2 (3.0s–6.0s) — Medium shot: the boy on the cheetah.

CONSISTENCY:
Stay consistent.

MOTION AND PHYSICS:
Realistic motion.

LIGHTING:
Warm sunset.

TECHNICAL:
16:9, 24fps.

MUSIC:
Soft score.

AUDIO (native sound, synced to picture, no dialogue):
0.0s wind.
`;

describe("script → required assets", () => {
  it("infers types from reference labels", () => {
    expect(
      inferAssetTypeFromScriptRef({
        entityLabel: "the boy",
        useFor: "Use it for his exact face",
      }),
    ).toBe("character");
    expect(
      inferAssetTypeFromScriptRef({
        entityLabel: "the giant cheetah",
        useFor: "Use it for its exact body",
      }),
    ).toBe("creature");
    expect(
      inferAssetTypeFromScriptRef({
        entityLabel: "the rifle",
        useFor: "Use it for its exact wooden stock",
      }),
    ).toBe("product");
    expect(
      inferAssetTypeFromScriptRef({
        entityLabel: "the savanna",
        useFor: "Use it for grassland",
        isLocation: true,
      }),
    ).toBe("environment");
  });

  it("collects required assets from a parsed script", () => {
    const parsed = parseScriptPromptText(SAMPLE);
    const required = requiredAssetsFromScript(parsed);
    expect(required.map((r) => r.imageN)).toEqual([1, 2, 3, 4]);
    expect(required.find((r) => r.imageN === 1)?.assetType).toBe("character");
    expect(required.find((r) => r.imageN === 2)?.assetType).toBe("creature");
    expect(required.find((r) => r.imageN === 3)?.assetType).toBe(
      "environment",
    );
    expect(required.find((r) => r.imageN === 4)?.assetType).toBe("product");
    expect(required.find((r) => r.imageN === 1)?.description).toMatch(/teenage boy/);
  });

  it("seeds draft prompts with required sections", () => {
    const text = seedAssetPromptFromScriptDescription(
      "creature",
      "cheetah",
      "a horse-sized cheetah",
      "painted style",
    );
    expect(text).toContain("ART STYLE:");
    expect(text).toContain("BODY:");
    expect(text).toContain("horse-sized cheetah");
  });
});
