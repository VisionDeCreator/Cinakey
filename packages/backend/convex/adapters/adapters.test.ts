import { describe, expect, it } from "vitest";
import { getAdapter, listAdapters } from "./index";

describe("model adapters", () => {
  it("registers launch stubs", () => {
    const ids = listAdapters().map((a) => a.capabilities.id);
    expect(ids).toEqual(
      expect.arrayContaining(["seedance-2.5", "gpt-image-2", "deepseek"]),
    );
    expect(getAdapter("seedance-2.5")?.capabilities.kind).toBe("video");
  });
});
