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
  estimateVideoCost,
  isDefaultTransientError,
} from "./cost";

const COST = { unit: "per_second", creditsPerUnit: 2 } as const;

/**
 * Seedance 2.5 — ByteDance base API for video, upscale, extend.
 *
 * Many endpoint/field names below are assumptions — search for TODO(seedance-api).
 */
export const seedance25Adapter: GenerationAdapter = {
  capabilities: {
    id: "seedance-2.5",
    kind: "video",
    operations: ["text-to-video", "image-to-video", "upscale", "extend"],
    inputs: ["text", "startFrame", "endFrame", "referenceImages", "audio"],
    durations: [5, 10, 15, 20, 30],
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

  async buildRequest(input: BuildRequestInput): Promise<ProviderRequest> {
    const kind = input.kind ?? "text-to-video";
    return {
      kind,
      prompt: input.prompt ?? "",
      durationSec: input.durationSec ?? 5,
      resolution: input.resolution ?? "720p",
      aspectRatio: input.aspectRatio ?? "16:9",
      seed: input.seed,
      startFrameUrl: input.startFrameUrl,
      endFrameUrl: input.endFrameUrl,
      referenceImageUrls: input.referenceImageUrls ?? [],
      // TODO(seedance-api): confirm camera_control / cameraPreset field name.
      cameraPreset: input.cameraPreset,
      // TODO(seedance-api): assumption — model name string for base Seedance 2.5.
      model: "seedance-2.5",
    };
  },

  async submit(request: ProviderRequest): Promise<SubmitResult> {
    const apiKey = convexEnv("SEEDANCE_API_KEY");
    if (!apiKey) {
      throw new Error("SEEDANCE_API_KEY is not set");
    }

    // TODO(seedance-api): confirm base URL. Assumption: ByteDance Ark / content generation host.
    const baseUrl =
      convexEnv("SEEDANCE_API_BASE_URL") ??
      "https://ark.cn-beijing.volces.com/api/v3";

    const kind = String(request.kind ?? "text-to-video");

    // TODO(seedance-api): confirm create-task path and body schema per operation.
    // Assumption: POST {baseUrl}/contents/generations/tasks with model + content.
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: String(request.prompt ?? "") },
    ];
    if (kind === "image-to-video" || kind === "extend") {
      if (typeof request.startFrameUrl === "string" && request.startFrameUrl) {
        // TODO(seedance-api): assumption — image_url content part for start frame.
        content.push({
          type: "image_url",
          image_url: { url: request.startFrameUrl },
          role: "first_frame",
        });
      }
      if (typeof request.endFrameUrl === "string" && request.endFrameUrl) {
        content.push({
          type: "image_url",
          image_url: { url: request.endFrameUrl },
          role: "last_frame",
        });
      }
    }
    const refs = (request.referenceImageUrls as string[] | undefined) ?? [];
    for (const url of refs) {
      content.push({
        type: "image_url",
        image_url: { url },
        role: "reference",
      });
    }

    let endpoint = `${baseUrl}/contents/generations/tasks`;
    // TODO(seedance-api): confirm whether upscale/extend use distinct endpoints.
    if (kind === "upscale") {
      endpoint = `${baseUrl}/contents/generations/tasks`; // assumption: same with different model/params
    }

    const body: Record<string, unknown> = {
      model: request.model,
      content,
      // TODO(seedance-api): confirm duration / resolution / ratio field names.
      duration: request.durationSec,
      resolution: request.resolution,
      ratio: request.aspectRatio,
    };
    if (typeof request.cameraPreset === "string" && request.cameraPreset) {
      // TODO(seedance-api): confirm camera control payload shape.
      body.camera_control = { preset: request.cameraPreset };
    }
    if (kind === "upscale") {
      body.operation = "upscale";
    }
    if (kind === "extend") {
      body.operation = "extend";
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Seedance submit ${res.status}: ${text}`);
    }
    const data = (await res.json()) as { id?: string; task_id?: string };
    // TODO(seedance-api): confirm response id field (id vs task_id).
    const providerJobId = data.id ?? data.task_id;
    if (!providerJobId) {
      throw new Error("Seedance submit response missing task id");
    }
    return { providerJobId };
  },

  async poll(providerJobId: string): Promise<PollResult> {
    const apiKey = convexEnv("SEEDANCE_API_KEY");
    if (!apiKey) {
      throw new Error("SEEDANCE_API_KEY is not set");
    }
    const baseUrl =
      convexEnv("SEEDANCE_API_BASE_URL") ??
      "https://ark.cn-beijing.volces.com/api/v3";

    // TODO(seedance-api): confirm poll path and status enum values.
    const res = await fetch(
      `${baseUrl}/contents/generations/tasks/${providerJobId}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Seedance poll ${res.status}: ${text}`);
    }
    const data = (await res.json()) as {
      status?: string;
      error?: { message?: string };
      // TODO(seedance-api): where duration used is reported for billing.
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
        actualUnits: typeof data.duration === "number" ? data.duration : undefined,
      };
    }
    if (
      raw === "failed" ||
      raw === "error" ||
      raw === "cancelled" ||
      raw === "canceled"
    ) {
      return {
        status: "failed",
        error: data.error?.message ?? `Seedance status: ${data.status}`,
      };
    }
    if (raw === "queued" || raw === "pending") {
      return { status: "queued" };
    }
    return { status: "running" };
  },

  async collect(providerJobId: string): Promise<CollectResult> {
    const apiKey = convexEnv("SEEDANCE_API_KEY");
    if (!apiKey) {
      throw new Error("SEEDANCE_API_KEY is not set");
    }
    const baseUrl =
      convexEnv("SEEDANCE_API_BASE_URL") ??
      "https://ark.cn-beijing.volces.com/api/v3";

    const res = await fetch(
      `${baseUrl}/contents/generations/tasks/${providerJobId}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Seedance collect ${res.status}: ${text}`);
    }
    const data = (await res.json()) as {
      // TODO(seedance-api): confirm output URL field path.
      content?: { video_url?: string };
      output?: { url?: string };
      video_url?: string;
    };
    const url =
      data.content?.video_url ?? data.output?.url ?? data.video_url;
    if (!url) {
      throw new Error("Seedance collect: no video URL in response");
    }
    return {
      outputs: [{ type: "video", url, contentType: "video/mp4" }],
    };
  },

  isTransientError: isDefaultTransientError,

  async verifyWebhook(
    headers: Record<string, string>,
    _body: string,
  ): Promise<boolean> {
    // TODO(seedance-api): confirm webhook signature scheme.
    // Assumption: shared GENERATION_WEBHOOK_SECRET HMAC verified by HTTP route;
    // provider-specific header left for later.
    void headers;
    return true;
  },
};
