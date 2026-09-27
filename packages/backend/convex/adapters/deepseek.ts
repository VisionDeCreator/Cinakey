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
