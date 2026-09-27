import type { GenerationAdapter } from "@cinakey/shared";

/**
 * Seedance 2.5 (ByteDance) — video generation stub.
 * Provider calls will be implemented in a later phase.
 */
export const seedance25Adapter: GenerationAdapter = {
  capabilities: {
    id: "seedance-2.5",
    kind: "video",
    inputs: ["text", "startFrame", "endFrame", "referenceImages", "audio"],
    durations: [5, 10],
    resolutions: ["720p", "1080p"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    features: ["cameraControl", "upscale", "extend"],
    costModel: { unit: "per_second", creditsPerUnit: 0 },
  },
  async buildRequest() {
    throw new Error("seedance-2.5 adapter is not implemented yet");
  },
  async submit() {
    throw new Error("seedance-2.5 adapter is not implemented yet");
  },
  async poll() {
    throw new Error("seedance-2.5 adapter is not implemented yet");
  },
  async collect() {
    throw new Error("seedance-2.5 adapter is not implemented yet");
  },
};
