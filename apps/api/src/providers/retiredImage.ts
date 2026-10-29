import type { GenerationAdapter } from "@dirrio/shared";
import { SubmissionUncertainError } from "./errors";

const unavailable = async (): Promise<never> => {
  throw new SubmissionUncertainError();
};
/** Only materializes already persisted historical results. Never calls a provider. */
export const retiredImageAdapter: GenerationAdapter = {
  capabilities: {
    id: "gpt-image-2",
    kind: "image",
    operations: [],
    inputs: [],
    features: [],
    costModel: { unit: "per_image", usdMicrosPerUnit: 10 },
  },
  estimateCost: () => 10,
  buildRequest: unavailable,
  submit: unavailable,
  poll: unavailable,
  collect: unavailable,
};
