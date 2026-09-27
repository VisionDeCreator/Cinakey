import { describe, expect, it } from "vitest";
import { getAdapter, listAdapters, listRealAdapters } from "./index";

describe("model adapters", () => {
  it("registers launch adapters with operations and estimateCost", () => {
    const ids = listAdapters().map((a) => a.capabilities.id);
    expect(ids).toEqual(
      expect.arrayContaining(["seedance-2.5", "gpt-image-2", "deepseek"]),
    );
    expect(getAdapter("seedance-2.5")?.capabilities.kind).toBe("video");
    expect(getAdapter("gpt-image-2")?.capabilities.operations).toContain(
      "text-to-image",
    );
    expect(getAdapter("deepseek")?.estimateCost({ estimatedTokens: 2000 })).toBe(
      2,
    );
  });

  it("real adapters expose non-zero placeholder rates", () => {
    for (const a of listRealAdapters()) {
      expect(a.capabilities.costModel.creditsPerUnit).toBeGreaterThan(0);
      expect(a.capabilities.operations.length).toBeGreaterThan(0);
    }
  });
});
