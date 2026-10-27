/** All persisted customer amounts are integer micro-USD. No float dollar arithmetic. */
export const USD_MICROS = 1_000_000;
export function assertUsdMicros(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid USD amount");
  return value;
}
export function parseUsdToMicros(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter USD with at most six decimal places");
  const amount =
    BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("USD amount is too large");
  return Number(amount);
}
export function usdInputValue(micros: number): string {
  assertUsdMicros(micros);
  return `${Math.floor(micros / USD_MICROS)}.${String(micros % USD_MICROS).padStart(6, "0")}`
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}
export function formatUsd(micros: number): string {
  assertUsdMicros(micros);
  const value = usdInputValue(micros);
  const [whole, fraction = ""] = value.split(".");
  return `$${whole}.${fraction.padEnd(2, "0")}`;
}

/** Development fixtures only. D1 retail rates remain pending cost verification. */
export const PRICE_VERSION = "dev-usd-v1";
export const QUOTE_TTL_MS = 10 * 60_000;
export const DEV_VIDEO_RATES = {
  "seedance-2.5": { "720p": 340_000, "1080p": 840_000 },
  "sume-remix-lite": { "720p": 150_000, "1080p": 300_000 },
} as const;
export const DEV_TOKEN_USD_MICROS_PER_1K = 2_000;
export function videoRate(model: string, resolution = "720p") {
  if (!(model in DEV_VIDEO_RATES) || !["720p", "1080p"].includes(resolution))
    throw new Error("Unsupported price configuration");
  return DEV_VIDEO_RATES[model as keyof typeof DEV_VIDEO_RATES][
    resolution as "720p" | "1080p"
  ];
}
export function videoPrice(
  model: string,
  durationSec: number,
  resolution?: string,
) {
  if (
    !Number.isSafeInteger(durationSec) ||
    durationSec < 4 ||
    durationSec > (model === "sume-remix-lite" ? 15 : 30)
  )
    throw new Error("Invalid priced duration");
  return assertUsdMicros(durationSec * videoRate(model, resolution));
}
export function tokenPrice(tokens: number) {
  if (!Number.isSafeInteger(tokens) || tokens < 0)
    throw new Error("Invalid token usage");
  return assertUsdMicros(
    Number(
      (BigInt(tokens) * BigInt(DEV_TOKEN_USD_MICROS_PER_1K) + 999n) / 1000n,
    ),
  );
}
export function stagingPrice(tokens: number) {
  return tokenPrice(Math.max(1000, Math.ceil(tokens * 2.2)));
}

/** Round fractional usage up once at micro-USD precision. */
export function chargeForUnits(units: number, unitUsdMicros: number) {
  assertUsdMicros(unitUsdMicros);
  if (!Number.isFinite(units) || units < 0)
    throw new Error("Invalid usage units");
  const scaledUnits = parseUsdToMicros(String(units));
  return assertUsdMicros(
    Number(
      (BigInt(scaledUnits) * BigInt(unitUsdMicros) + 999_999n) / 1_000_000n,
    ),
  );
}
