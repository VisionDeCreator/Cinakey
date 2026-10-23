import { v } from "convex/values";
import { estimateStagingTokens, type StagingPlan } from "@cinakey/shared";
import type { Id } from "./_generated/dataModel";
import { internalMutation, query } from "./_generated/server";
import { requireProjectAccess } from "./lib/access";
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
export const estimateForSequence = query({
  args: { projectId: v.id("projects"), sequenceId: v.id("sequences") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const seq = await ctx.db.get(args.sequenceId);
    if (!seq || seq.projectId !== args.projectId) return null;
    const sheet = seq.scriptPromptId
      ? await ctx.db.get(seq.scriptPromptId)
      : null;
    const text = sheet?.renderedText ?? "";
    const tokens = text
      ? estimateStagingTokens(text, seq.shotIds.length)
      : 2500 + seq.shotIds.length * 400;
    const llm = stagingUsesLlm();
    return { credits: llm ? stagingCredits(tokens) : 0, llm };
  },
});

export const setStagingPlan = internalMutation({
  args: {
    sequenceId: v.id("sequences"),
    storageId: v.id("_storage"),
    scriptPromptId: v.id("promptSheets"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sequenceId, {
      stagingPlanFileId: args.storageId,
      stagingScriptPromptId: args.scriptPromptId,
      updatedAt: Date.now(),
    });
  },
});

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
