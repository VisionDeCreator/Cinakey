import {
  videoPrice,
  videoRate,
  TOKEN_USD_MICROS_PER_1K,
} from "@cinakey/shared";
import type { GenerationAdapter } from "@cinakey/shared";
import { estimateTokenCost } from "./cost";
const seedance25Adapter: Pick<
  GenerationAdapter,
  "capabilities" | "estimateCost"
> = (() => {
  const COST = {
    unit: "per_second",
    usdMicrosPerUnit: videoRate("seedance-2.5", "720p"),
  } as const;
  return {
    capabilities: {
      id: "seedance-2.5",
      kind: "video",
      operations: ["text-to-video", "image-to-video", "extend"],
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
      features: ["extend"],
      costModel: COST,
    },
    estimateCost(input) {
      return videoPrice(
        "seedance-2.5",
        Number(input.durationSec ?? 5),
        input.resolution,
      );
    },
  };
})();
const deepseekAdapter: Pick<
  GenerationAdapter,
  "capabilities" | "estimateCost"
> = (() => {
  const COST = {
    unit: "per_1k_tokens",
    usdMicrosPerUnit: TOKEN_USD_MICROS_PER_1K,
  } as const;
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
const remixLiteAdapter: typeof seedance25Adapter = {
  capabilities: {
    ...seedance25Adapter.capabilities,
    id: "sume-remix-lite",
    costModel: {
      unit: "per_second",
      usdMicrosPerUnit: videoRate("sume-remix-lite", "720p"),
    },
    operations: ["text-to-video"],
    inputs: ["text", "referenceImages", "referenceVideo"],
    durations: [5, 10, 15],
    maxDurationSec: 15,
    maxReferenceImages: 8,
    features: ["edit"],
  },
  estimateCost: (input) =>
    videoPrice(
      "sume-remix-lite",
      Number(input.durationSec ?? 5),
      input.resolution,
    ),
};
const adapters = [seedance25Adapter, remixLiteAdapter, deepseekAdapter];
export function listAdapters() {
  return adapters;
}
export function getAdapter(id: string) {
  return adapters.find((a) => a.capabilities.id === id);
}
