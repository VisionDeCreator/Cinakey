import { describe, expect, it } from "vitest";
import { inferAssetTypeFromScriptRef } from "./scriptAssets";

describe("staging reference types", () => {
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
});
