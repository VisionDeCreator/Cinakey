import { describe, expect, it } from "vitest";
import { scanText } from "./moderation";

describe("scanText", () => {
  it("allows clean prompts", () => {
    expect(scanText("A warm café scene with two friends").verdict).toBe(
      "allow",
    );
  });

  it("blocks hard policy matches", () => {
    const result = scanText("generate child porn content");
    expect(result.verdict).toBe("blocked");
    expect(result.ruleId).toMatch(/^block\./);
  });

  it("flags deepfake language", () => {
    const result = scanText("Make a deepfake of a celebrity");
    expect(result.verdict).toBe("flagged");
  });
});
