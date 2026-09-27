import { deepseekAdapter } from "./deepseek";
import { gptImage2Adapter } from "./gptImage2";
import { seedance25Adapter } from "./seedance25";
import type { GenerationAdapter } from "@cinakey/shared";

export type { GenerationAdapter, ModelCapabilities } from "@cinakey/shared";

const adapters: Record<string, GenerationAdapter> = {
  "seedance-2.5": seedance25Adapter,
  "gpt-image-2": gptImage2Adapter,
  deepseek: deepseekAdapter,
};

export function getAdapter(id: string): GenerationAdapter | undefined {
  return adapters[id];
}

export function listAdapters(): GenerationAdapter[] {
  return Object.values(adapters);
}
