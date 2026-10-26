import { validateRemixInput } from "@cinakey/shared";
import type { GenerationAdapter, ProviderRequest } from "@cinakey/shared";
import { providerConfig, requireProviderKey } from "../config/env";
import { estimateVideoCost, isDefaultTransientError } from "./cost";
import { providerFetch } from "./transport";

async function request(path: string, body?: ProviderRequest) {
  const { _idempotencyKey, ...input } = body ?? {};
  const response = await providerFetch(
    "sume",
    `${providerConfig().sumeBaseUrl}${path}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${requireProviderKey("sume")}`,
        ...(body
          ? {
              "Content-Type": "application/json",
              "Idempotency-Key": String(_idempotencyKey ?? crypto.randomUUID()),
            }
          : {}),
      },
      ...(body ? { body: JSON.stringify(input) } : {}),
    },
  );
  const envelope = (await response.json()) as { data?: SumeData };
  if (!envelope.data) throw new Error("Sume returned an invalid response");
  return envelope.data;
}
type Artifact = { type?: string; url?: string; content_type?: string };
type SumeData = {
  request_id?: string;
  sume_status?: string;
  status?: string;
  job?: { id?: string; status?: string };
  result?: { artifacts?: Artifact[] };
};
export function sumeLifecycle(
  endpoint: string,
): Pick<GenerationAdapter, "submit" | "poll" | "collect" | "isTransientError"> {
  return {
    async submit(body) {
      const data = await request(endpoint, body);
      const id = data.job?.id ?? data.request_id;
      if (!id) throw new Error("Sume did not return a job ID");
      return { providerJobId: id };
    },
    async poll(id) {
      const data = await request(`/v1/jobs/${encodeURIComponent(id)}/status`);
      const status = (
        data.sume_status ??
        data.job?.status ??
        data.status ??
        ""
      ).toLowerCase();
      if (["completed", "succeeded"].includes(status))
        return { status: "succeeded" };
      if (["failed", "canceled", "cancelled", "expired"].includes(status))
        return { status: "failed", error: "Sume video generation failed" };
      if (["queued", "pending"].includes(status)) return { status: "queued" };
      if (["processing", "running", "in_progress"].includes(status))
        return { status: "running" };
      throw new Error("Sume returned an unrecognized job status");
    },
    async collect(id) {
      const data = await request(`/v1/jobs/${encodeURIComponent(id)}/result`);
      const videos = data.result?.artifacts?.filter(
        (a) => a.type === "video" && a.url,
      );
      if (!videos?.length) throw new Error("Sume result contains no video");
      return {
        outputs: videos.map((a) => ({
          type: "video",
          url: a.url,
          contentType: a.content_type ?? "video/mp4",
        })),
      };
    },
    isTransientError: isDefaultTransientError,
  };
}
const COST = { unit: "per_second", creditsPerUnit: 2 } as const;
export const remixLiteAdapter: GenerationAdapter = {
  capabilities: {
    id: "sume-remix-lite",
    kind: "video",
    operations: ["text-to-video"],
    inputs: ["text", "referenceImages", "referenceVideo"],
    durations: [5, 10, 15],
    minDurationSec: 4,
    maxDurationSec: 15,
    maxReferenceImages: 8,
    resolutions: ["720p", "1080p"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    features: ["edit"],
    costModel: COST,
  },
  estimateCost: (input) => estimateVideoCost(input, COST),
  async buildRequest(input) {
    validateRemixInput(input);
    const duration = input.durationSec;
    return {
      video_url: input.referenceVideoUrl,
      image_urls: input.referenceImageUrls,
      prompt: input.prompt ?? "",
      duration,
      resolution: input.resolution ?? "720p",
    };
  },
  ...sumeLifecycle("/v1/sume/remix-lite/object-swap/v1.0"),
};
