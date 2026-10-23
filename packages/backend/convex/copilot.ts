import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { appendLedgerEntry, getWorkspaceBalance } from "./credits";
import { requireProjectAccess, requireUser } from "./lib/access";
import { RATE_LIMITS } from "./lib/limits";
import { assertRateLimit } from "./lib/rateLimit";

export const assertCopilotRateLimit = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await assertRateLimit(
      ctx,
      `copilotTurn:${args.userId}`,
      RATE_LIMITS.copilotTurn.limit,
      RATE_LIMITS.copilotTurn.windowMs,
    );
  },
});

const roleValidator = v.union(
  v.literal("director"),
  v.literal("screenwriter"),
  v.literal("character_designer"),
);

const modeValidator = v.union(
  v.literal("brainstorm"),
  v.literal("critique"),
  v.literal("pacing"),
  v.literal("continuity"),
);

export const listMessages = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const limit = Math.max(1, Math.min(args.limit ?? 100, 200));
    const messages = await ctx.db
      .query("copilotMessages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(limit);
    return messages.reverse();
  },
});

export const listPendingProposals = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const all = await ctx.db
      .query("proposals")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return all.filter((p) => p.status === "pending" || p.status === "edited");
  },
});

export const getProposal = query({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (proposal === null) return null;
    await requireProjectAccess(ctx, proposal.projectId);
    return proposal;
  },
});

export const appendUserMessage = mutation({
  args: {
    projectId: v.id("projects"),
    content: v.string(),
    roleUsed: v.optional(roleValidator),
    mode: v.optional(modeValidator),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    await requireProjectAccess(ctx, args.projectId);
    const content = args.content.trim();
    if (content.length === 0) throw new Error("Message is empty");
    const now = Date.now();
    return await ctx.db.insert("copilotMessages", {
      projectId: args.projectId,
      role: "user",
      content,
      roleUsed: args.roleUsed,
      mode: args.mode,
      createdAt: now,
    });
  },
});

export const insertUserMessageInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    content: v.string(),
    roleUsed: v.optional(roleValidator),
    mode: v.optional(modeValidator),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("copilotMessages", {
      projectId: args.projectId,
      role: "user",
      content: args.content,
      roleUsed: args.roleUsed,
      mode: args.mode,
      createdAt: Date.now(),
    });
  },
});

export const createAssistantMessage = internalMutation({
  args: {
    projectId: v.id("projects"),
    roleUsed: v.optional(roleValidator),
    mode: v.optional(modeValidator),
    jobId: v.optional(v.id("generationJobs")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("copilotMessages", {
      projectId: args.projectId,
      role: "assistant",
      content: "",
      roleUsed: args.roleUsed,
      mode: args.mode,
      jobId: args.jobId,
      streaming: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const appendAssistantDelta = internalMutation({
  args: {
    messageId: v.id("copilotMessages"),
    delta: v.string(),
  },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (msg === null) return;
    await ctx.db.patch(args.messageId, {
      content: msg.content + args.delta,
      updatedAt: Date.now(),
    });
  },
});

export const finalizeAssistantMessage = internalMutation({
  args: {
    messageId: v.id("copilotMessages"),
    content: v.optional(v.string()),
    toolCalls: v.optional(v.any()),
    proposalIds: v.optional(v.array(v.id("proposals"))),
    streaming: v.boolean(),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      streaming: args.streaming,
      updatedAt: Date.now(),
    };
    if (args.content !== undefined) patch.content = args.content;
    if (args.toolCalls !== undefined) patch.toolCalls = args.toolCalls;
    if (args.proposalIds !== undefined) patch.proposalIds = args.proposalIds;
    await ctx.db.patch(args.messageId, patch);
  },
});

export const createProposal = internalMutation({
  args: {
    projectId: v.id("projects"),
    messageId: v.id("copilotMessages"),
    kind: v.union(
      v.literal("script_edit"),
      v.literal("entities"),
      v.literal("rules"),
      v.literal("character_details"),
      v.literal("image_prompt"),
      v.literal("shot_list"),
      v.literal("story_treatment"),
      v.literal("asset_list"),
      v.literal("asset_sheet"),
      v.literal("style_block"),
      v.literal("script_prompt"),
      v.literal("blockout_sheet"),
      v.literal("shot_prompt"),
      v.literal("continuity"),
      v.literal("generate_image"),
      v.literal("generate_video"),
    ),
    payload: v.optional(v.any()),
    payloadFileId: v.optional(v.id("_storage")),
    diffSummary: v.optional(v.string()),
    estimatedCostCredits: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("proposals", {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: args.kind,
      status: "pending",
      payload: args.payload,
      payloadFileId: args.payloadFileId,
      diffSummary: args.diffSummary,
      estimatedCostCredits: args.estimatedCostCredits,
      createdAt: Date.now(),
    });
  },
});

export const createChatJob = internalMutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    estimatedCostCredits: v.number(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("generationJobs", {
      projectId: args.projectId,
      model: "deepseek",
      modelVersion: "deepseek-chat",
      kind: "chat",
      prompt: args.prompt.slice(0, 500),
      estimatedCostCredits: args.estimatedCostCredits,
      status: "running",
      outputAssetIds: [],
      attempts: 1,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now,
    });
    try {
      await appendLedgerEntry(ctx, {
        workspaceId: args.workspaceId,
        userId: args.userId,
        projectId: args.projectId,
        jobId,
        delta: -args.estimatedCostCredits,
        reason: "reserve",
      });
    } catch (err) {
      await ctx.db.delete(jobId);
      const balance = await getWorkspaceBalance(ctx, args.workspaceId);
      if (
        err instanceof Error &&
        err.message.startsWith("Insufficient credits")
      ) {
        throw new ConvexError({
          code: "INSUFFICIENT_CREDITS" as const,
          balance,
          required: args.estimatedCostCredits,
        });
      }
      throw err;
    }
    return jobId;
  },
});

export const settleChatJob = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    projectId: v.id("projects"),
    actualCostCredits: v.number(),
    succeeded: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job === null || job.status === "succeeded" || job.status === "refunded")
      return;
    if (args.succeeded) {
      const actual = Math.min(args.actualCostCredits, job.estimatedCostCredits);
      await appendLedgerEntry(ctx, {
        workspaceId: args.workspaceId,
        userId: args.userId,
        projectId: args.projectId,
        jobId: args.jobId,
        delta: job.estimatedCostCredits - actual,
        reason: "settle",
      });
      await ctx.db.patch(args.jobId, {
        status: "succeeded",
        actualCostCredits: actual,
        updatedAt: Date.now(),
      });
    } else {
      await appendLedgerEntry(ctx, {
        workspaceId: args.workspaceId,
        userId: args.userId,
        projectId: args.projectId,
        jobId: args.jobId,
        delta: job.estimatedCostCredits,
        reason: "refund",
      });
      await ctx.db.patch(args.jobId, {
        status: "refunded",
        errorMessage: args.errorMessage,
        updatedAt: Date.now(),
      });
    }
  },
});

export const loadProjectContext = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (project === null) throw new Error("Project not found");
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const tip = await ctx.db
      .query("scriptVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    const messages = (
      await ctx.db
        .query("copilotMessages")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .order("desc")
        .take(100)
    ).reverse();
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_project_order", (q) => q.eq("projectId", args.projectId))
      .collect();
    const shots = await ctx.db
      .query("shots")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const shotCountByScene = new Map<string, number>();
    for (const shot of shots) {
      shotCountByScene.set(
        shot.sceneId,
        (shotCountByScene.get(shot.sceneId) ?? 0) + 1,
      );
    }
    const scenesSummary =
      scenes.length === 0
        ? "(no live scenes)"
        : scenes
            .sort((a, b) => a.order - b.order)
            .map(
              (s) =>
                `- ${s.heading} (elementId=${s.elementId}, shots=${shotCountByScene.get(s._id) ?? 0})`,
            )
            .join("\n");
    const creditBalance = await getWorkspaceBalance(ctx, project.workspaceId);
    const promptTips = await ctx.db
      .query("promptSheets")
      .withIndex("by_project_tip", (q) =>
        q.eq("projectId", args.projectId).eq("isTip", true),
      )
      .collect();
    const sequences = await ctx.db
      .query("sequences")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const styleEntity = entities.find((e) => e.kind === "style");
    const assetEntities = entities.filter((e) => e.kind !== "style");
    const sheetEntityIds = new Set(
      promptTips
        .filter(
          (t) =>
            t.type === "character" ||
            t.type === "creature" ||
            t.type === "environment" ||
            t.type === "product",
        )
        .map((t) => t.entityId)
        .filter((id): id is Id<"entities"> => id !== undefined),
    );
    const entitiesMissingSheets = assetEntities
      .filter((e) => !sheetEntityIds.has(e._id))
      .map((e) => ({
        id: e._id as string,
        name: e.name,
        kind: e.kind as "character" | "creature" | "location" | "prop",
      }));
    const pipelineSummary =
      promptTips.length === 0 && sequences.length === 0
        ? "(no prompt sheets or sequences yet)"
        : [
            ...promptTips.map(
              (t) =>
                `- ${t.type} v${t.version} [${t.status}]${t.isCustom ? " custom" : ""}${t.entityId ? ` entity=${t.entityId}` : ""}${t.sequenceId ? ` seq=${t.sequenceId}` : ""}`,
            ),
            ...sequences.map(
              (s) =>
                `- sequence "${s.title}" ${s.durationSec}s shots=${s.shotIds.length}`,
            ),
          ].join("\n");
    const assetTipsByEntity = promptTips
      .filter(
        (t) =>
          t.entityId &&
          (t.type === "character" ||
            t.type === "creature" ||
            t.type === "environment" ||
            t.type === "product"),
      )
      .map((t) => ({
        entityId: t.entityId as string,
        type: t.type as "character" | "creature" | "environment" | "product",
        version: t.version,
        renderedText: t.renderedText ?? "",
        renderedFileId: t.renderedFileId,
      }));
    return {
      project,
      entities,
      tip,
      creditBalance,
      scenesSummary,
      pipelineSummary,
      styleSheetFileId: styleEntity?.sheetFileId,
      hasLogline: Boolean(project.brief?.logline?.trim()),
      entitiesMissingSheets,
      assetTipsByEntity,
      messages: messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-20),
    };
  },
});
