import type { GenerationAdapter } from "@cinakey/shared";

/**
 * DeepSeek — copilot LLM stub.
 * Provider calls will be implemented in a later phase.
 */
export const deepseekAdapter: GenerationAdapter = {
  capabilities: {
    id: "deepseek",
    kind: "llm",
    inputs: ["text"],
    features: ["chat"],
    costModel: { unit: "per_1k_tokens", creditsPerUnit: 0 },
  },
  async buildRequest() {
    throw new Error("deepseek adapter is not implemented yet");
  },
  async submit() {
    throw new Error("deepseek adapter is not implemented yet");
  },
  async poll() {
    throw new Error("deepseek adapter is not implemented yet");
  },
  async collect() {
    throw new Error("deepseek adapter is not implemented yet");
  },
};
