import {
  TOKEN_USD_MICROS_PER_1K,
  DEEPSEEK_MODEL,
  tokenUsagePrice,
  normalizeTokenUsage,
  verifiedDeepseekPeriod,
  type TokenUsageBatch,
} from "@dirrio/shared";
import type {
  BuildRequestInput,
  GenerationAdapter,
  ProviderRequest,
} from "@dirrio/shared";
import { requireProviderKey } from "../config/env";
import { providerFetch } from "./transport";
import { estimateTokenCost, isDefaultTransientError } from "./cost";

const COST = {
  unit: "per_1k_tokens",
  usdMicrosPerUnit: TOKEN_USD_MICROS_PER_1K,
} as const;

/** Text estimates are exposed here; paid text execution uses metered textJobs + completeChat. */
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
      model: DEEPSEEK_MODEL,
      messages,
      // OpenAI-compatible tools array if provided.
      tools: input.tools,
      estimatedTokens: input.estimatedTokens ?? 1000,
    };
  },

  async submit() {
    throw new Error("Use the metered textJobs flow for DeepSeek requests");
  },
  async poll() {
    throw new Error(
      "DeepSeek text jobs are settled synchronously from reported usage",
    );
  },
  async collect() {
    throw new Error(
      "DeepSeek text jobs are settled synchronously from reported usage",
    );
  },

  isTransientError: isDefaultTransientError,
};

export type ChatContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail?: "low" | "high" | "auto" };
    };

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ChatContentPart[] | null;
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
  billingBatch?: TokenUsageBatch;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
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
  /** Remaining reserved retail budget, checked before every paid request. */
  maxCostUsdMicros: number;
}): Promise<StreamChatResult> {
  const apiKey = requireProviderKey("deepseek");
  if (args.model && args.model !== DEEPSEEK_MODEL)
    throw new Error("Unpriced analysis model");
  const maxTokens = args.maxTokens ?? 2000;
  if (
    !Number.isSafeInteger(args.maxCostUsdMicros) ||
    args.maxCostUsdMicros < 0 ||
    chatRequestMaximum(args.messages, maxTokens, args.tools) >
      args.maxCostUsdMicros
  )
    throw new Error(
      "Remaining analysis budget cannot cover another model call",
    );
  const body: Record<string, unknown> = {
    model: args.model ?? DEEPSEEK_MODEL,
    thinking: { type: "disabled" },
    max_tokens: maxTokens,
    messages: args.messages,
    stream: false,
  };
  if (args.json) body.response_format = { type: "json_object" };

  if (args.tools && args.tools.length > 0) {
    body.tools = args.tools;
  }
  if (args.toolChoice !== undefined) {
    body.tool_choice = args.toolChoice;
  }
  const requestStartedAt = Date.now();
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
    created?: number;
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
  const usage = normalizeTokenUsage(data.usage);
  const providerCreatedAt =
    typeof data.created === "number" && Number.isSafeInteger(data.created)
      ? data.created * 1000
      : NaN;
  const period = verifiedDeepseekPeriod(
    requestStartedAt,
    Date.now(),
    providerCreatedAt,
  );
  const billingBatch: TokenUsageBatch | undefined =
    usage && period ? { ...usage, period, providerCreatedAt } : undefined;
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
    billingBatch,
  };
}

/** UTF-8 byte bound for text plus the documented <=1024 tokens per image; output includes all generated tokens. */
export function chatRequestMaximum(
  messages: ChatMessage[],
  maxOutputTokens: number,
  tools?: ChatToolDefinition[],
): number {
  if (
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 1 ||
    maxOutputTokens > 8000
  )
    throw new Error("Invalid model output limit");
  let images = 0;
  const text = JSON.stringify(messages, (key, value) => {
    if (key === "image_url") {
      images++;
      return "[image]";
    }
    return value;
  });
  return tokenUsagePrice({
    inputTokens:
      new TextEncoder().encode(text + JSON.stringify(tools ?? [])).length +
      1024 +
      messages.length * 256 +
      images * 1024,
    cachedInputTokens: 0,
    outputTokens: maxOutputTokens,
  });
}
