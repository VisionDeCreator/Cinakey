import {
  videoPrice,
  videoRate,
  applyUsageMarkup,
  supplierVideoMaximum,
} from "@dirrio/shared";
import { validateRemixInput } from "@dirrio/shared";
import type { GenerationAdapter, ProviderRequest } from "@dirrio/shared";
import { providerConfig, requireProviderKey } from "../config/env";
import { isDefaultTransientError } from "./cost";
import { ProviderError } from "./errors";
import { providerFetch } from "./transport";

async function request(path: string, body?: ProviderRequest) {
  const {
    _idempotencyKey,
    _maximumRetailUsdMicros,
    _usageMarkupBps,
    ...input
  } = body ?? {};
  void _maximumRetailUsdMicros;
  void _usageMarkupBps;
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
  job?: {
    id?: string;
    status?: string;
    usage_summary?: {
      final?: boolean;
      status?: string;
      captured_usd_cents?: number;
      captured_usd_micros?: number;
    };
  };
  result?: { artifacts?: Artifact[] };
};
export function sumeLifecycle(
  endpoint: string,
): Pick<GenerationAdapter, "submit" | "poll" | "collect" | "isTransientError"> {
  return {
    async submit(body) {
      const {
        _idempotencyKey,
        _maximumRetailUsdMicros,
        _usageMarkupBps,
        ...input
      } = body;
      void _idempotencyKey;
      const model =
        endpoint === "/v1/sume/remix-lite/object-swap/v1.0"
          ? "sume-remix-lite-object-swap"
          : "seedance-2.5";
      let supplierCostUpperBoundUsdMicros: number;
      try {
        if (
          typeof _maximumRetailUsdMicros !== "number" ||
          !Number.isSafeInteger(_maximumRetailUsdMicros) ||
          _maximumRetailUsdMicros <= 0
        )
          throw new Error("Missing accepted price");
        const response = await providerFetch(
          "sume",
          `${providerConfig().sumeBaseUrl}/v1/open/estimate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${requireProviderKey("sume")}`,
            },
            body: JSON.stringify({ model, input }),
          },
        );
        const quote = (await response.json()).data;
        if (
          !quote ||
          quote.model !== model ||
          quote.currency !== "USD" ||
          !Number.isSafeInteger(quote.usd_micros) ||
          quote.usd_micros <= 0 ||
          applyUsageMarkup(
            supplierVideoMaximum(quote.usd_micros),
            typeof _usageMarkupBps === "number" ? _usageMarkupBps : undefined,
          ) > _maximumRetailUsdMicros
        )
          throw new Error("Supplier price exceeds accepted maximum");
        supplierCostUpperBoundUsdMicros = quote.usd_micros;
      } catch {
        // This is a FREE estimate, not a generation submission; its failure is a definite no-charge outcome.
        throw new ProviderError(
          "sume",
          422,
          false,
          false,
          0,
          "Supplier price could not be verified within the accepted price. No generation was submitted; request a new quote.",
        );
      }
      const data = await request(endpoint, body);
      const id = data.job?.id ?? data.request_id;
      if (!id) throw new Error("Sume did not return a job ID");
      return { providerJobId: id, supplierCostUpperBoundUsdMicros };
    },
    async poll(id) {
      const data = await request(`/v1/jobs/${encodeURIComponent(id)}/status`);
      const status = (
        data.sume_status ??
        data.job?.status ??
        data.status ??
        ""
      ).toLowerCase();
      if (["completed", "succeeded"].includes(status)) {
        const receipt = (await request(`/v1/jobs/${encodeURIComponent(id)}`))
          .job?.usage_summary;
        const amount =
          receipt?.captured_usd_micros ??
          (typeof receipt?.captured_usd_cents === "number"
            ? receipt.captured_usd_cents * 10_000
            : undefined);
        if (
          !receipt?.final ||
          receipt.status !== "captured" ||
          amount === undefined ||
          !Number.isSafeInteger(amount) ||
          amount < 0
        )
          throw new ProviderError(
            "sume",
            503,
            true,
            false,
            0,
            "Final supplier billing is pending; reservation retained",
          );
        return { status: "succeeded", supplierActualCostUsdMicros: amount };
      }
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
const COST = {
  unit: "per_second",
  usdMicrosPerUnit: videoRate("sume-remix-lite", "720p"),
} as const;
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
  estimateCost: (input) =>
    videoPrice(
      "sume-remix-lite",
      Number(input.durationSec ?? 5),
      input.resolution,
    ),
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
