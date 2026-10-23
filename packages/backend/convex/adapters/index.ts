import type { GenerationAdapter } from "@cinakey/shared";
import {
  estimateVideoCost,
  estimateImageCost,
  estimateTokenCost,
} from "./cost";
const seedance25Adapter: Pick<
  GenerationAdapter,
  "capabilities" | "estimateCost"
> = (() => {
  const COST = { unit: "per_second", creditsPerUnit: 2 } as const;
  return {
    capabilities: {
      id: "seedance-2.5",
      kind: "video",
      operations: ["text-to-video", "image-to-video", "upscale", "extend"],
      inputs: [
        "text",
        "startFrame",
        "endFrame",
        "referenceImages",
        "referenceVideo",
        "audio",
      ],
      durations: [5, 10, 15, 20, 30],
      minDurationSec: 4,
      maxDurationSec: 30,
      maxReferenceImages: 30,
      resolutions: ["720p", "1080p"],
      aspectRatios: ["16:9", "9:16", "1:1"],
      features: ["cameraControl", "upscale", "extend"],
      costModel: COST,
    },
    estimateCost(input) {
      return estimateVideoCost(input, COST);
    },
  };
})();
const gptImage2Adapter: Pick<
  GenerationAdapter,
  "capabilities" | "estimateCost"
> = (() => {
  const COST = { unit: "per_image", creditsPerUnit: 10 } as const;
  return {
    capabilities: {
      id: "gpt-image-2",
      kind: "image",
      operations: ["text-to-image", "image-edit"],
      inputs: ["text", "referenceImages"],
      resolutions: ["1024x1024", "1536x1024", "1024x1536"],
      aspectRatios: ["1:1", "16:9", "9:16"],
      features: ["edit", "inpaint"],
      costModel: COST,
    },
    estimateCost(input) {
      return estimateImageCost(input, COST);
    },
  };
})();
const deepseekAdapter: Pick<
  GenerationAdapter,
  "capabilities" | "estimateCost"
> = (() => {
  const COST = { unit: "per_1k_tokens", creditsPerUnit: 1 } as const;
  return {
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
  };
})();
const adapters = [seedance25Adapter, gptImage2Adapter, deepseekAdapter];
export function listAdapters() {
  return adapters;
}
export function getAdapter(id: string) {
  return adapters.find((a) => a.capabilities.id === id);
}
