import type {
  BuildRequestInput,
  CollectResult,
  GenerationAdapter,
  PollResult,
  ProviderRequest,
  SubmitResult,
} from "@cinakey/shared";
import { requireProviderKey } from "../config/env";
import { providerFetch } from "./transport";
import { estimateTokenCost, isDefaultTransientError } from "./cost";

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
 * Completes synchronously inside the API.
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
    const messages = (input.messages as
      Array<{ role: string; content: string }> | undefined) ?? [
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
    const apiKey = requireProviderKey("deepseek");
    const providerJobId = `deepseek_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const body: Record<string, unknown> = {
      model: request.model ?? "deepseek-chat",
      messages: request.messages,
      stream: false,
    };
    if (request.tools) {
      body.tools = request.tools;
    }

    const res = await providerFetch(
      "deepseek",
      "https://api.deepseek.com/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

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
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

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
  /** Force a single JSON object reply. */
  json?: boolean;
  maxTokens?: number;
}): Promise<StreamChatResult> {
  const apiKey = requireProviderKey("deepseek");
  const body: Record<string, unknown> = {
    model: args.model ?? "deepseek-chat",
    messages: args.messages,
    stream: false,
  };
  if (args.json) body.response_format = { type: "json_object" };
  if (args.maxTokens) body.max_tokens = args.maxTokens;
  if (args.tools && args.tools.length > 0) {
    body.tools = args.tools;
  }
  if (args.toolChoice !== undefined) {
    body.tool_choice = args.toolChoice;
  }
  const res = await providerFetch(
    "deepseek",
    "https://api.deepseek.com/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
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
