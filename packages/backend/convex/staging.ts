/**
 * LLM staging plans for blockout / pre-viz.
 *
 * DeepSeek reads the part's script and writes a `cinakey.staging/1.0` plan
 * (set, cast, per-shot action and camera). The plan is validated, stored as a
 * file, and compiled into the blockout by `compileStagingPlan` in
 * @cinakey/shared. Credits are reserved up front and settled to actual token
 * usage (refunded on failure) through the copilot's chat-job ledger path.
 */

import { ConvexError, v } from "convex/values";
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
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, query } from "./_generated/server";
import { completeChat, type ChatMessage } from "./adapters/deepseek";
import { requireProjectAccess } from "./lib/access";
import { convexEnv } from "./lib/env";
import { saveJson } from "./storage";

/**
 * Credits reserved for one plan: token estimate at the DeepSeek rate
 * (1 credit / 1k) with room for the check-driven repair turn, which re-sends
 * the conversation. Settled to actual usage afterwards.
 */
export function stagingCredits(tokens: number): number {
  return Math.max(2, Math.ceil((tokens * 2.2) / 1000));
}

/** Short, distinct problem lines for storage / display. */
function issueLines(issues: StagingIssue[]): string[] {
  return [...new Set(issues.map((i) => `shot ${i.shot}: ${i.problem}`))];
}

export function stagingUsesLlm(): boolean {
  return (
    convexEnv("USE_MOCK_ADAPTERS") !== "true" &&
    Boolean(convexEnv("DEEPSEEK_API_KEY"))
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

/**
 * Ask DeepSeek for a staging plan (one repair turn if it fails validation).
 * Never throws for model problems — callers fall back to the rule director.
 */
export const generatePlan = internalAction({
  args: {
    projectId: v.id("projects"),
    sequenceId: v.id("sequences"),
    userId: v.id("users"),
    scriptPromptId: v.id("promptSheets"),
    scriptText: v.string(),
    shotCount: v.number(),
    durationSec: v.number(),
    aspectRatio: v.string(),
  },
  handler: async (ctx, args): Promise<StagingResult> => {
    if (!stagingUsesLlm())
      return {
        ok: false,
        reason: "AI staging is off (mock mode or no DeepSeek key)",
      };

    const project = await ctx.runQuery(
      internal.generation.getProjectWorkspace,
      {
        projectId: args.projectId,
      },
    );
    const estimate = stagingCredits(
      estimateStagingTokens(args.scriptText, args.shotCount),
    );

    let jobId: Id<"generationJobs">;
    try {
      jobId = await ctx.runMutation(internal.copilot.createChatJob, {
        projectId: args.projectId,
        workspaceId: project.workspaceId,
        userId: args.userId,
        estimatedCostCredits: estimate,
        prompt: `Stage blockout: ${args.scriptText.slice(0, 200)}`,
      });
    } catch (err) {
      if (
        err instanceof ConvexError &&
        (err.data as { code?: string })?.code === "INSUFFICIENT_CREDITS"
      ) {
        return {
          ok: false,
          reason: `Not enough credits for AI staging (needs ${estimate})`,
        };
      }
      throw err;
    }

    const settle = async (
      succeeded: boolean,
      tokens: number,
      errorMessage?: string,
    ) =>
      ctx.runMutation(internal.copilot.settleChatJob, {
        jobId,
        workspaceId: project.workspaceId,
        userId: args.userId,
        projectId: args.projectId,
        actualCostCredits: Math.max(1, Math.ceil(tokens / 1000)),
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
      await ctx.runMutation(internal.staging.setStagingPlan, {
        sequenceId: args.sequenceId,
        storageId,
        scriptPromptId: args.scriptPromptId,
      });
      await settle(true, tokens);
      return {
        ok: true,
        plan: best.plan,
        planFileId: storageId,
        credits: Math.min(estimate, Math.max(1, Math.ceil(tokens / 1000))),
        issuesBefore,
        issuesAfter: shotsWith(best.issues),
        issueSample: issueLines(best.issues).slice(0, 12),
        repaired,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await settle(false, tokens, message);
      return {
        ok: false,
        reason: `AI staging failed: ${message.slice(0, 160)}`,
      };
    }
  },
});
