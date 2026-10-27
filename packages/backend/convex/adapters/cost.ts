import { chargeForUnits } from "@cinakey/shared";
import type { BuildRequestInput, CostModel } from "@cinakey/shared";

/** Multiply units × usdMicrosPerUnit; ceil to whole micro-USD. */
export function usdMicrosFromUnits(
  units: number,
  costModel: CostModel,
): number {
  return chargeForUnits(units, costModel.usdMicrosPerUnit);
}

export function estimateImageCost(
  input: BuildRequestInput,
  costModel: CostModel,
): number {
  const count =
    typeof input.imageCount === "number" && input.imageCount > 0
      ? input.imageCount
      : 1;
  return usdMicrosFromUnits(count, costModel);
}

export function estimateVideoCost(
  input: BuildRequestInput,
  costModel: CostModel,
): number {
  const duration =
    typeof input.durationSec === "number" && input.durationSec > 0
      ? input.durationSec
      : 5;
  return usdMicrosFromUnits(duration, costModel);
}

export function estimateTokenCost(
  input: BuildRequestInput,
  costModel: CostModel,
): number {
  const tokens =
    typeof input.estimatedTokens === "number" && input.estimatedTokens > 0
      ? input.estimatedTokens
      : 1000;
  return usdMicrosFromUnits(tokens / 1000, costModel);
}

/** Default transient classifier: network / 429 / 5xx. */
export function isDefaultTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("429") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("504") ||
      msg.includes("transient")
    ) {
      return true;
    }
  }
  return false;
}
