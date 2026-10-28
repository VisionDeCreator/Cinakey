import { deepseekAdapter } from "./deepseek";
import { remixLiteAdapter } from "./sume";
import { seedance25Adapter } from "./seedance25";
import type { GenerationAdapter } from "@cinakey/shared";
import { requireProviderKey } from "../config/env";

export type { GenerationAdapter, ModelCapabilities } from "@cinakey/shared";

const realAdapters: Record<string, GenerationAdapter> = {
  "seedance-2.5": seedance25Adapter,
  "sume-remix-lite": remixLiteAdapter,
  deepseek: deepseekAdapter,
};

function resolveAdapter(id: string): GenerationAdapter | undefined {
  const real = realAdapters[id];
  if (!real) return undefined;
  requireProviderKey(real.capabilities.kind === "video" ? "sume" : "deepseek");
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
