import { videoPrice } from "@cinakey/shared";
import type { GenerationAdapter } from "@cinakey/shared";
import { validateVideoInput } from "@cinakey/shared";
import { sumeLifecycle } from "./sume";
const COST = { unit: "per_second", usdMicrosPerUnit: 340_000 } as const;
export const seedance25Adapter: GenerationAdapter = {
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
  estimateCost: (input) =>
    videoPrice(
      "seedance-2.5",
      Number(input.durationSec ?? 5),
      input.resolution,
    ),
  async buildRequest(input) {
    validateVideoInput(input);
    return {
      model: "seedance-2.5",
      prompt: input.prompt ?? "",
      duration: input.durationSec ?? 5,
      resolution: input.resolution ?? "720p",
      aspect_ratio:
        input.startFrameUrl || input.kind === "extend"
          ? "adaptive"
          : (input.aspectRatio ?? "16:9"),
      generate_audio: true,
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(input.startFrameUrl ? { image_url: input.startFrameUrl } : {}),
      ...(input.endFrameUrl ? { end_image_url: input.endFrameUrl } : {}),
      ...(input.referenceImageUrls?.length
        ? { reference_image_urls: input.referenceImageUrls }
        : {}),
      ...(input.referenceVideoUrl
        ? input.kind === "extend"
          ? { video_url: input.referenceVideoUrl, extend: true }
          : { reference_video_urls: [input.referenceVideoUrl] }
        : {}),
    };
  },
  ...sumeLifecycle("/v1/video-router/generate"),
};
