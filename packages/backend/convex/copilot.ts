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
  scriptSummaryFromDocument,
  wantsScriptProposal,
  type CopilotMode,
  type CopilotRole,
} from "./lib/copilotPrompts";
import { normalizeProposedScript } from "./lib/normalizeScriptProposal";
import { parseToolArguments } from "./lib/parseToolArguments";
import { appendLedgerEntry, getWorkspaceBalance } from "./credits";
import { loadJson, saveJson } from "./storage";
import { requireProjectAccess, requireUser } from "./lib/access";

async function requireActionUser(ctx: ActionCtx) {
  const { getAuthUserId } = await import("@convex-dev/auth/server");
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  return userId as Id<"users">;
}

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
    roleUsed: roleValidator,
    mode: modeValidator,
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
    roleUsed: roleValidator,
    mode: modeValidator,
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
    return {
      project,
      entities,
      tip,
      creditBalance,
      scenesSummary,
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
    role: roleValidator,
    mode: modeValidator,
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

    const system = buildSystemPrompt({
      role: args.role as CopilotRole,
      mode: args.mode as CopilotMode,
      brief: loaded.project.brief ?? null,
      rules: loaded.project.rules,
      targetLengthSec: loaded.project.targetLengthSec,
      view: args.view,
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
    });

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

      if (useMock || !convexEnv("DEEPSEEK_API_KEY")) {
        result = await mockStream(ctx, assistantId, scriptDoc, content);
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

        // DeepSeek often answers in prose without tools. Force a script proposal
        // when the user clearly wants scenes and none were returned.
        const needsScript = wantsScriptProposal(
          content,
          (scriptDoc?.scenes.length ?? 0) > 0,
        );
        const hasScriptTool = result.toolCalls.some(
          (t) => t.name === "propose_script_edit",
        );
        if (needsScript && !hasScriptTool) {
          const followUp = await forceScriptProposal(history, result.content);
          result = mergeFollowUp(result, followUp);
        }
      }

      let proposalIds: Id<"proposals">[] = [];
      let toolFailures: string[] = [];
      for (const tc of result.toolCalls) {
        const outcome = await handleToolCall(ctx, {
          projectId: args.projectId,
          messageId: assistantId,
          name: tc.name,
          argumentsJson: tc.arguments,
          baseScript: scriptDoc,
        });
        if (outcome.proposalId) {
          proposalIds.push(outcome.proposalId);
        } else if (outcome.error) {
          toolFailures.push(outcome.error);
        }
      }

      // Tool call present but unusable (truncated / invalid JSON) — retry once.
      const needsScript = wantsScriptProposal(
        content,
        (scriptDoc?.scenes.length ?? 0) > 0,
      );
      if (
        needsScript &&
        proposalIds.length === 0 &&
        !useMock &&
        !!convexEnv("DEEPSEEK_API_KEY")
      ) {
        const followUp = await forceScriptProposal(history, result.content);
        result = mergeFollowUp(result, followUp);
        toolFailures = [];
        for (const tc of followUp.toolCalls) {
          const outcome = await handleToolCall(ctx, {
            projectId: args.projectId,
            messageId: assistantId,
            name: tc.name,
            argumentsJson: tc.arguments,
            baseScript: scriptDoc,
          });
          if (outcome.proposalId) {
            proposalIds.push(outcome.proposalId);
          } else if (outcome.error) {
            toolFailures.push(outcome.error);
          }
        }
      }

      // Last resort for draft requests: build a local proposal from the user text
      // so the UI always has an Accept card when we promised one.
      if (needsScript && proposalIds.length === 0) {
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

      if (proposalIds.length > 0) {
        finalContent = `${finalContent}\n\nAccept the proposal card below to apply this to your script.`;
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

async function mockStream(
  ctx: ActionCtx,
  assistantId: Id<"copilotMessages">,
  scriptDoc: ScriptDocument | null,
  userContent: string,
): Promise<Awaited<ReturnType<typeof streamChat>>> {
  const wantsScript =
    wantsScriptProposal(userContent, (scriptDoc?.scenes.length ?? 0) > 0) ||
    !scriptDoc;
  const text = wantsScript
    ? "Here's a draft script proposal based on your brief. Review the card and Accept to apply it."
    : "Mock DeepSeek reply: the scene works. I can propose a rewrite if you want.";

  for (const word of text.split(/(\s+)/)) {
    await ctx.runMutation(internal.copilot.appendAssistantDelta, {
      messageId: assistantId,
      delta: word,
    });
  }

  const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
  if (wantsScript) {
    const doc = mockScriptFromBrief(userContent, scriptDoc);
    toolCalls.push({
      id: "mock_tool_1",
      name: "propose_script_edit",
      arguments: JSON.stringify({
        summary: "Draft script from brief",
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

async function forceScriptProposal(
  history: ChatMessage[],
  priorAssistantContent: string,
): Promise<Awaited<ReturnType<typeof completeChat>>> {
  return await completeChat({
    messages: [
      ...history,
      {
        role: "assistant",
        content: priorAssistantContent || null,
      },
      {
        role: "user",
        content:
          "Call propose_script_edit now with a complete cinakey.script/1.0 JSON document. Keep the tool arguments compact but include at least 2–4 scenes with headings, beats, action, and dialogue lines. schema must be \"cinakey.script/1.0\". entityLinks may be []. Do not wrap the arguments in markdown.",
      },
    ],
    tools: COPILOT_TOOLS,
    toolChoice: {
      type: "function",
      function: { name: "propose_script_edit" },
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
  },
): Promise<{ proposalId: Id<"proposals"> | null; error?: string }> {
  const parsedResult = parseToolArguments(args.argumentsJson);
  if (!parsedResult.ok) {
    return { proposalId: null, error: parsedResult.error };
  }
  const parsed = parsedResult.value;

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

  return { proposalId: null, error: `Unknown tool ${args.name}` };
}
