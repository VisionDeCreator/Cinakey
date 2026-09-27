import type { GenerationAdapter } from "@cinakey/shared";

/**
 * GPT Image 2 — image generation stub.
 * Provider calls will be implemented in a later phase.
 */
export const gptImage2Adapter: GenerationAdapter = {
  capabilities: {
    id: "gpt-image-2",
    kind: "image",
    inputs: ["text", "referenceImages"],
    resolutions: ["1024x1024", "1536x1024", "1024x1536"],
    aspectRatios: ["1:1", "16:9", "9:16"],
    features: ["edit", "inpaint"],
    costModel: { unit: "per_image", creditsPerUnit: 0 },
  },
  async buildRequest() {
    throw new Error("gpt-image-2 adapter is not implemented yet");
  },
  async submit() {
    throw new Error("gpt-image-2 adapter is not implemented yet");
  },
  async poll() {
    throw new Error("gpt-image-2 adapter is not implemented yet");
  },
  async collect() {
    throw new Error("gpt-image-2 adapter is not implemented yet");
  },
};
