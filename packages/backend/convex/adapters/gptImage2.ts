import type {
  BuildRequestInput,
  CollectResult,
  GenerationAdapter,
  PollResult,
  ProviderRequest,
  SubmitResult,
} from "@cinakey/shared";
import { convexEnv } from "../lib/env";
import { estimateImageCost, isDefaultTransientError } from "./cost";

const COST = { unit: "per_image", creditsPerUnit: 10 } as const;

/** In-memory store for sync OpenAI responses (providerJobId → result). */
const inlineResults = new Map<
  string,
  {
    status: PollResult["status"];
    outputs: CollectResult["outputs"];
    error?: string;
    actualUnits?: number;
  }
>();

function requireApiKey(): string {
  const key = convexEnv("OPENAI_API_KEY");
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return key;
}

/**
 * GPT Image 2 — text-to-image and image edit via OpenAI Images API.
 *
 * TODO(openai-api): confirm exact model id — assuming "gpt-image-1" until
 * GPT Image 2 is publicly named; change modelVersion when confirmed.
 */
export const gptImage2Adapter: GenerationAdapter = {
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

  async buildRequest(input: BuildRequestInput): Promise<ProviderRequest> {
    const kind = input.kind ?? "text-to-image";
    const size = input.resolution ?? "1024x1024";
    return {
      kind,
      prompt: input.prompt ?? "",
      size,
      seed: input.seed,
      // TODO(openai-api): confirm edit/mask field names for Images API.
      referenceImageUrls: input.referenceImageUrls ?? [],
      maskUrl: input.maskUrl,
      model: "gpt-image-1",
    };
  },

  async submit(request: ProviderRequest): Promise<SubmitResult> {
    const apiKey = requireApiKey();
    const kind = String(request.kind ?? "text-to-image");
    const providerJobId = `openai_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      if (kind === "image-edit") {
        // TODO(openai-api): confirm multipart edit endpoint + mask parameter names.
        // Assumption: POST https://api.openai.com/v1/images/edits with prompt + image(s).
        const form = new FormData();
        form.append("model", String(request.model ?? "gpt-image-1"));
        form.append("prompt", String(request.prompt ?? ""));
        const refs = (request.referenceImageUrls as string[] | undefined) ?? [];
        if (refs.length === 0) {
          throw new Error("image-edit requires at least one reference image URL");
        }
        const imgRes = await fetch(refs[0]!);
        if (!imgRes.ok) {
          throw new Error(`Failed to fetch reference image: ${imgRes.status}`);
        }
        const imgBlob = await imgRes.blob();
        form.append("image", imgBlob, "reference.png");
        if (typeof request.maskUrl === "string" && request.maskUrl) {
          const maskRes = await fetch(request.maskUrl);
          if (!maskRes.ok) {
            throw new Error(`Failed to fetch mask: ${maskRes.status}`);
          }
          form.append("mask", await maskRes.blob(), "mask.png");
        }
        form.append("size", String(request.size ?? "1024x1024"));

        const res = await fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`OpenAI images/edits ${res.status}: ${body}`);
        }
        const data = (await res.json()) as {
          data?: Array<{ b64_json?: string; url?: string }>;
        };
        const first = data.data?.[0];
        inlineResults.set(providerJobId, {
          status: "succeeded",
          actualUnits: 1,
          outputs: [
            {
              type: "image",
              base64: first?.b64_json,
              url: first?.url,
              contentType: "image/png",
            },
          ],
        });
        return { providerJobId, completedInline: true };
      }

      // text-to-image
      // gpt-image-1 does not use DALL·E's response_format; return url or b64_json.
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model ?? "gpt-image-1",
          prompt: request.prompt,
          size: request.size ?? "1024x1024",
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI images/generations ${res.status}: ${body}`);
      }
      const data = (await res.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const first = data.data?.[0];
      if (!first?.b64_json && !first?.url) {
        throw new Error("OpenAI returned no image data");
      }
      inlineResults.set(providerJobId, {
        status: "succeeded",
        actualUnits: 1,
        outputs: [
          {
            type: "image",
            base64: first.b64_json,
            url: first.url,
            contentType: "image/png",
          },
        ],
      });
      return { providerJobId, completedInline: true };
    } catch (err) {
      inlineResults.set(providerJobId, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        outputs: [],
      });
      throw err;
    }
  },

  async poll(providerJobId: string): Promise<PollResult> {
    const stored = inlineResults.get(providerJobId);
    if (!stored) {
      return { status: "failed", error: "Unknown OpenAI image job" };
    }
    if (stored.status === "failed") {
      return { status: "failed", error: stored.error };
    }
    return { status: "succeeded", actualUnits: stored.actualUnits ?? 1 };
  },

  async collect(providerJobId: string): Promise<CollectResult> {
    const stored = inlineResults.get(providerJobId);
    if (!stored || stored.status !== "succeeded") {
      throw new Error("OpenAI image job not ready");
    }
    return { outputs: stored.outputs };
  },

  isTransientError: isDefaultTransientError,
};
