/**
 * Model adapter types.
 *
 * Adapters declare capabilities and implement a uniform generation lifecycle.
 * Provider HTTP runs only inside Convex actions (never in the web app).
 */

export type ModelKind = "video" | "image" | "llm";

export type ModelInput =
  | "text"
  | "startFrame"
  | "endFrame"
  | "referenceImages"
  | "audio";

export type ModelFeature =
  | "cameraControl"
  | "upscale"
  | "extend"
  | "inpaint"
  | "edit"
  | "chat";

/** Adapter operation ids shown in the UI and stored on generationJobs.kind. */
export type ModelOperation =
  | "text-to-image"
  | "image-edit"
  | "text-to-video"
  | "image-to-video"
  | "upscale"
  | "extend"
  | "chat";

export type CostModel = {
  /** Human-readable unit, e.g. "per_second", "per_image", "per_1k_tokens". */
  unit: string;
  /** Credits charged per unit. */
  creditsPerUnit: number;
};

export type ModelCapabilities = {
  id: string;
  kind: ModelKind;
  /** Operations this adapter supports (UI shows only these). */
  operations: ModelOperation[];
  inputs: ModelInput[];
  durations?: number[];
  /** Max seconds per generation run (sequence splitting). */
  maxDurationSec?: number;
  /** Max reference images per run (sequence splitting). */
  maxReferenceImages?: number;
  resolutions?: string[];
  aspectRatios?: string[];
  features: ModelFeature[];
  costModel: CostModel;
};

export type BuildRequestInput = {
  prompt?: string;
  kind?: ModelOperation | string;
  shot?: Record<string, unknown>;
  entities?: Record<string, unknown>[];
  style?: Record<string, unknown>;
  durationSec?: number;
  resolution?: string;
  aspectRatio?: string;
  seed?: number;
  /** Reference / start / end frame URLs or storage ids (adapter-specific). */
  startFrameUrl?: string;
  endFrameUrl?: string;
  referenceImageUrls?: string[];
  maskUrl?: string;
  /** Mock / test: force a failure for refund path. */
  forceFail?: boolean;
  /** Estimated token count for LLM cost. */
  estimatedTokens?: number;
  [key: string]: unknown;
};

export type ProviderRequest = Record<string, unknown>;

export type SubmitResult = {
  providerJobId: string;
  /** When the provider completes synchronously, skip poll. */
  completedInline?: boolean;
};

export type PollResult = {
  status: "queued" | "running" | "succeeded" | "failed";
  error?: string;
  /** Provider-reported cost units (seconds, images, tokens) for settle. */
  actualUnits?: number;
};

export type CollectResult = {
  outputs: Array<{
    type: "image" | "video" | "audio" | "json" | "text" | string;
    url?: string;
    /** Inline bytes as base64 (mock / sync providers). */
    base64?: string;
    contentType?: string;
    storageId?: string;
    metadata?: Record<string, unknown>;
  }>;
};

export interface GenerationAdapter {
  capabilities: ModelCapabilities;
  estimateCost(input: BuildRequestInput): number;
  buildRequest(input: BuildRequestInput): ProviderRequest | Promise<ProviderRequest>;
  submit(request: ProviderRequest): Promise<SubmitResult>;
  poll(providerJobId: string): Promise<PollResult>;
  collect(providerJobId: string): Promise<CollectResult>;
  /** Optional: classify errors as retryable (default: 5xx / network). */
  isTransientError?(err: unknown): boolean;
  /** Optional: verify provider webhook signature. */
  verifyWebhook?(
    headers: Record<string, string>,
    body: string,
  ): boolean | Promise<boolean>;
}
