import {
  assertScriptDocument,
  createEmptyScript,
  newScriptElementId,
  withRuntimeEstimates,
  type ScriptDocument,
} from "@cinakey/shared";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { completeChat, streamChat, type ChatMessage } from "./adapters/deepseek";
import { getAdapter } from "./adapters";
import { convexEnv } from "./lib/env";
import {
  buildSystemPrompt,
  COPILOT_TOOLS,
  normalizeCopilotView,
  scriptSummaryFromDocument,
} from "./lib/copilotPrompts";
import { normalizeProposedScript } from "./lib/normalizeScriptProposal";
import { api } from "./_generated/api";
import { parseToolArguments } from "./lib/parseToolArguments";
import { appendLedgerEntry, getWorkspaceBalance } from "./credits";
import { loadJson, saveJson } from "./storage";
import { requireProjectAccess, requireUser } from "./lib/access";
import { RATE_LIMITS } from "./lib/limits";
import { assertRateLimit } from "./lib/rateLimit";

async function requireActionUser(ctx: ActionCtx) {
  const { getAuthUserId } = await import("@convex-dev/auth/server");
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  return userId as Id<"users">;
}

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
    const limit = Math.min(args.limit ?? 100, 200);
    const messages = await ctx.db
      .query("copilotMessages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return messages
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-limit);
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
    return all.filter(
      (p) => p.status === "pending" || p.status === "edited",
    );
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
    if (job === null) return;
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
    const tipVersions = await ctx.db
      .query("scriptVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const tip =
      tipVersions.length === 0
        ? null
        : tipVersions.sort((a, b) => b.createdAt - a.createdAt)[0]!;
    const messages = await ctx.db
      .query("copilotMessages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
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
      messages: messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-20),
    };
  },
});

/**
 * Run one copilot turn: stream reply, create proposals from tools, settle credits.
 */
export const runTurn = action({
  args: {
    projectId: v.id("projects"),
    content: v.string(),
    role: v.optional(roleValidator),
    mode: v.optional(modeValidator),
    view: v.string(),
    selectionIds: v.optional(v.array(v.string())),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    messageId: Id<"copilotMessages">;
    proposalIds: Id<"proposals">[];
    jobId: Id<"generationJobs">;
  }> => {
    const userId = await requireActionUser(ctx);
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: args.projectId,
      userId,
    });

    await ctx.runMutation(internal.copilot.assertCopilotRateLimit, {
      userId,
    });

    const content = args.content.trim();
    if (content.length === 0) throw new Error("Message is empty");

    const loaded = await ctx.runQuery(internal.copilot.loadProjectContext, {
      projectId: args.projectId,
    });

    const adapter = getAdapter("deepseek");
    if (!adapter) throw new Error("DeepSeek adapter not found");
    const estimatedCostCredits = Math.max(
      1,
      adapter.estimateCost({ estimatedTokens: 2000 }),
    );

    if (loaded.creditBalance < estimatedCostCredits) {
      throw new ConvexError({
        code: "INSUFFICIENT_CREDITS" as const,
        balance: loaded.creditBalance,
        required: estimatedCostCredits,
      });
    }

    await ctx.runMutation(internal.copilot.insertUserMessageInternal, {
      projectId: args.projectId,
      content,
      roleUsed: args.role,
      mode: args.mode,
    });

    const copilotView = normalizeCopilotView(args.view);

    let scriptDoc: ScriptDocument | null = null;
    if (loaded.tip) {
      try {
        scriptDoc = assertScriptDocument(
          await loadJson(ctx, loaded.tip.contentFileId),
        );
      } catch {
        scriptDoc = null;
      }
    }

    let artStyleBlock: string | undefined;
    if (loaded.styleSheetFileId) {
      try {
        const styleSheet = (await loadJson(
          ctx,
          loaded.styleSheetFileId,
        )) as { artStyleBlock?: string };
        artStyleBlock = styleSheet.artStyleBlock;
      } catch {
        artStyleBlock = undefined;
      }
    }

    const system = buildSystemPrompt({
      brief: loaded.project.brief ?? null,
      rules: loaded.project.rules,
      targetLengthSec: loaded.project.targetLengthSec,
      view: copilotView,
      selectionIds: args.selectionIds ?? [],
      scriptSummary: scriptDoc
        ? scriptSummaryFromDocument(scriptDoc)
        : "(no script yet)",
      entitiesSummary:
        loaded.entities.length === 0
          ? "(none)"
          : loaded.entities
              .map(
                (e: { kind: string; name: string; description?: string }) =>
                  `- ${e.kind}: ${e.name}${e.description ? ` — ${e.description}` : ""}`,
              )
              .join("\n"),
      scenesSummary: loaded.scenesSummary,
      pipelineSummary: loaded.pipelineSummary,
      artStyleBlock,
    });

    const pipelineForce: PipelineForceState = {
      hasLogline: loaded.hasLogline,
      hasArtStyle: Boolean(artStyleBlock?.trim()),
      entitiesMissingSheets: loaded.entitiesMissingSheets,
      assetEntityCount: loaded.entities.filter(
        (e: { kind: string }) => e.kind !== "style",
      ).length,
      selectionIds: args.selectionIds ?? [],
    };

    const history: ChatMessage[] = [
      { role: "system", content: system },
      ...loaded.messages.map(
        (m: { role: string; content: string }): ChatMessage => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }),
      ),
      { role: "user", content },
    ];

    const jobId: Id<"generationJobs"> = await ctx.runMutation(
      internal.copilot.createChatJob,
      {
        projectId: args.projectId,
        workspaceId: loaded.project.workspaceId,
        userId,
        estimatedCostCredits,
        prompt: content,
      },
    );

    const assistantId: Id<"copilotMessages"> = await ctx.runMutation(
      internal.copilot.createAssistantMessage,
      {
        projectId: args.projectId,
        roleUsed: args.role,
        mode: args.mode,
        jobId,
      },
    );

    try {
      const useMock = convexEnv("USE_MOCK_ADAPTERS") === "true";
      let result: Awaited<ReturnType<typeof streamChat>>;
      const forceKind = pickForcedTool(args.view, content, pipelineForce);

      if (useMock || !convexEnv("DEEPSEEK_API_KEY")) {
        result = await mockStream(
          ctx,
          assistantId,
          scriptDoc,
          content,
          forceKind,
          pipelineForce,
        );
      } else {
        result = await streamChat({
          messages: history,
          tools: COPILOT_TOOLS,
          onToken: async (delta) => {
            await ctx.runMutation(internal.copilot.appendAssistantDelta, {
              messageId: assistantId,
              delta,
            });
          },
        });

        // DeepSeek often answers in prose or wrongly calls propose_script_edit —
        // force the pipeline/screenplay tool for the current stage.
        result = {
          ...result,
          toolCalls: filterToolCallsForForce(result.toolCalls, forceKind),
        };
        if (forceKind && !toolSatisfiesForce(result.toolCalls, forceKind)) {
          const followUp = await forceToolProposal(
            history,
            result.content,
            forceKind,
            pipelineForce,
          );
          result = mergeFollowUp(result, followUp);
          result = {
            ...result,
            toolCalls: filterToolCallsForForce(result.toolCalls, forceKind),
          };
        }
      }

      result = {
        ...result,
        toolCalls: filterToolCallsForForce(result.toolCalls, forceKind),
      };

      const proposalIds: Id<"proposals">[] = [];
      let toolFailures: string[] = [];
      const directMessages: string[] = [];
      for (const tc of result.toolCalls) {
        const outcome = await handleToolCall(ctx, {
          projectId: args.projectId,
          messageId: assistantId,
          name: tc.name,
          argumentsJson: tc.arguments,
          baseScript: scriptDoc,
          selectionIds: args.selectionIds ?? [],
        });
        if (outcome.proposalId) {
          proposalIds.push(outcome.proposalId);
        } else if (outcome.directMessage) {
          directMessages.push(outcome.directMessage);
        } else if (outcome.error) {
          toolFailures.push(outcome.error);
        }
      }

      // Tool call present but unusable (truncated / invalid JSON) — retry once.
      if (
        forceKind &&
        proposalIds.length === 0 &&
        !useMock &&
        !!convexEnv("DEEPSEEK_API_KEY")
      ) {
        const followUp = await forceToolProposal(
          history,
          result.content,
          forceKind,
          pipelineForce,
        );
        result = mergeFollowUp(result, followUp);
        result = {
          ...result,
          toolCalls: filterToolCallsForForce(result.toolCalls, forceKind),
        };
        toolFailures = [];
        for (const tc of result.toolCalls) {
          const outcome = await handleToolCall(ctx, {
            projectId: args.projectId,
            messageId: assistantId,
            name: tc.name,
            argumentsJson: tc.arguments,
            baseScript: scriptDoc,
            selectionIds: args.selectionIds ?? [],
          });
          if (outcome.proposalId) {
            proposalIds.push(outcome.proposalId);
          } else if (outcome.directMessage) {
            directMessages.push(outcome.directMessage);
          } else if (outcome.error) {
            toolFailures.push(outcome.error);
          }
        }
      }

      // Last resort: local screenplay fallback ONLY for explicit Script-room asks.
      if (
        forceKind === "propose_script_edit" &&
        proposalIds.length === 0
      ) {
        const fallbackDoc = mockScriptFromBrief(content, scriptDoc);
        const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
          projectId: args.projectId,
          messageId: assistantId,
          kind: "script_edit",
          payload: {
            summary: "Draft script from your description",
            document: fallbackDoc,
            baseVersionHint: scriptDoc?.scenes.length ?? 0,
          },
          diffSummary: "Draft script from your description",
        });
        proposalIds.push(proposalId);
      }

      let finalContent =
        result.content.trim().length > 0
          ? result.content
          : proposalIds.length > 0
            ? "I've prepared a proposal for you to review."
            : result.content;

      // Models often mention an Accept card without emitting a tool call —
      // strip that copy everywhere, then only promise a card when we created one.
      finalContent = finalContent
        .replace(
          /\n*Open the proposal card below[^\n]*/gi,
          "",
        )
        .replace(
          /\n*Accept the proposal card below[^\n]*/gi,
          "",
        )
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      if (directMessages.length > 0) {
        finalContent = [finalContent, ...directMessages].filter(Boolean).join("\n\n");
      }

      if (proposalIds.length > 0) {
        finalContent = `${finalContent}\n\nAccept the proposal card below to apply this to your project.`;
      } else if (toolFailures.length > 0) {
        finalContent = `${finalContent}\n\nI tried to prepare a script proposal but couldn't parse it (${toolFailures[0]}). Please ask me again to draft the script.`;
      }

      await ctx.runMutation(internal.copilot.finalizeAssistantMessage, {
        messageId: assistantId,
        content: finalContent,
        toolCalls: result.toolCalls,
        proposalIds,
        streaming: false,
      });

      const totalTokens = result.usage?.total_tokens ?? 1500;
      const actualCostCredits = Math.max(
        1,
        Math.ceil(totalTokens / 1000) * 1,
      );

      await ctx.runMutation(internal.copilot.settleChatJob, {
        jobId,
        workspaceId: loaded.project.workspaceId,
        userId,
        projectId: args.projectId,
        actualCostCredits: Math.min(actualCostCredits, estimatedCostCredits),
        succeeded: true,
      });

      return { messageId: assistantId, proposalIds, jobId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Copilot failed";
      await ctx.runMutation(internal.copilot.finalizeAssistantMessage, {
        messageId: assistantId,
        content: `Error: ${message}`,
        streaming: false,
      });
      await ctx.runMutation(internal.copilot.settleChatJob, {
        jobId,
        workspaceId: loaded.project.workspaceId,
        userId,
        projectId: args.projectId,
        actualCostCredits: 0,
        succeeded: false,
        errorMessage: message,
      });
      throw err;
    }
  },
});

/** Early pipeline tools that count as progress toward a Copilot-tab ask. */
const PIPELINE_PROGRESS_TOOLS = new Set([
  "propose_story_treatment",
  "propose_style_block",
  "propose_asset_list",
  "propose_asset_sheet",
  "revise_asset_sheet",
  "propose_script_prompt",
  "propose_blockout_sheet",
]);

type ForcedToolName =
  | "propose_script_edit"
  | "propose_story_treatment"
  | "propose_style_block"
  | "propose_asset_list"
  | "propose_asset_sheet"
  | "propose_script_prompt";

type PipelineForceState = {
  hasLogline: boolean;
  hasArtStyle: boolean;
  entitiesMissingSheets: Array<{
    id: string;
    name: string;
    kind: "character" | "creature" | "location" | "prop";
  }>;
  assetEntityCount: number;
  selectionIds: string[];
};

function pickForcedTool(
  _view: string,
  _userContent: string,
  _pipeline: PipelineForceState,
): ForcedToolName | null {
  return null;
}

/**
 * Whether the model's tool calls already satisfy the forced pipeline/script tool.
 * propose_script_edit must NOT count when we wanted a pipeline tool — that was
 * producing truncated Fountain screenplays instead of Seedance script prompts.
 */
function toolSatisfiesForce(
  toolCalls: Array<{ name: string }>,
  forceKind: ForcedToolName,
): boolean {
  if (forceKind === "propose_script_edit") {
    return toolCalls.some((t) => t.name === "propose_script_edit");
  }
  if (forceKind === "propose_script_prompt") {
    return toolCalls.some((t) => t.name === "propose_script_prompt");
  }
  if (forceKind === "propose_asset_sheet") {
    return toolCalls.some(
      (t) =>
        t.name === "propose_asset_sheet" || t.name === "revise_asset_sheet",
    );
  }
  if (forceKind === "propose_asset_list") {
    return toolCalls.some((t) => t.name === "propose_asset_list");
  }
  if (forceKind === "propose_style_block") {
    return toolCalls.some((t) => t.name === "propose_style_block");
  }
  if (forceKind === "propose_story_treatment") {
    return toolCalls.some((t) => t.name === "propose_story_treatment");
  }
  return toolCalls.some((t) => PIPELINE_PROGRESS_TOOLS.has(t.name));
}

/** Drop screenplay tool calls when the force target is a pipeline tool. */
function filterToolCallsForForce(
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
  forceKind: ForcedToolName | null,
): Array<{ id: string; name: string; arguments: string }> {
  if (forceKind && forceKind !== "propose_script_edit") {
    return toolCalls.filter((t) => t.name !== "propose_script_edit");
  }
  return toolCalls;
}

async function mockStream(
  ctx: ActionCtx,
  assistantId: Id<"copilotMessages">,
  scriptDoc: ScriptDocument | null,
  userContent: string,
  forceKind: ForcedToolName | null,
  pipeline: PipelineForceState,
): Promise<Awaited<ReturnType<typeof streamChat>>> {
  const text =
    forceKind === "propose_script_prompt"
      ? "Here's a structured Seedance script-prompt proposal. Accept to create the sequence and shots."
      : forceKind === "propose_asset_sheet"
        ? "Here's a structured asset sheet proposal for Look Dev. Accept to fill the character fields and prompt sheet."
        : forceKind === "propose_asset_list"
          ? "Here's an asset list proposal — Accept to create Look Dev entities, then we'll draft each sheet."
          : forceKind === "propose_style_block"
            ? "Here's an art-style block proposal to lock the look across every sheet."
            : forceKind === "propose_story_treatment"
              ? "Here's a story treatment proposal to start the pipeline. Accept, then we'll draft asset sheets and the Seedance script prompt."
              : forceKind === "propose_script_edit"
                ? "Here's a draft screenplay proposal. Review the card and Accept to apply it."
                : "Mock DeepSeek reply: the scene works. I can propose a rewrite if you want.";

  for (const word of text.split(/(\s+)/)) {
    await ctx.runMutation(internal.copilot.appendAssistantDelta, {
      messageId: assistantId,
      delta: word,
    });
  }

  const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
  if (forceKind === "propose_script_prompt") {
    toolCalls.push({
      id: "mock_tool_1",
      name: "propose_script_prompt",
      arguments: JSON.stringify({
        summary: "Seedance script prompt from brief (mock)",
        sequenceTitle: "Sequence 1",
        applyShots: true,
        structured: mockScriptPromptFromBrief(userContent),
        referenceMap: [],
      }),
    });
  } else if (forceKind === "propose_asset_sheet") {
    const targets =
      pipeline.selectionIds.length > 0
        ? pipeline.entitiesMissingSheets.filter((e) =>
            pipeline.selectionIds.includes(e.id),
          )
        : pipeline.entitiesMissingSheets;
    const list =
      targets.length > 0
        ? targets.slice(0, 4)
        : [
            {
              id: "mock",
              name: "Boy",
              kind: "character" as const,
            },
          ];
    for (const [i, ent] of list.entries()) {
      const type =
        ent.kind === "creature"
          ? "creature"
          : ent.kind === "location"
            ? "environment"
            : ent.kind === "prop"
              ? "product"
              : "character";
      toolCalls.push({
        id: `mock_asset_${i}`,
        name: "propose_asset_sheet",
        arguments: JSON.stringify({
          summary: `${ent.name} asset sheet (mock)`,
          type,
          entityId: ent.id === "mock" ? undefined : ent.id,
          entityName: ent.name,
          structured: mockAssetSheetStructured(type, ent.name, userContent),
        }),
      });
    }
  } else if (forceKind === "propose_asset_list") {
    toolCalls.push({
      id: "mock_tool_1",
      name: "propose_asset_list",
      arguments: JSON.stringify({
        summary: "Core cast and locations",
        entities: [
          {
            kind: "character",
            name: "Boy",
            description: "Young savanna hunter",
          },
          {
            kind: "creature",
            name: "Cheetah",
            description: "Giant riding cheetah",
          },
          {
            kind: "location",
            name: "Savanna",
            description: "Golden hour grassland",
          },
        ],
      }),
    });
  } else if (forceKind === "propose_style_block") {
    toolCalls.push({
      id: "mock_tool_1",
      name: "propose_style_block",
      arguments: JSON.stringify({
        summary: "Project art style",
        artStyleBlock:
          "soft painted anime illustration with a warm watercolor-and-gouache texture, gentle faceted shading, soft but clean painterly edges, fine thin warm-dark outlines, subtle paper-like grain.",
      }),
    });
  } else if (forceKind === "propose_script_edit") {
    const doc = mockScriptFromBrief(userContent, scriptDoc);
    toolCalls.push({
      id: "mock_tool_1",
      name: "propose_script_edit",
      arguments: JSON.stringify({
        summary: "Draft script from brief",
        document: doc,
      }),
    });
  } else if (forceKind === "propose_story_treatment") {
    const doc = mockScriptFromBrief(userContent, scriptDoc);
    toolCalls.push({
      id: "mock_tool_1",
      name: "propose_story_treatment",
      arguments: JSON.stringify({
        summary: "Story treatment from your brief",
        logline: userContent.slice(0, 200),
        document: doc,
      }),
    });
  }

  return {
    content: text,
    toolCalls,
    usage: { total_tokens: 800 },
  };
}

function mockAssetSheetStructured(
  type: "character" | "creature" | "environment" | "product",
  name: string,
  brief: string,
) {
  const snippet = brief.slice(0, 120) || name;
  if (type === "creature") {
    return {
      subjectLine: `a ${name}`,
      views: ["full-body side view", "full-body front view", "head close-up"],
      body: `Detailed creature design for ${name}. ${snippet}`,
      colorPalette: "golden tan, cream, warm leather accents",
    };
  }
  if (type === "environment") {
    return {
      place: name,
      timeOfDay: "golden hour",
      cameraAngle: "low angle just above the grass",
      theLand: `Environment for ${name}. ${snippet}`,
      skyAndLight: "Warm low sun, long shadows, apricot-to-violet sky.",
      colorPalette: "golden grass, red earth, apricot sky",
    };
  }
  if (type === "product") {
    return {
      objectName: name,
      views: "three-quarter hero view and side profile",
      theObject: {
        heading: "THE OBJECT",
        body: `Product design for ${name}. ${snippet}`,
      },
      feel: "tactile, story-worn, readable silhouette",
      colorPalette: "wood, brass, cream accents",
    };
  }
  return {
    subjectLine: `an original character, ${name}`,
    views: [
      "full-body front view",
      "full-body side view",
      "three-quarter head close-up",
    ],
    faceAndHair: `Face and build for ${name}. ${snippet}`,
    outfit: `Wardrobe for ${name}, story-worn and silhouette-clear.`,
    signatureDetail: {
      heading: "SIGNATURE",
      body: `A memorable detail unique to ${name}.`,
    },
    colorPalette: "warm earth tones with one accent color",
  };
}

function mockScriptPromptFromBrief(userContent: string) {
  const brief = userContent.slice(0, 160) || "the scene";
  return {
    references: [
      {
        imageN: 1,
        entityId: "lead",
        entityLabel: "the lead",
        useFor: "Use it for exact face, costume and proportions.",
      },
      {
        imageN: 2,
        entityId: "location",
        entityLabel: "the location",
        useFor: "Use it for exact environment, light and atmosphere.",
      },
    ],
    artStyleBlock:
      "soft painted anime illustration with warm watercolor texture and clean painterly edges.",
    imageQuality:
      "Every frame sharp and clean. No noise, flicker, warping or ghosting.",
    castBlocks: [
      {
        name: "lead",
        imageN: 1,
        suffix: ", identical in every shot",
        description: `Character matching the brief: ${brief}`,
      },
    ],
    location: {
      imageN: 2,
      description: `Environment from the brief: ${brief}. No readable text.`,
    },
    totalDurationSec: 12,
    aspectRatio: "16:9",
    multiShot: true,
    shots: [
      {
        n: 1,
        startSec: 0,
        endSec: 3,
        shotType: "Extreme wide shot",
        cameraMove: "slow drift forward",
        action: `Establish the location; ${brief}`,
      },
      {
        n: 2,
        startSec: 3,
        endSec: 6,
        shotType: "Medium shot",
        action: "The lead enters frame and settles, matching @image_1 exactly.",
      },
      {
        n: 3,
        startSec: 6,
        endSec: 9,
        shotType: "Close-up",
        action: "Eyes lock on the target; scarf/hair moves in the wind.",
      },
      {
        n: 4,
        startSec: 9,
        endSec: 12,
        shotType: "Wide tracking shot",
        cameraMove: "track alongside",
        action: "Action beat from the brief resolves; last frame matches style.",
      },
    ],
    consistency:
      "Keep @image_1 and @image_2 locked. No costume or face drift across shots.",
    motionAndPhysics:
      "Natural weight and momentum; no melting limbs or smeared faces.",
    lighting: "Match the locked location light direction and color.",
    technical: "16:9, multi-shot, contiguous timings from 0.",
    music: "Low pulse under wind; swell on the final beat.",
    audioCues: [
      { atSec: 0, description: "Ambient wind" },
      { atSec: 9, description: "Action hit" },
    ],
  };
}

function mockScriptFromBrief(
  userContent: string,
  existing: ScriptDocument | null,
): ScriptDocument {
  if (existing && existing.scenes.length > 0) {
    const scene = existing.scenes[0]!;
    const rewritten: ScriptDocument = {
      ...existing,
      scenes: [
        {
          ...scene,
          beats: scene.beats.map((beat, i) =>
            i === 0
              ? {
                  ...beat,
                  lines: beat.lines.map((line, j) =>
                    j === 0
                      ? {
                          ...line,
                          dialogue: `${line.dialogue} (rewritten)`,
                        }
                      : line,
                  ),
                }
              : beat,
          ),
        },
        ...existing.scenes.slice(1),
      ],
    };
    return withRuntimeEstimates(rewritten);
  }

  const sceneId = newScriptElementId();
  const beatId = newScriptElementId();
  const doc = createEmptyScript("screenplay");
  doc.scenes = [
    {
      id: sceneId,
      heading: "INT. CAFÉ - DAY",
      synopsis: userContent.slice(0, 120),
      beats: [
        {
          id: beatId,
          action: "Two friends sit across a small wooden table.",
          lines: [
            {
              id: newScriptElementId(),
              characterName: "MAYA",
              dialogue: "You're late again.",
            },
            {
              id: newScriptElementId(),
              characterName: "JORDAN",
              dialogue: "Traffic. I know.",
            },
          ],
        },
      ],
    },
  ];
  return withRuntimeEstimates(doc);
}

async function forceToolProposal(
  history: ChatMessage[],
  priorAssistantContent: string,
  toolName: ForcedToolName,
  pipeline: PipelineForceState,
): Promise<Awaited<ReturnType<typeof completeChat>>> {
  const missing = pipeline.entitiesMissingSheets;
  const selectedMissing =
    pipeline.selectionIds.length > 0
      ? missing.filter((e) => pipeline.selectionIds.includes(e.id))
      : missing;
  const sheetTargets =
    selectedMissing.length > 0 ? selectedMissing : missing;

  const nudge =
    toolName === "propose_script_prompt"
      ? "Call propose_script_prompt now with complete ScriptPromptData: references (one per locked asset), artStyleBlock, imageQuality, castBlocks derived from asset details, location, totalDurationSec, aspectRatio, shots[] covering the full sequence with contiguous startSec/endSec from 0, consistency, motionAndPhysics, lighting, technical, music, audioCues[]. Do not use propose_script_edit. Do not wrap arguments in markdown."
      : toolName === "propose_asset_sheet"
        ? `Call propose_asset_sheet now for EACH of these entities that still lack a sheet (one tool call per entity): ${sheetTargets
            .map((e) => `${e.name} (${e.kind}, entityId=${e.id})`)
            .join("; ") || "every named cast/location/prop from the story"}. Use type character|creature|environment|product matching the entity kind (location→environment, prop→product). Fill complete structured fields (subjectLine, views, faceAndHair/body, outfit/gear, signatureDetail, colorPalette, etc.). Set entityId when known. Do NOT call propose_script_edit. Do not wrap arguments in markdown.`
        : toolName === "propose_asset_list"
          ? "Call propose_asset_list now with every character, creature, location, and prop needed for the film (name + short description). Do NOT call propose_script_edit. Do not wrap arguments in markdown."
          : toolName === "propose_style_block"
            ? "Call propose_style_block now with a complete project artStyleBlock paragraph (medium, shading, edges, outlines, grain, palette locks, and what to avoid). Do NOT call propose_script_edit. Do not wrap arguments in markdown."
            : toolName === "propose_story_treatment"
              ? "Call propose_story_treatment now with a logline and a cinakey.script/1.0 treatment document (scenes as story beats). Then in the same turn also call propose_style_block and propose_asset_list when you can. Do NOT call propose_script_edit — that is for Script-room screenplays, not the video pipeline. Do not wrap arguments in markdown."
              : "Call propose_script_edit now with a complete cinakey.script/1.0 JSON document. Keep the tool arguments compact but include at least 2–4 scenes with headings, beats, action, and dialogue lines. schema must be \"cinakey.script/1.0\". entityLinks may be []. Do not wrap the arguments in markdown.";

  return await completeChat({
    messages: [
      ...history,
      {
        role: "assistant",
        content: priorAssistantContent || null,
      },
      {
        role: "user",
        content: nudge,
      },
    ],
    tools: COPILOT_TOOLS,
    toolChoice: {
      type: "function",
      function: { name: toolName },
    },
  });
}

function mergeFollowUp(
  prior: Awaited<ReturnType<typeof streamChat>>,
  followUp: Awaited<ReturnType<typeof completeChat>>,
): Awaited<ReturnType<typeof streamChat>> {
  return {
    content:
      prior.content.trim().length > 0
        ? prior.content
        : followUp.content ||
          "I've prepared a script proposal for you to review.",
    toolCalls:
      followUp.toolCalls.length > 0 ? followUp.toolCalls : prior.toolCalls,
    usage: {
      total_tokens:
        (prior.usage?.total_tokens ?? 0) + (followUp.usage?.total_tokens ?? 0),
    },
  };
}

async function handleToolCall(
  ctx: ActionCtx,
  args: {
    projectId: Id<"projects">;
    messageId: Id<"copilotMessages">;
    name: string;
    argumentsJson: string;
    baseScript: ScriptDocument | null;
    selectionIds?: string[];
  },
): Promise<{
  proposalId: Id<"proposals"> | null;
  error?: string;
  directMessage?: string;
}> {
  const parsedResult = parseToolArguments(args.argumentsJson);
  if (!parsedResult.ok) {
    return { proposalId: null, error: parsedResult.error };
  }
  const parsed = parsedResult.value;

  if (args.name === "write_or_revise_asset_prompt") {
    const assetType = String(
      parsed.assetType ?? parsed.type ?? "character",
    ) as "character" | "creature" | "environment" | "product";
    const promptText = String(parsed.promptText ?? "").trim();
    if (!promptText) {
      return { proposalId: null, error: "promptText required" };
    }
    try {
      const saved = await ctx.runAction(api.promptSheets.savePromptText, {
        projectId: args.projectId,
        type: assetType,
        promptText,
        entityId: parsed.entityId
          ? (String(parsed.entityId) as Id<"entities">)
          : undefined,
        entityName: parsed.entityName
          ? String(parsed.entityName)
          : undefined,
        name: parsed.name ? String(parsed.name) : undefined,
      });
      const summary = String(parsed.summary ?? "Asset prompt updated");
      let msg = `${summary} (sheet v${saved.version}).`;
      if (saved.validationWarning) {
        msg += ` Note: ${saved.validationWarning}`;
      }
      return { proposalId: null, directMessage: msg };
    } catch (err) {
      return {
        proposalId: null,
        error: err instanceof Error ? err.message : "savePromptText failed",
      };
    }
  }

  if (args.name === "write_or_revise_script_prompt") {
    type PartArg = {
      promptText?: string;
      title?: string;
      sequenceId?: string;
    };
    const partsRaw = Array.isArray(parsed.parts)
      ? (parsed.parts as PartArg[])
      : null;
    const singleText = String(parsed.promptText ?? "").trim();
    const parts: PartArg[] =
      partsRaw && partsRaw.length > 0
        ? partsRaw
        : singleText
          ? [
              {
                promptText: singleText,
                title: parsed.title ? String(parsed.title) : undefined,
                sequenceId: parsed.sequenceId
                  ? String(parsed.sequenceId)
                  : args.selectionIds?.[0],
              },
            ]
          : [];
    if (parts.length === 0) {
      return {
        proposalId: null,
        error: "promptText or parts[] required",
      };
    }
    try {
      const messages: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        const text = String(part.promptText ?? "").trim();
        if (!text) continue;
        const saved = await ctx.runAction(
          api.promptSheets.saveScriptPromptText,
          {
            projectId: args.projectId,
            sequenceId: part.sequenceId
              ? (part.sequenceId as Id<"sequences">)
              : undefined,
            promptText: text,
            title:
              part.title?.trim() ||
              (parts.length > 1 ? `Part ${i + 1}` : undefined),
          },
        );
        let line = `Part ${i + 1} saved (v${saved.version}, ${saved.shotCount} shots).`;
        if (saved.validationWarning) {
          line += ` Note: ${saved.validationWarning}`;
        }
        messages.push(line);
      }
      const summary = String(parsed.summary ?? "Script prompt updated");
      return {
        proposalId: null,
        directMessage: `${summary} ${messages.join(" ")}`.trim(),
      };
    } catch (err) {
      return {
        proposalId: null,
        error:
          err instanceof Error
            ? err.message
            : "saveScriptPromptText failed",
      };
    }
  }

  if (args.name === "update_rules") {
    try {
      await ctx.runMutation(internal.proposals.applyRules, {
        projectId: args.projectId,
        add: Array.isArray(parsed.add) ? (parsed.add as string[]) : undefined,
        remove: Array.isArray(parsed.remove)
          ? (parsed.remove as string[])
          : undefined,
        replace: Array.isArray(parsed.replace)
          ? (parsed.replace as string[])
          : undefined,
      });
      return {
        proposalId: null,
        directMessage: String(parsed.summary ?? "Project rules updated."),
      };
    } catch (err) {
      return {
        proposalId: null,
        error: err instanceof Error ? err.message : "update_rules failed",
      };
    }
  }

  if (args.name === "generate_image") {
    const summary = String(parsed.summary ?? "Generate image");
    const gptEstimate = 10;
    let promptSheetId = parsed.promptSheetId
      ? String(parsed.promptSheetId)
      : "";
    if (!promptSheetId && parsed.entityId) {
      const tips = await ctx.runQuery(internal.promptSheets.listTipsInternal, {
        projectId: args.projectId,
      });
      const entityId = String(parsed.entityId) as Id<"entities">;
      const match = tips
        .filter(
          (t) =>
            t.entityId === entityId &&
            (t.type === "character" ||
              t.type === "creature" ||
              t.type === "environment" ||
              t.type === "product"),
        )
        .sort((a, b) => b.version - a.version)[0];
      promptSheetId = match?._id ?? "";
    }
    if (!promptSheetId) {
      return {
        proposalId: null,
        error:
          "No prompt sheet found — use write_or_revise_asset_prompt first",
      };
    }
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "generate_image",
      payload: {
        summary,
        promptSheetId,
      },
      diffSummary: summary,
      estimatedCostCredits: gptEstimate,
    });
    return { proposalId };
  }

  if (args.name === "generate_video") {
    const summary = String(parsed.summary ?? "Generate video");
    let sequenceId = parsed.sequenceId ? String(parsed.sequenceId) : "";
    if (!sequenceId && args.selectionIds?.[0]) {
      sequenceId = args.selectionIds[0];
    }
    if (!sequenceId) {
      const sequences = await ctx.runQuery(internal.sequences.listInternal, {
        projectId: args.projectId,
      });
      sequenceId = sequences[0]?._id ?? "";
    }
    if (!sequenceId) {
      return {
        proposalId: null,
        error: "No Part/sequence found — write a script first",
      };
    }
    const sequence = await ctx.runQuery(
      internal.shotGeneration.getSequenceInternal,
      { sequenceId: sequenceId as Id<"sequences"> },
    );
    if (!sequence || sequence.projectId !== args.projectId) {
      return { proposalId: null, error: "Sequence not found" };
    }
    const adapter = getAdapter("seedance-2.5");
    const durationSec = Math.min(sequence.durationSec, 30);
    const estimate = adapter
      ? adapter.estimateCost({
          kind: "text-to-video",
          durationSec,
          prompt: "sequence",
        })
      : durationSec * 2;
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "generate_video",
      payload: { summary, sequenceId },
      diffSummary: summary,
      estimatedCostCredits: estimate,
    });
    return { proposalId };
  }

  if (args.name === "propose_script_edit") {
    const documentRaw =
      parsed.document ??
      parsed.script ??
      (Array.isArray(parsed.scenes) ? parsed : null);

    const document = normalizeProposedScript(documentRaw);
    if (document === null) {
      return {
        proposalId: null,
        error: "Script tool call had no usable scenes",
      };
    }
    const summary = String(
      parsed.summary ?? parsed.description ?? "Script edit",
    );
    const payload = {
      summary,
      document,
      baseVersionHint: args.baseScript?.scenes.length ?? 0,
    };

    // Keep large scripts out of the document row when needed.
    const approxSize = JSON.stringify(payload).length;
    if (approxSize > 400_000) {
      const { storageId } = await saveJson(ctx, payload);
      const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
        projectId: args.projectId,
        messageId: args.messageId,
        kind: "script_edit",
        payloadFileId: storageId,
        diffSummary: summary,
      });
      return { proposalId };
    }

    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "script_edit",
      payload,
      diffSummary: summary,
    });
    return { proposalId };
  }

  if (args.name === "propose_entities") {
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "entities",
      payload: {
        summary: String(parsed.summary ?? "Entity updates"),
        entities: parsed.entities ?? [],
      },
      diffSummary: String(parsed.summary ?? "Entity updates"),
    });
    return { proposalId };
  }

  if (args.name === "propose_rules") {
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "rules",
      payload: {
        summary: String(parsed.summary ?? "Rules update"),
        add: parsed.add ?? [],
        remove: parsed.remove ?? [],
        replace: parsed.replace ?? undefined,
      },
      diffSummary: String(parsed.summary ?? "Rules update"),
    });
    return { proposalId };
  }

  if (args.name === "propose_character_details") {
    const summary = String(parsed.summary ?? "Character details");
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "character_details",
      payload: {
        summary,
        entityId: parsed.entityId ? String(parsed.entityId) : undefined,
        entityName: parsed.entityName ? String(parsed.entityName) : undefined,
        fields: (parsed.fields as Record<string, string>) ?? {},
      },
      diffSummary: summary,
    });
    return { proposalId };
  }

  if (args.name === "propose_image_prompt") {
    const summary = String(parsed.summary ?? "Image prompt");
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "image_prompt",
      payload: {
        summary,
        entityId: parsed.entityId ? String(parsed.entityId) : undefined,
        entityName: parsed.entityName ? String(parsed.entityName) : undefined,
        prompt: String(parsed.prompt ?? ""),
      },
      diffSummary: summary,
    });
    return { proposalId };
  }

  if (args.name === "propose_shot_list") {
    const summary = String(parsed.summary ?? "Shot list");
    const sceneElementId = String(parsed.sceneElementId ?? "");
    const shots = Array.isArray(parsed.shots) ? parsed.shots : [];
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "shot_list",
      payload: {
        summary,
        sceneElementId,
        shots,
      },
      diffSummary: `${summary} (${shots.length} shots)`,
    });
    return { proposalId };
  }

  if (args.name === "propose_story_treatment") {
    const summary = String(parsed.summary ?? "Story treatment");
    const document = parsed.document
      ? normalizeProposedScript(parsed.document)
      : null;
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "story_treatment",
      payload: {
        summary,
        logline: String(parsed.logline ?? ""),
        audience: parsed.audience ? String(parsed.audience) : undefined,
        tone: parsed.tone ? String(parsed.tone) : undefined,
        document: document ?? undefined,
      },
      diffSummary: summary,
    });
    return { proposalId };
  }

  if (args.name === "propose_style_block") {
    const summary = String(parsed.summary ?? "Art style");
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "style_block",
      payload: {
        summary,
        artStyleBlock: String(parsed.artStyleBlock ?? ""),
      },
      diffSummary: summary,
      estimatedCostCredits: 0,
    });
    return { proposalId };
  }

  if (args.name === "propose_asset_list") {
    const summary = String(parsed.summary ?? "Asset list");
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "asset_list",
      payload: {
        summary,
        entities: parsed.entities ?? [],
      },
      diffSummary: summary,
    });
    return { proposalId };
  }

  if (
    args.name === "propose_asset_sheet" ||
    args.name === "revise_asset_sheet"
  ) {
    const summary = String(parsed.summary ?? "Asset sheet");
    const type = String(parsed.type ?? "character");
    const { validateStructured } = await import("./lib/promptRender");
    const validated = validateStructured(
      type as "character" | "creature" | "environment" | "product",
      parsed.structured,
    );
    if (!validated.ok) {
      return { proposalId: null, error: validated.error };
    }
    const gptEstimate = 10;
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "asset_sheet",
      payload: {
        summary,
        type,
        entityId: parsed.entityId ? String(parsed.entityId) : undefined,
        entityName: parsed.entityName ? String(parsed.entityName) : undefined,
        structured: validated.data,
        approveAndGenerate: parsed.approveAndGenerate === true,
        replaceTipId: parsed.promptSheetId
          ? String(parsed.promptSheetId)
          : undefined,
      },
      diffSummary: summary,
      estimatedCostCredits:
        parsed.approveAndGenerate === true ? gptEstimate : 0,
    });
    return { proposalId };
  }

  if (args.name === "propose_script_prompt") {
    const summary = String(parsed.summary ?? "Script prompt");
    const { validateStructured } = await import("./lib/promptRender");
    const validated = validateStructured("script", parsed.structured);
    if (!validated.ok) {
      return { proposalId: null, error: validated.error };
    }
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "script_prompt",
      payload: {
        summary,
        structured: validated.data,
        sequenceTitle: parsed.sequenceTitle
          ? String(parsed.sequenceTitle)
          : undefined,
        applyShots: parsed.applyShots !== false,
        referenceMap: Array.isArray(parsed.referenceMap)
          ? parsed.referenceMap
          : [],
        sourceAssetSheetIds: Array.isArray(parsed.sourceAssetSheetIds)
          ? parsed.sourceAssetSheetIds
          : undefined,
      },
      diffSummary: summary,
    });
    return { proposalId };
  }

  if (args.name === "propose_blockout_sheet") {
    const summary = String(parsed.summary ?? "Blockout sheet");
    const { validateStructured } = await import("./lib/promptRender");
    const validated = validateStructured("blockout", parsed.structured);
    if (!validated.ok) {
      return { proposalId: null, error: validated.error };
    }
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "blockout_sheet",
      payload: {
        summary,
        structured: validated.data,
        sequenceId: parsed.sequenceId ? String(parsed.sequenceId) : undefined,
        sourceScriptPromptId: parsed.sourceScriptPromptId
          ? String(parsed.sourceScriptPromptId)
          : undefined,
        applyBlockout: parsed.applyBlockout !== false,
      },
      diffSummary: summary,
    });
    return { proposalId };
  }

  if (args.name === "apply_blockout_sheet") {
    const summary = String(parsed.summary ?? "Apply blockout");
    const promptSheetId = String(parsed.promptSheetId ?? "");
    if (!promptSheetId) {
      return { proposalId: null, error: "promptSheetId required" };
    }
    const sheet = await ctx.runQuery(internal.promptSheets.getInternal, {
      promptSheetId: promptSheetId as Id<"promptSheets">,
    });
    if (sheet === null) {
      return { proposalId: null, error: "Blockout sheet not found" };
    }
    const structured = await loadJson(ctx, sheet.structuredFileId);
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "blockout_sheet",
      payload: {
        summary,
        structured,
        sequenceId: sheet.sequenceId,
        sourceScriptPromptId: sheet.sourceScriptPromptId,
        applyBlockout: true,
        replaceTipId: sheet._id,
      },
      diffSummary: summary,
    });
    return { proposalId };
  }

  if (args.name === "propose_shot_prompt") {
    const summary = String(parsed.summary ?? "Shot prompt");
    const shotId = String(parsed.shotId ?? "");
    const promptText = String(parsed.promptText ?? "").trim();
    if (!shotId || !promptText) {
      return { proposalId: null, error: "shotId and promptText required" };
    }
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "shot_prompt",
      payload: { summary, shotId, promptText },
      diffSummary: summary,
    });
    return { proposalId };
  }

  if (args.name === "check_continuity") {
    const summary = String(parsed.summary ?? "Continuity check");
    const flags = Array.isArray(parsed.flags) ? parsed.flags : [];
    if (flags.length === 0) {
      return { proposalId: null, error: "flags required" };
    }
    const proposalId = await ctx.runMutation(internal.copilot.createProposal, {
      projectId: args.projectId,
      messageId: args.messageId,
      kind: "continuity",
      payload: {
        summary,
        shotId: parsed.shotId ? String(parsed.shotId) : undefined,
        takeId: parsed.takeId ? String(parsed.takeId) : undefined,
        flags,
      },
      diffSummary: `${summary} (${flags.length} flag${flags.length === 1 ? "" : "s"})`,
    });
    return { proposalId };
  }

  return { proposalId: null, error: `Unknown tool ${args.name}` };
}
