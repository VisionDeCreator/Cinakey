/**
 * Prompt / output moderation rules (block vs flag).
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import { requireStaff } from "./lib/access";
import { appendAuditLog } from "./lib/audit";

export type ModerationVerdict = "allow" | "flagged" | "blocked";

type Rule = {
  id: string;
  pattern: RegExp;
  verdict: "flagged" | "blocked";
};

/** In-code rules for launch. Extend carefully; keep block list narrow. */
const RULES: Rule[] = [
  {
    id: "block.csam_terms",
    pattern: /\b(child\s*porn|csam|underage\s*sex)\b/i,
    verdict: "blocked",
  },
  {
    id: "block.extreme_violence",
    pattern: /\b(behead|dismember|torture\s+porn)\b/i,
    verdict: "blocked",
  },
  {
    id: "flag.real_person_deepfake",
    pattern: /\b(deepfake|nonconsensual\s+nude|revenge\s+porn)\b/i,
    verdict: "flagged",
  },
  {
    id: "flag.likeness_without_consent",
    pattern: /\b(celebrity\s+face|real\s+person'?s?\s+face|lookalike\s+of)\b/i,
    verdict: "flagged",
  },
];

export function scanText(text: string): {
  verdict: ModerationVerdict;
  ruleId?: string;
  snippet?: string;
} {
  let flagged: { ruleId: string; snippet: string } | undefined;
  for (const rule of RULES) {
    const match = text.match(rule.pattern);
    if (match === null) continue;
    const snippet = match[0]!.slice(0, 80);
    if (rule.verdict === "blocked") {
      return { verdict: "blocked", ruleId: rule.id, snippet };
    }
    if (flagged === undefined) {
      flagged = { ruleId: rule.id, snippet };
    }
  }
  if (flagged !== undefined) {
    return {
      verdict: "flagged",
      ruleId: flagged.ruleId,
      snippet: flagged.snippet,
    };
  }
  return { verdict: "allow" };
}

export async function recordModerationFlag(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    projectId?: Id<"projects">;
    jobId?: Id<"generationJobs">;
    assetId?: Id<"assets">;
    stage: "prompt" | "output";
    verdict: "flagged" | "blocked";
    ruleId: string;
    snippet?: string;
  },
): Promise<Id<"moderationFlags">> {
  return await ctx.db.insert("moderationFlags", {
    userId: args.userId,
    projectId: args.projectId,
    jobId: args.jobId,
    assetId: args.assetId,
    stage: args.stage,
    verdict: args.verdict,
    ruleId: args.ruleId,
    snippet: args.snippet,
    status: "open",
    createdAt: Date.now(),
  });
}

export const recordFlag = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    jobId: v.optional(v.id("generationJobs")),
    assetId: v.optional(v.id("assets")),
    stage: v.union(v.literal("prompt"), v.literal("output")),
    verdict: v.union(v.literal("flagged"), v.literal("blocked")),
    ruleId: v.string(),
    snippet: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await recordModerationFlag(ctx, args);
  },
});

export const resolveFlag = mutation({
  args: {
    flagId: v.id("moderationFlags"),
    status: v.union(v.literal("resolved"), v.literal("dismissed")),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const reason = args.reason.trim();
    if (reason.length < 3) {
      throw new Error("A reason of at least 3 characters is required");
    }
    const flag = await ctx.db.get(args.flagId);
    if (flag === null) throw new Error("Flag not found");
    const now = Date.now();
    await ctx.db.patch(args.flagId, {
      status: args.status,
      resolvedBy: staff._id,
      resolvedAt: now,
    });
    await appendAuditLog(ctx, {
      actorUserId: staff._id,
      action: `moderation.${args.status}`,
      targetType: "moderationFlags",
      targetId: args.flagId,
      reason,
    });
  },
});
