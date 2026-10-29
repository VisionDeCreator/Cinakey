/** Verified 2026-10-28. Source evidence and settlement policy: docs/generation-pricing.md. */
export const PRICE_VERSION = "usd-2026-10-28-cost-plus-v2";
/** Single commercial setting: 500 basis points = 5% markup on cost; 0 = supplier cost. Bump PRICE_VERSION when changing. */
export const USAGE_MARKUP_BPS = 500;
export function applyUsageMarkup(
  cost: number,
  markupBps: number = USAGE_MARKUP_BPS,
): number {
  if (
    !Number.isSafeInteger(cost) ||
    cost < 0 ||
    !Number.isSafeInteger(markupBps) ||
    markupBps < 0 ||
    markupBps > 100_000
  )
    throw new Error("Invalid usage pricing");
  const result = (BigInt(cost) * BigInt(10_000 + markupBps) + 9999n) / 10_000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Usage amount is too large");
  return Number(result);
}
/** Sume's captured billing ledger exposes whole USD cents; quote a ceiling, settle the actual receipt. */
export function supplierVideoMaximum(cost: number): number {
  if (!Number.isSafeInteger(cost) || cost < 0)
    throw new Error("Invalid supplier amount");
  const result = ((BigInt(cost) + 9999n) / 10_000n) * 10_000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Supplier amount is too large");
  return Number(result);
}
export const VIDEO_SUPPLIER_RATES = {
  "seedance-2.5": { "720p": 231_200, "1080p": 568_600 },
  // Dedicated /v1/sume/remix-lite/object-swap/v1.0, NOT the Higgsfield router alias.
  "sume-remix-lite": { "720p": 100_000, "1080p": 200_000 },
} as const;
export const VIDEO_RATES = {
  "seedance-2.5": {
    "720p": applyUsageMarkup(VIDEO_SUPPLIER_RATES["seedance-2.5"]["720p"]),
    "1080p": applyUsageMarkup(VIDEO_SUPPLIER_RATES["seedance-2.5"]["1080p"]),
  },
  "sume-remix-lite": {
    "720p": applyUsageMarkup(VIDEO_SUPPLIER_RATES["sume-remix-lite"]["720p"]),
    "1080p": applyUsageMarkup(VIDEO_SUPPLIER_RATES["sume-remix-lite"]["1080p"]),
  },
} as const;
export const DEEPSEEK_MODEL = "deepseek-flash";
/** Micro-USD per MILLION tokens; peak supplier rates bound off-peak costs too. */
export const TOKEN_SUPPLIER_RATES = {
  cachedInput: 6_000,
  input: 300_000,
  output: 1_200_000,
} as const;
export const TOKEN_RATES = {
  cachedInput: applyUsageMarkup(TOKEN_SUPPLIER_RATES.cachedInput),
  input: applyUsageMarkup(TOKEN_SUPPLIER_RATES.input),
  output: applyUsageMarkup(TOKEN_SUPPLIER_RATES.output),
} as const;
export type TokenRates = { cachedInput: number; input: number; output: number };
export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};
export const TOKEN_USD_MICROS_PER_1K = Math.ceil(TOKEN_RATES.output / 1000);
export function tokenUsagePrice(
  usage: TokenUsage,
  rates: TokenRates = TOKEN_RATES,
): number {
  for (const n of [
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.outputTokens,
    ...Object.values(rates),
  ])
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error("Invalid token accounting");
  if (usage.cachedInputTokens > usage.inputTokens)
    throw new Error("Invalid cached token accounting");
  const amount =
    (BigInt(usage.cachedInputTokens) * BigInt(rates.cachedInput) +
      BigInt(usage.inputTokens - usage.cachedInputTokens) *
        BigInt(rates.input) +
      BigInt(usage.outputTokens) * BigInt(rates.output) +
      999_999n) /
    1_000_000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Token amount is too large");
  return Number(amount);
}
/** Incomplete/inconsistent usage must be reconciled, never replaced with invented usage. */
export function normalizeTokenUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const inputTokens = u.prompt_tokens,
    outputTokens = u.completion_tokens;
  const details = u.prompt_tokens_details as
    { cached_tokens?: unknown } | undefined;
  const cachedInputTokens =
    u.prompt_cache_hit_tokens ??
    details?.cached_tokens ??
    (typeof inputTokens === "number" &&
    typeof u.prompt_cache_miss_tokens === "number"
      ? inputTokens - u.prompt_cache_miss_tokens
      : inputTokens === 0
        ? 0
        : undefined);
  if (
    ![inputTokens, outputTokens, cachedInputTokens].every(
      (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0,
    )
  )
    return null;
  const usage = {
    inputTokens: inputTokens as number,
    outputTokens: outputTokens as number,
    cachedInputTokens: cachedInputTokens as number,
  };
  if (
    usage.cachedInputTokens > usage.inputTokens ||
    (u.total_tokens !== undefined &&
      u.total_tokens !== usage.inputTokens + usage.outputTokens) ||
    (u.prompt_cache_miss_tokens !== undefined &&
      u.prompt_cache_miss_tokens !==
        usage.inputTokens - usage.cachedInputTokens)
  )
    return null;
  return usage;
}
export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const result = {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
  tokenUsagePrice(result);
  return result;
}

export type TokenUsageBatch = TokenUsage & {
  period: "peak" | "off_peak";
  providerCreatedAt: number;
};
/** Sum supplier costs across repair calls before rounding once to micro-USD, then apply markup once. */
export function tokenBatchSupplierCost(
  batches: TokenUsageBatch[],
  rates: TokenRates = TOKEN_SUPPLIER_RATES,
): number {
  if (!batches.length || batches.length > 32)
    throw new Error("Missing provider billing evidence");
  let numerator = 0n;
  for (const batch of batches) {
    tokenUsagePrice(batch, rates);
    if (deepseekBillingPeriod(batch.providerCreatedAt) !== batch.period)
      throw new Error("Unverified provider billing period");
    const divisor = batch.period === "off_peak" ? 2n : 1n;
    numerator +=
      (BigInt(batch.cachedInputTokens) * BigInt(rates.cachedInput) +
        BigInt(batch.inputTokens - batch.cachedInputTokens) *
          BigInt(rates.input) +
        BigInt(batch.outputTokens) * BigInt(rates.output)) *
      (2n / divisor);
  }
  const amount = (numerator + 1_999_999n) / 2_000_000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Supplier cost is too large");
  return Number(amount);
}
export function tokenBatchPrice(
  batches: TokenUsageBatch[],
  rates: TokenRates = TOKEN_SUPPLIER_RATES,
  markupBps: number = USAGE_MARKUP_BPS,
) {
  return applyUsageMarkup(tokenBatchSupplierCost(batches, rates), markupBps);
}
// Official 2026 China holiday schedule; see docs/generation-pricing.md. Local dates (UTC+8).
const HOLIDAYS: Record<number, readonly [string, string][]> = {
  2026: [
    ["01-01", "01-03"],
    ["02-15", "02-23"],
    ["04-04", "04-06"],
    ["05-01", "05-05"],
    ["06-19", "06-21"],
    ["09-25", "09-27"],
    ["10-01", "10-07"],
  ],
};
/** Unknown holiday years are never assumed to be peak: leave uncertain weekday-peak calls for reconciliation. */
export function deepseekBillingPeriod(
  timestampMs: number,
): "peak" | "off_peak" | null {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) return null;
  const utc = new Date(timestampMs),
    weekday = utc.getUTCDay(),
    hour = utc.getUTCHours();
  if (!Number.isFinite(utc.getTime())) return null;
  if (
    weekday === 0 ||
    weekday === 6 ||
    !((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))
  )
    return "off_peak";
  const china = new Date(timestampMs + 8 * 3600_000),
    year = china.getUTCFullYear();
  const ranges = HOLIDAYS[year];
  if (!ranges) return null;
  const day = china.toISOString().slice(5, 10);
  return ranges.some(([start, end]) => day >= start && day <= end)
    ? "off_peak"
    : "peak";
}
/** Avoid guessing which clock determines price if a request crosses a provider price boundary. */
export function verifiedDeepseekPeriod(
  startMs: number,
  endMs: number,
  providerCreatedAt: number,
) {
  if (
    ![startMs, endMs, providerCreatedAt].every(Number.isSafeInteger) ||
    endMs < startMs ||
    endMs - startMs > 600_000 ||
    providerCreatedAt < startMs - 60_000 ||
    providerCreatedAt > endMs + 60_000
  )
    return null;
  const low = Math.min(startMs, providerCreatedAt),
    high = Math.max(endMs, providerCreatedAt);
  const period = deepseekBillingPeriod(low);
  if (!period) return null;
  for (
    let t = Math.floor(low / 60_000) * 60_000 + 60_000;
    t <= high;
    t += 60_000
  )
    if (deepseekBillingPeriod(t) !== period) return null;
  return deepseekBillingPeriod(high) === period ? period : null;
}

/** Public and in-app subscription presentation, USD micros. Keep checkout catalog aligned. */
export const WORKSPACE_MONTHLY_USD_MICROS = 29_000_000;
export const ADDITIONAL_SEAT_MONTHLY_USD_MICROS = 15_000_000;
export const INCLUDED_MONTHLY_USAGE_USD_MICROS = 5_000_000;
