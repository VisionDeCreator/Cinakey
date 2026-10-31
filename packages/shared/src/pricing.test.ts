import { expect, it } from "vitest";
import {
  USAGE_MARKUP_BPS,
  VIDEO_RATES,
  VIDEO_SUPPLIER_RATES,
  TOKEN_RATES,
  TOKEN_SUPPLIER_RATES,
  applyUsageMarkup,
  normalizeTokenUsage,
  tokenUsagePrice,
  tokenBatchPrice,
  tokenBatchSupplierCost,
  deepseekBillingPeriod,
  verifiedDeepseekPeriod,
} from "./pricing";
const peak = Date.UTC(2026, 9, 28, 2),
  offPeak = Date.UTC(2026, 9, 28, 12);
it("applies the single 20% cost markup, with a working zero-markup setting and no fees or cent rounding", () => {
  expect(USAGE_MARKUP_BPS).toBe(2000);
  for (const model of ["seedance-2.5", "sume-remix-lite"] as const)
    for (const res of ["720p", "1080p"] as const) {
      const cost = VIDEO_SUPPLIER_RATES[model][res];
      expect(VIDEO_RATES[model][res]).toBe(applyUsageMarkup(cost, 2000));
      expect(applyUsageMarkup(cost, 0)).toBe(cost);
    }
  expect(applyUsageMarkup(1_156_000)).toBe(1_387_200);
  expect(applyUsageMarkup(2_843_000)).toBe(3_411_600);
  expect(applyUsageMarkup(101, 500)).toBe(107);
  expect(() => applyUsageMarkup(1, -1)).toThrow();
  expect(() => applyUsageMarkup(1, 0.5)).toThrow();
});
it("settles actual supplier peak/off-peak and cached token costs plus the pinned percentage", () => {
  const usage = {
    inputTokens: 1000,
    cachedInputTokens: 500,
    outputTokens: 500,
  };
  expect(tokenUsagePrice(usage, TOKEN_SUPPLIER_RATES)).toBe(753);
  expect(tokenUsagePrice(usage)).toBe(904);
  const peakBatch = {
      ...usage,
      period: "peak" as const,
      providerCreatedAt: peak,
    },
    offPeakBatch = {
      ...usage,
      period: "off_peak" as const,
      providerCreatedAt: offPeak,
    };
  expect(tokenBatchSupplierCost([peakBatch])).toBe(753);
  expect(tokenBatchPrice([peakBatch])).toBe(904);
  expect(tokenBatchSupplierCost([offPeakBatch])).toBe(377);
  expect(tokenBatchPrice([offPeakBatch])).toBe(453);
  expect(
    tokenBatchPrice([peakBatch, offPeakBatch], TOKEN_SUPPLIER_RATES, 0),
  ).toBe(1130);
  expect(tokenBatchPrice([peakBatch, offPeakBatch])).toBe(1356);
  expect(tokenBatchPrice([peakBatch], TOKEN_SUPPLIER_RATES, 2500)).toBe(942);
  expect(TOKEN_RATES).toEqual({
    cachedInput: 7200,
    input: 360000,
    output: 1440000,
  });
});
it("handles UTC boundaries, weekends, China holidays and unknown holiday years explicitly", () => {
  expect(deepseekBillingPeriod(peak)).toBe("peak");
  expect(deepseekBillingPeriod(offPeak)).toBe("off_peak");
  for (const [hour, period] of [
    [0, "off_peak"],
    [1, "peak"],
    [4, "off_peak"],
    [6, "peak"],
    [10, "off_peak"],
  ] as const)
    expect(deepseekBillingPeriod(Date.UTC(2026, 9, 28, hour))).toBe(period);
  expect(deepseekBillingPeriod(Date.UTC(2026, 9, 31, 2))).toBe("off_peak");
  expect(deepseekBillingPeriod(Date.UTC(2026, 9, 1, 2))).toBe("off_peak");
  expect(deepseekBillingPeriod(Date.UTC(2027, 0, 4, 2))).toBeNull();
  expect(verifiedDeepseekPeriod(peak, peak + 1000, peak)).toBe("peak");
  expect(
    verifiedDeepseekPeriod(
      Date.UTC(2026, 9, 28, 3, 59, 59),
      Date.UTC(2026, 9, 28, 4, 0, 1),
      Date.UTC(2026, 9, 28, 3, 59, 59),
    ),
  ).toBeNull();
  expect(verifiedDeepseekPeriod(peak, peak + 1000, NaN)).toBeNull();
});
it("requires cache and input/output evidence and rejects inconsistent or forged period data", () => {
  expect(normalizeTokenUsage({ total_tokens: 1000 })).toBeNull();
  expect(
    normalizeTokenUsage({ prompt_tokens: 100, completion_tokens: 10 }),
  ).toBeNull();
  expect(
    normalizeTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 25 },
      total_tokens: 110,
    }),
  ).toEqual({ inputTokens: 100, cachedInputTokens: 25, outputTokens: 10 });
  expect(
    normalizeTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 10,
      prompt_cache_miss_tokens: 75,
    }),
  ).toEqual({ inputTokens: 100, cachedInputTokens: 25, outputTokens: 10 });
  expect(
    normalizeTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 10,
      prompt_cache_hit_tokens: 101,
    }),
  ).toBeNull();
  expect(() =>
    tokenBatchPrice([
      {
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        period: "off_peak",
        providerCreatedAt: peak,
      },
    ]),
  ).toThrow();
});
