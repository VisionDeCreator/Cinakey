import { z } from "zod";
export type ProviderName = "deepseek" | "seedance" | "sume" | "openai";
export const providerKeyNames = {
  deepseek: "DEEPSEEK_API_KEY",
  seedance: "SEEDANCE_API_KEY",
  sume: "SUME_API_KEY",
  openai: "OPENAI_API_KEY",
} as const;
const schema = z.object({
  ENABLED_PROVIDERS: z.string().default("deepseek,sume"),
  PROVIDER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(600_000)
    .default(120_000),
  PROVIDER_READ_RETRIES: z.coerce.number().int().min(0).max(4).default(2),
});
/** Server-only configuration. Never returns keys in errors or serializable status payloads. */
export function serverEnv(name: string): string | undefined {
  return process.env[name];
}
export function providerConfig() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Invalid server configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  const enabled = parsed.data.ENABLED_PROVIDERS.split(",")
    .map((s) => (s.trim() === "seedance" ? "sume" : s.trim()))
    .filter((name) => Boolean(name) && name !== "openai");
  if (
    enabled.some(
      (name) => !Object.prototype.hasOwnProperty.call(providerKeyNames, name),
    )
  )
    throw new Error("Invalid ENABLED_PROVIDERS");
  return {
    enabled: enabled as ProviderName[],
    timeoutMs: parsed.data.PROVIDER_TIMEOUT_MS,
    readRetries: parsed.data.PROVIDER_READ_RETRIES,
    sumeBaseUrl: "https://api.sume.com",
    seedanceModel: "sume/seedance-2.5",
  };
}
function configuredProviderKey(provider: ProviderName): string {
  const config = providerConfig();
  if (!config.enabled.includes(provider))
    throw new Error(`${provider} provider is disabled`);
  const name = providerKeyNames[provider],
    key = process.env[name]?.trim();
  if (!key)
    throw new Error(
      `${name} is required when ${provider} is enabled; configure the ignored root .env`,
    );
  return key;
}
export function requireProviderKey(provider: ProviderName): string {
  if (
    process.env.POLAR_PAYMENTS_ENABLED === "true" &&
    (process.env.POLAR_ENVIRONMENT ?? "sandbox") === "sandbox"
  )
    throw new Error(
      "Polar sandbox balances cannot fund live provider requests. Sandbox funds cannot be used for live generation.",
    );
  const key = configuredProviderKey(provider);
  return key;
}
/** Test seam: only the test runner replaces this implementation. Runtime always uses live providers. */
export function useMockProviders(): boolean {
  return false;
}
export function validateProviderConfiguration() {
  const config = providerConfig();
  for (const provider of config.enabled) configuredProviderKey(provider);
}
