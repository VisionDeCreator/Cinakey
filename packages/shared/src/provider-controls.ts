/** Stable application model IDs. Credentials and supplier routing remain server configuration. */
export const ADMIN_MODELS = [
  { id: "seedance-2.5", provider: "sume", kind: "video" },
  { id: "sume-remix-lite", provider: "sume", kind: "video" },
  { id: "deepseek", provider: "deepseek", kind: "text" },
] as const;
export const PROVIDER_CONTROL_KEYS = [
  "global",
  "provider:sume",
  "provider:deepseek",
  ...ADMIN_MODELS.map((m) => `model:${m.id}`),
] as const;
export function providerForModel(model: string): string {
  return ADMIN_MODELS.find((m) => m.id === model)?.provider ?? "legacy";
}
export function providerScopes(model: string): string[] {
  return ["global", `provider:${providerForModel(model)}`, `model:${model}`];
}
