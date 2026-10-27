import { formatUsd, stagingPrice, tokenPrice } from "@cinakey/shared";
import {
  auditStagedDocument,
  buildAuditRepairMessage,
  buildStagingMessages,
  buildStagingRepairMessage,
  compileStagingPlanWithInfo,
  estimateStagingTokens,
  parseScriptPromptText,
  parseStagingPlan,
  type StagingIssue,
  type StagingPlan,
} from "@cinakey/shared";
import { ConvexError, v } from "convex/values";
import type { Id } from "../../../../packages/backend/convex/_generated/dataModel";
import { requireProviderKey, useMockProviders } from "../config/env";
import { internal } from "../operations";
import { completeChat, type ChatMessage } from "../providers/deepseek";
import { safeErrorMessage } from "../providers/errors";
import { internalAction } from "../runtime/operation";
import { saveJson } from "./storage";

/**
 * Development USD reserved for one plan at the versioned token rate with room for the check-driven repair turn, which re-sends
 * the conversation. Settled to actual usage afterwards.
 */
export function stagingUsdMicros(tokens: number): number {
  return stagingPrice(tokens);
}

/** Short, distinct problem lines for storage / display. */
function issueLines(issues: StagingIssue[]): string[] {
  return [...new Set(issues.map((i) => `shot ${i.shot}: ${i.problem}`))];
}

export function stagingUsesLlm(): boolean {
  return !useMockProviders();
}

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

/**
 * Ask DeepSeek for a staging plan (one repair turn if it fails validation).
 * Never throws for model problems — callers fall back to the rule director.
 */
export const generatePlan = internalAction({
  args: {
    projectId: v.id("projects"),

    userId: v.id("users"),

    scriptText: v.string(),
    shotCount: v.number(),
    durationSec: v.number(),
    aspectRatio: v.string(),
  },
  handler: async (ctx, args): Promise<StagingResult> => {
    if (!stagingUsesLlm())
      return {
        ok: false,
        reason: "AI staging is off (explicit mock mode)",
      };

    requireProviderKey("deepseek");
    const project = await ctx.runQuery(
      internal.generation.getProjectWorkspace,
      {
        projectId: args.projectId,
      },
    );
    const estimate = stagingUsdMicros(
      estimateStagingTokens(args.scriptText, args.shotCount),
    );

    let jobId: Id<"generationJobs">;
    try {
      jobId = await ctx.runMutation(internal.textJobs.createChatJob, {
        projectId: args.projectId,
        workspaceId: project.workspaceId,
        userId: args.userId,
        estimatedCostUsdMicros: estimate,
        prompt: `Stage blockout: ${args.scriptText.slice(0, 200)}`,
      });
    } catch (err) {
      if (
        err instanceof ConvexError &&
        (err.data as { code?: string })?.code === "INSUFFICIENT_FUNDS"
      ) {
        return {
          ok: false,
          reason: `Not enough USD balance for AI staging (needs ${formatUsd(estimate)})`,
        };
      }
      throw err;
    }

    let usageMissing = false;
    const settle = async (
      succeeded: boolean,
      tokens: number,
      errorMessage?: string,
    ) =>
      ctx.runMutation(internal.textJobs.settleChatJob, {
        jobId,
        workspaceId: project.workspaceId,
        userId: args.userId,
        projectId: args.projectId,
        actualCostUsdMicros: tokenPrice(tokens),
        actualTokens: tokens,
        usageMissing: succeeded && usageMissing,
        succeeded,
        errorMessage,
      });

    const messages: ChatMessage[] = buildStagingMessages({
      scriptText: args.scriptText,
      aspectRatio: args.aspectRatio,
      durationSec: args.durationSec,
      shotCount: args.shotCount,
    });
    // The same compile + check the blockout build runs, so repairs target what the user would see.
    const script = parseScriptPromptText(args.scriptText);
    {
      script.shots = [];
      script.totalDurationSec = args.durationSec;
    }
    const blockoutProject = {
      id: args.projectId,
      title: project.title,
      aspectRatio: project.aspectRatio,
      fps: project.fps,
    };
    const check = (plan: StagingPlan): StagingIssue[] => {
      try {
        const info = compileStagingPlanWithInfo(plan, script, blockoutProject);
        return auditStagedDocument(plan, info.document, info.riding);
      } catch {
        return [];
      }
    };
    const shotsWith = (issues: StagingIssue[]) =>
      new Set(issues.map((i) => i.shot)).size;

    let tokens = 0;
    try {
      let best: {
        plan: StagingPlan;
        issues: StagingIssue[];
        content: string;
      } | null = null;
      for (let attempt = 0; attempt < 2 && !best; attempt++) {
        const res = await completeChat({
          messages,
          json: true,
          maxTokens: 8000,
        });
        usageMissing ||= res.usage?.total_tokens === undefined;
        tokens += res.usage?.total_tokens ?? 0;
        const parsed = parseStagingPlan(res.content);
        if (parsed.ok) {
          best = {
            plan: parsed.plan,
            issues: check(parsed.plan),
            content: res.content,
          };
        } else {
          messages.push(
            { role: "assistant", content: res.content },
            buildStagingRepairMessage(parsed.error),
          );
        }
      }
      if (!best) {
        await settle(false, tokens, "Staging plan failed validation twice");
        return { ok: false, reason: "The AI staging plan did not validate" };
      }

      // One repair pass driven by the automatic check; keep whichever is better.
      const issuesBefore = shotsWith(best.issues);
      let repaired = false;
      if (best.issues.length > 0) {
        try {
          messages.push(
            { role: "assistant", content: best.content },
            buildAuditRepairMessage(best.issues, best.plan),
          );
          const res = await completeChat({
            messages,
            json: true,
            maxTokens: 8000,
          });
          usageMissing ||= res.usage?.total_tokens === undefined;
          tokens += res.usage?.total_tokens ?? 0;
          const parsed = parseStagingPlan(res.content);
          if (parsed.ok) {
            const issues = check(parsed.plan);
            if (shotsWith(issues) < issuesBefore) {
              best = { plan: parsed.plan, issues, content: res.content };
              repaired = true;
            }
          }
        } catch {
          // Keep the first valid plan.
        }
      }

      const { storageId } = await saveJson(ctx, best.plan);
      await settle(true, tokens);
      return {
        ok: true,
        plan: best.plan,
        planFileId: storageId,
        usdMicros: usageMissing ? 0 : Math.min(estimate, tokenPrice(tokens)),
        issuesBefore,
        issuesAfter: shotsWith(best.issues),
        issueSample: issueLines(best.issues).slice(0, 12),
        repaired,
      };
    } catch (err) {
      const message = safeErrorMessage(err);
      await settle(false, tokens, message);
      return {
        ok: false,
        reason: `AI staging failed: ${message.slice(0, 160)}`,
      };
    }
  },
});
