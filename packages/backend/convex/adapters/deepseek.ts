import type {
  BuildRequestInput,
  CollectResult,
  GenerationAdapter,
  PollResult,
  ProviderRequest,
  SubmitResult,
} from "@cinakey/shared";
import { convexEnv } from "../lib/env";
import {
  estimateTokenCost,
  isDefaultTransientError,
} from "./cost";

const COST = { unit: "per_1k_tokens", creditsPerUnit: 1 } as const;

const inlineResults = new Map<
  string,
  {
    status: PollResult["status"];
    outputs: CollectResult["outputs"];
    error?: string;
    actualUnits?: number;
  }
>();

/**
 * DeepSeek — chat completion with tool calling.
 *
 * TODO(deepseek-api): streaming to the browser is deferred (copilot UI).
 * This adapter completes synchronously inside Convex actions.
 * TODO(deepseek-api): confirm tool-calling payload is OpenAI-compatible.
 */
export const deepseekAdapter: GenerationAdapter = {
  capabilities: {
    id: "deepseek",
    kind: "llm",
    operations: ["chat"],
    inputs: ["text"],
    features: ["chat"],
    costModel: COST,
  },

  estimateCost(input) {
    return estimateTokenCost(input, COST);
  },

  async buildRequest(input: BuildRequestInput): Promise<ProviderRequest> {
    const messages =
      (input.messages as Array<{ role: string; content: string }> | undefined) ??
      [
        {
          role: "user",
          content: input.prompt ?? "",
        },
      ];
    return {
      kind: "chat",
      model: "deepseek-chat",
      messages,
      // OpenAI-compatible tools array if provided.
      tools: input.tools,
      estimatedTokens: input.estimatedTokens ?? 1000,
    };
  },

  async submit(request: ProviderRequest): Promise<SubmitResult> {
    const apiKey = convexEnv("DEEPSEEK_API_KEY");
    if (!apiKey) {
      throw new Error("DEEPSEEK_API_KEY is not set");
    }
    const providerJobId = `deepseek_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // TODO(deepseek-api): streaming — set stream:true and pipe when copilot UI lands.
    const body: Record<string, unknown> = {
      model: request.model ?? "deepseek-chat",
      messages: request.messages,
      stream: false,
    };
    if (request.tools) {
      body.tools = request.tools;
    }

    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DeepSeek chat ${res.status}: ${text}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: unknown;
        };
      }>;
      usage?: { total_tokens?: number };
    };
    const message = data.choices?.[0]?.message;
    const tokens = data.usage?.total_tokens ?? 1000;
    inlineResults.set(providerJobId, {
      status: "succeeded",
      actualUnits: Math.ceil(tokens / 1000),
      outputs: [
        {
          type: "text",
          metadata: {
            content: message?.content ?? "",
            tool_calls: message?.tool_calls,
            usage: data.usage,
          },
        },
      ],
    });
    return { providerJobId, completedInline: true };
  },

  async poll(providerJobId: string): Promise<PollResult> {
    const stored = inlineResults.get(providerJobId);
    if (!stored) {
      return { status: "failed", error: "Unknown DeepSeek job" };
    }
    if (stored.status === "failed") {
      return { status: "failed", error: stored.error };
    }
    return {
      status: "succeeded",
      actualUnits: stored.actualUnits ?? 1,
    };
  },

  async collect(providerJobId: string): Promise<CollectResult> {
    const stored = inlineResults.get(providerJobId);
    if (!stored || stored.status !== "succeeded") {
      throw new Error("DeepSeek job not ready");
    }
    return { outputs: stored.outputs };
  },

  isTransientError: isDefaultTransientError,
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: unknown;
  name?: string;
};

export type ChatToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type StreamChatResult = {
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

/**
 * Streaming chat for the copilot (bypasses the generation job poller).
 * Invokes onToken for each content delta so the UI can live-update.
 */
export async function streamChat(args: {
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  onToken?: (delta: string) => Promise<void> | void;
  model?: string;
}): Promise<StreamChatResult> {
  const apiKey = convexEnv("DEEPSEEK_API_KEY");
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }

  const body: Record<string, unknown> = {
    model: args.model ?? "deepseek-chat",
    messages: args.messages,
    stream: true,
  };
  if (args.tools && args.tools.length > 0) {
    body.tools = args.tools;
  }

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek stream ${res.status}: ${text}`);
  }
  if (!res.body) {
    throw new Error("DeepSeek stream returned no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolCallParts = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  let usage: StreamChatResult["usage"];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      let parsed: {
        choices?: Array<{
          delta?: {
            content?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
        usage?: StreamChatResult["usage"];
      };
      try {
        parsed = JSON.parse(data) as typeof parsed;
      } catch {
        continue;
      }
      if (parsed.usage) usage = parsed.usage;
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        if (args.onToken) {
          await args.onToken(delta.content);
        }
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index ?? 0;
          const existing = toolCallParts.get(index) ?? {
            id: "",
            name: "",
            arguments: "",
          };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) {
            existing.arguments += tc.function.arguments;
          }
          toolCallParts.set(index, existing);
        }
      }
    }
  }

  return {
    content,
    toolCalls: [...toolCallParts.values()].filter((t) => t.name.length > 0),
    usage,
  };
}

/** Non-streaming chat used by mock fallback and tool follow-ups. */
export async function completeChat(args: {
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  /** OpenAI-style tool_choice: "auto" | "required" | { type: "function", function: { name } } */
  toolChoice?:
    | "auto"
    | "required"
    | "none"
    | { type: "function"; function: { name: string } };
  model?: string;
}): Promise<StreamChatResult> {
  const apiKey = convexEnv("DEEPSEEK_API_KEY");
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }
  const body: Record<string, unknown> = {
    model: args.model ?? "deepseek-chat",
    messages: args.messages,
    stream: false,
  };
  if (args.tools && args.tools.length > 0) {
    body.tools = args.tools;
  }
  if (args.toolChoice !== undefined) {
    body.tool_choice = args.toolChoice;
  }
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek chat ${res.status}: ${text}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
    usage?: StreamChatResult["usage"];
  };
  const message = data.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? [])
    .map((tc) => ({
      id: tc.id,
      name: tc.function?.name ?? "",
      arguments: tc.function?.arguments ?? "{}",
    }))
    .filter((t) => t.name.length > 0);
  return {
    content: message?.content ?? "",
    toolCalls,
    usage: data.usage,
  };
}
