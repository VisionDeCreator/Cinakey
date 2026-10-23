import type {
  BuildRequestInput,
  CollectResult,
  GenerationAdapter,
  PollResult,
  ProviderRequest,
  SubmitResult,
} from "@cinakey/shared";
import { validateVideoInput } from "@cinakey/shared";
import { requireProviderKey, providerConfig } from "../config/env";
import { providerFetch } from "./transport";
import { estimateVideoCost, isDefaultTransientError } from "./cost";

const COST = { unit: "per_second", creditsPerUnit: 2 } as const;

/**
 * Ark Seedance 2.5: documented task API, image/video references and first/last frames.
 * See docs/provider-contract.md for sources and deliberately disabled operations.
 */
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

  estimateCost(input) {
    return estimateVideoCost(input, COST);
  },

  async buildRequest(input: BuildRequestInput): Promise<ProviderRequest> {
    validateVideoInput(input);
    const kind = input.kind ?? "text-to-video";
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: input.prompt ?? "" },
    ];
    if (input.startFrameUrl)
      content.push({
        type: "image_url",
        image_url: { url: input.startFrameUrl },
        role: "first_frame",
      });
    if (input.endFrameUrl)
      content.push({
        type: "image_url",
        image_url: { url: input.endFrameUrl },
        role: "last_frame",
      });
    for (const url of input.referenceImageUrls ?? [])
      content.push({
        type: "image_url",
        image_url: { url },
        role: "reference_image",
      });
    if (input.referenceVideoUrl)
      content.push({
        type: "video_url",
        video_url: { url: input.referenceVideoUrl },
        role: "reference_video",
      });
    return {
      model: providerConfig().seedanceModel,
      content,
      duration: input.durationSec ?? 5,
      resolution: input.resolution ?? "720p",
      ratio:
        input.startFrameUrl || kind === "extend"
          ? "adaptive"
          : (input.aspectRatio ?? "16:9"),
      ...(input.seed === undefined ? {} : { seed: input.seed }),
      ...(kind === "extend"
        ? { omni_reference_task_type: "extend" }
        : input.referenceVideoUrl || input.referenceImageUrls?.length
          ? { omni_reference_task_type: "reference" }
          : {}),
    };
  },

  async submit(request: ProviderRequest): Promise<SubmitResult> {
    const res = await providerFetch(
      "seedance",
      `${providerConfig().seedanceBaseUrl}/contents/generations/tasks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireProviderKey("seedance")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
    );
    const data = (await res.json()) as { id?: unknown };
    if (typeof data.id !== "string" || !data.id)
      throw new Error("Seedance submit response missing task id");
    return { providerJobId: data.id };
  },

  async poll(providerJobId: string): Promise<PollResult> {
    const apiKey = requireProviderKey("seedance");
    const baseUrl = providerConfig().seedanceBaseUrl;

    const res = await providerFetch(
      "seedance",
      `${baseUrl}/contents/generations/tasks/${encodeURIComponent(providerJobId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );

    const data = (await res.json()) as {
      status?: string;
      error?: { message?: string };
      duration?: number;
    };

    const raw = (data.status ?? "").toLowerCase();
    if (
      raw === "succeeded" ||
      raw === "success" ||
      raw === "completed" ||
      raw === "done"
    ) {
      return {
        status: "succeeded",
        actualUnits:
          typeof data.duration === "number" ? data.duration : undefined,
      };
    }
    if (
      raw === "failed" ||
      raw === "error" ||
      raw === "cancelled" ||
      raw === "canceled" ||
      raw === "expired"
    ) {
      return {
        status: "failed",
        error: "Seedance generation failed",
      };
    }
    if (raw === "queued" || raw === "pending") {
      return { status: "queued" };
    }
    if (raw === "running") return { status: "running" };
    throw new Error("Seedance returned an unrecognized task status");
  },

  async collect(providerJobId: string): Promise<CollectResult> {
    const apiKey = requireProviderKey("seedance");
    const baseUrl = providerConfig().seedanceBaseUrl;

    const res = await providerFetch(
      "seedance",
      `${baseUrl}/contents/generations/tasks/${encodeURIComponent(providerJobId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );

    const data = (await res.json()) as {
      content?: { video_url?: string };
      duration?: number;
      resolution?: string;
      ratio?: string;
    };
    const url = data.content?.video_url;
    if (!url) {
      throw new Error("Seedance collect: no video URL in response");
    }
    return {
      outputs: [
        {
          type: "video",
          url,
          contentType: "video/mp4",
          metadata: {
            durationSec: data.duration,
            resolution: data.resolution,
            aspectRatio: data.ratio,
          },
        },
      ],
    };
  },

  isTransientError: isDefaultTransientError,
};
