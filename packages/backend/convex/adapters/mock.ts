import type {
  BuildRequestInput,
  CollectResult,
  GenerationAdapter,
  PollResult,
  ProviderRequest,
  SubmitResult,
} from "@cinakey/shared";
import { estimateImageCost, estimateTokenCost, estimateVideoCost } from "./cost";
import { SAMPLE_MP4_BASE64 } from "./mockVideo";

/** 1x1 PNG (transparent) as base64 for mock image outputs. */
const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type MockState = {
  status: PollResult["status"];
  kind: string;
  forceFail: boolean;
  attempts: number;
  failUntilAttempt?: number;
  createdAt: number;
  delayMs: number;
};

const mockJobs = new Map<string, MockState>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock adapter used when USE_MOCK_ADAPTERS=true.
 * Same capability shapes as real adapters, but returns sample outputs after a delay.
 */
export function createMockAdapter(
  base: GenerationAdapter,
): GenerationAdapter {
  const costModel = base.capabilities.costModel;
  return {
    capabilities: {
      ...base.capabilities,
      // Keep real rates so estimates match production UI.
      costModel,
    },
    estimateCost(input) {
      return base.estimateCost(input);
    },
    async buildRequest(input: BuildRequestInput): Promise<ProviderRequest> {
      return {
        kind: input.kind ?? base.capabilities.operations[0],
        prompt: input.prompt ?? "",
        forceFail: input.forceFail === true,
        failUntilAttempt:
          typeof input.failUntilAttempt === "number"
            ? input.failUntilAttempt
            : undefined,
        delayMs:
          typeof input.mockDelayMs === "number" ? input.mockDelayMs : 200,
        model: base.capabilities.id,
      };
    },
    async submit(request: ProviderRequest): Promise<SubmitResult> {
      const providerJobId = `mock_${base.capabilities.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const forceFail = request.forceFail === true;
      const failUntilAttempt =
        typeof request.failUntilAttempt === "number"
          ? request.failUntilAttempt
          : undefined;

      // Transient failures for retry tests: throw before creating a job.
      if (
        failUntilAttempt !== undefined &&
        (request._attempt as number | undefined) !== undefined
      ) {
        const attempt = request._attempt as number;
        if (attempt < failUntilAttempt) {
          throw new Error("transient mock provider error");
        }
      }

      if (forceFail) {
        mockJobs.set(providerJobId, {
          status: "failed",
          kind: String(request.kind ?? "unknown"),
          forceFail: true,
          attempts: 1,
          createdAt: Date.now(),
          delayMs: Number(request.delayMs ?? 50),
        });
        return { providerJobId };
      }

      mockJobs.set(providerJobId, {
        status: "queued",
        kind: String(request.kind ?? "unknown"),
        forceFail: false,
        attempts: 1,
        failUntilAttempt,
        createdAt: Date.now(),
        delayMs: Number(request.delayMs ?? 200),
      });
      return { providerJobId };
    },
    async poll(providerJobId: string): Promise<PollResult> {
      const state = mockJobs.get(providerJobId);
      if (!state) {
        return { status: "failed", error: "Unknown mock job" };
      }
      if (state.forceFail) {
        return { status: "failed", error: "Forced mock failure" };
      }
      const elapsed = Date.now() - state.createdAt;
      if (elapsed < state.delayMs) {
        return { status: "running" };
      }
      state.status = "succeeded";
      mockJobs.set(providerJobId, state);

      const kind = base.capabilities.kind;
      let actualUnits = 1;
      if (kind === "video") actualUnits = 5;
      if (kind === "llm") actualUnits = 1;
      return { status: "succeeded", actualUnits };
    },
    async collect(providerJobId: string): Promise<CollectResult> {
      const state = mockJobs.get(providerJobId);
      if (!state || state.status !== "succeeded") {
        throw new Error("Mock job not ready for collect");
      }
      const kind = base.capabilities.kind;
      if (kind === "image") {
        return {
          outputs: [
            {
              type: "image",
              base64: SAMPLE_PNG_BASE64,
              contentType: "image/png",
              metadata: { mock: true },
            },
          ],
        };
      }
      if (kind === "video") {
        return {
          outputs: [
            {
              type: "video",
              base64: SAMPLE_MP4_BASE64,
              contentType: "video/mp4",
              metadata: { mock: true },
            },
          ],
        };
      }
      return {
        outputs: [
          {
            type: "text",
            metadata: {
              mock: true,
              text: "Mock DeepSeek reply: the scene works.",
            },
          },
        ],
      };
    },
    isTransientError(err) {
      return (
        err instanceof Error &&
        err.message.toLowerCase().includes("transient")
      );
    },
  };
}

/** Standalone mock used in tests without wrapping. */
export const mockImageAdapter: GenerationAdapter = createMockAdapter({
  capabilities: {
    id: "gpt-image-2",
    kind: "image",
    operations: ["text-to-image", "image-edit"],
    inputs: ["text", "referenceImages"],
    resolutions: ["1024x1024"],
    aspectRatios: ["1:1"],
    features: ["edit", "inpaint"],
    costModel: { unit: "per_image", creditsPerUnit: 10 },
  },
  estimateCost(input) {
    return estimateImageCost(input, {
      unit: "per_image",
      creditsPerUnit: 10,
    });
  },
  buildRequest: async () => ({}),
  submit: async () => ({ providerJobId: "" }),
  poll: async () => ({ status: "failed" }),
  collect: async () => ({ outputs: [] }),
});

export async function delayForTests(ms: number): Promise<void> {
  await sleep(ms);
}

// Re-export estimators used when building real adapters' cost wrappers.
export { estimateImageCost, estimateVideoCost, estimateTokenCost };
