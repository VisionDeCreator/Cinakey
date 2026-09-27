/**
 * Model adapter types.
 *
 * Adapters declare capabilities and implement a uniform generation lifecycle.
 * No provider HTTP calls live here — stubs only for Phase 1.
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

export type CostModel = {
  /** Human-readable unit, e.g. "per_second", "per_image", "per_1k_tokens". */
  unit: string;
  /** Credits charged per unit (placeholder until credits land). */
  creditsPerUnit: number;
};

export type ModelCapabilities = {
  id: string;
  kind: ModelKind;
  inputs: ModelInput[];
  durations?: number[];
  resolutions?: string[];
  aspectRatios?: string[];
  features: ModelFeature[];
  costModel: CostModel;
};

export type BuildRequestInput = {
  prompt?: string;
  shot?: Record<string, unknown>;
  entities?: Record<string, unknown>[];
  style?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ProviderRequest = Record<string, unknown>;

export type SubmitResult = {
  providerJobId: string;
};

export type PollResult = {
  status: "queued" | "running" | "succeeded" | "failed";
  error?: string;
};

export type CollectResult = {
  outputs: Array<{
    type: string;
    url?: string;
    storageId?: string;
    metadata?: Record<string, unknown>;
  }>;
};

export interface GenerationAdapter {
  capabilities: ModelCapabilities;
  buildRequest(input: BuildRequestInput): ProviderRequest | Promise<ProviderRequest>;
  submit(request: ProviderRequest): Promise<SubmitResult>;
  poll(providerJobId: string): Promise<PollResult>;
  collect(providerJobId: string): Promise<CollectResult>;
}
