import { stagingPrice } from "@cinakey/shared";
import { type StagingPlan } from "@cinakey/shared";
import type { Id } from "./_generated/dataModel";
import { convexEnv } from "./lib/env";

/**
 * Development USD reserved for one plan at the versioned token rate with room for the check-driven repair turn, which re-sends
 * the conversation. Settled to actual usage afterwards.
 */
export function stagingUsdMicros(tokens: number): number {
  return stagingPrice(tokens);
}

export function stagingUsesLlm(): boolean {
  return (
    convexEnv("USE_MOCK_ADAPTERS") !== "true" &&
    convexEnv("STAGING_LLM_ENABLED") !== "false"
  );
}

/** Cost shown before Update / Regenerate. */

export type StagingResult =
  | {
      ok: true;
      plan: StagingPlan;
      planFileId: Id<"_storage">;
      usdMicros: number;
      /** Automatic check before / after the repair pass (shots with problems). */
      issuesBefore: number;
      issuesAfter: number;
      issueSample: string[];
      repaired: boolean;
    }
  | { ok: false; reason: string };
