import { type StagingPlan } from "@cinakey/shared";
import type { Id } from "./_generated/dataModel";
import { convexEnv } from "./lib/env";

/**
 * Credits reserved for one plan: token estimate at the DeepSeek rate
 * (1 credit / 1k) with room for the check-driven repair turn, which re-sends
 * the conversation. Settled to actual usage afterwards.
 */
export function stagingCredits(tokens: number): number {
  return Math.max(2, Math.ceil((tokens * 2.2) / 1000));
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
      credits: number;
      /** Automatic check before / after the repair pass (shots with problems). */
      issuesBefore: number;
      issuesAfter: number;
      issueSample: string[];
      repaired: boolean;
    }
  | { ok: false; reason: string };
