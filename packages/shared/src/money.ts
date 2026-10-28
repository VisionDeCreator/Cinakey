import {
  PRICE_VERSION,
  VIDEO_RATES,
  VIDEO_SUPPLIER_RATES,
  applyUsageMarkup,
  supplierVideoMaximum,
  TOKEN_USD_MICROS_PER_1K,
} from "./pricing";
export { PRICE_VERSION, VIDEO_RATES, TOKEN_USD_MICROS_PER_1K };
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

export const QUOTE_TTL_MS = 10 * 60_000;
export function videoRate(model: string, resolution = "720p") {
  if (!(model in VIDEO_RATES) || !["720p", "1080p"].includes(resolution))
    throw new Error("Unsupported price configuration");
  return VIDEO_RATES[model as keyof typeof VIDEO_RATES][
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
  videoRate(model, resolution);
  return applyUsageMarkup(
    supplierVideoMaximum(
      durationSec *
        VIDEO_SUPPLIER_RATES[model as keyof typeof VIDEO_SUPPLIER_RATES][
          (resolution ?? "720p") as "720p" | "1080p"
        ],
    ),
  );
}
export function tokenPrice(tokens: number) {
  if (!Number.isSafeInteger(tokens) || tokens < 0)
    throw new Error("Invalid token usage");
  return assertUsdMicros(
    Number((BigInt(tokens) * BigInt(TOKEN_USD_MICROS_PER_1K) + 999n) / 1000n),
  );
}
/** Reserve a bounded multi-call allowance; each actual call must also pass its remaining-budget check. */
export function stagingPrice(tokens: number) {
  if (!Number.isSafeInteger(tokens) || tokens < 0)
    throw new Error("Invalid staging token estimate");
  return tokenPrice(Math.max(30_000, Math.ceil(tokens * 12)));
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
