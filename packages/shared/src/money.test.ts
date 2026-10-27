import { describe, expect, it } from "vitest";
import {
  chargeForUnits,
  formatUsd,
  parseUsdToMicros,
  usdInputValue,
  videoPrice,
} from "./money";
describe("USD amounts", () => {
  it("parses decimal dollars exactly and preserves micro-dollar amounts", () => {
    expect(parseUsdToMicros("0.29")).toBe(290_000);
    expect(parseUsdToMicros("5.000001")).toBe(5_000_001);
    expect(formatUsd(1)).toBe("$0.000001");
    expect(formatUsd(5_000_000)).toBe("$5.00");
    expect(usdInputValue(1_230_000)).toBe("1.23");
    expect(chargeForUnits(0.1, 29)).toBe(3);
    expect(chargeForUnits(1.000001, 1_000_000)).toBe(1_000_001);
  });
  it("rejects negative, exponential, fractional-micro and overflowing input", () => {
    for (const input of [
      "-1",
      "1e6",
      "1.0000001",
      "NaN",
      "Infinity",
      "",
      "9007199254.740992",
    ])
      expect(() => parseUsdToMicros(input)).toThrow();
    expect(() => formatUsd(0.5)).toThrow();
    expect(() => formatUsd(-1)).toThrow();
  });
  it("prices video by resolution and rejects unpriced configurations", () => {
    expect(videoPrice("seedance-2.5", 5, "720p")).toBe(1_700_000);
    expect(videoPrice("seedance-2.5", 5, "1080p")).toBe(4_200_000);
    expect(videoPrice("sume-remix-lite", 6, "720p")).toBe(900_000);
    expect(() => videoPrice("unknown", 5)).toThrow();
    expect(() => videoPrice("seedance-2.5", 5, "4K")).toThrow();
  });
});
