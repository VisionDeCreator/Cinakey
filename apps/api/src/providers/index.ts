import { deepseekAdapter } from "./deepseek";
import { createMockAdapter } from "./mock";
import { seedance25Adapter } from "./seedance25";
import type { GenerationAdapter } from "@cinakey/shared";
import { useMockProviders, requireProviderKey } from "../config/env";

export type { GenerationAdapter, ModelCapabilities } from "@cinakey/shared";

const realAdapters: Record<string, GenerationAdapter> = {
  "seedance-2.5": seedance25Adapter,
  deepseek: deepseekAdapter,
};

function useMockAdapters(): boolean {
  return useMockProviders();
}

function resolveAdapter(id: string): GenerationAdapter | undefined {
  const real = realAdapters[id];
  if (!real) return undefined;
  if (useMockAdapters()) {
    return createMockAdapter(real);
  }
  requireProviderKey(id === "seedance-2.5" ? "seedance" : "deepseek");
  return real;
}

export function getAdapter(id: string): GenerationAdapter | undefined {
  return resolveAdapter(id);
}

export function listAdapters(): GenerationAdapter[] {
  return Object.keys(realAdapters)
    .map((id) => resolveAdapter(id)!)
    .filter(Boolean);
}

/** Expose real adapters for tests that need to wrap specifically. */
export function listRealAdapters(): GenerationAdapter[] {
  return Object.values(realAdapters);
}
