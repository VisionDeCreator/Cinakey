import { z } from "zod";
export type ProviderName = "deepseek" | "seedance" | "openai";
export const providerKeyNames = {
  deepseek: "DEEPSEEK_API_KEY",
  seedance: "SEEDANCE_API_KEY",
  openai: "OPENAI_API_KEY",
} as const;
const flags = z.enum(["true", "false"]);
const schema = z.object({
  USE_MOCK_ADAPTERS: flags.default("false"),
  ENABLED_PROVIDERS: z.string().default("deepseek,seedance"),
  PROVIDER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(600_000)
    .default(120_000),
  PROVIDER_READ_RETRIES: z.coerce.number().int().min(0).max(4).default(2),
  SEEDANCE_MODEL: z
    .string()
    .trim()
    .min(1)
    .default("doubao-seedance-2-5-260628"),
  SEEDANCE_API_BASE_URL: z
    .url()
    .default("https://ark.cn-beijing.volces.com/api/v3"),
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
    .map((s) => s.trim())
    .filter((name) => Boolean(name) && name !== "openai");
  if (
    enabled.some(
      (name) => !Object.prototype.hasOwnProperty.call(providerKeyNames, name),
    )
  )
    throw new Error("Invalid ENABLED_PROVIDERS");
  const base = new URL(parsed.data.SEEDANCE_API_BASE_URL);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error(
      "SEEDANCE_API_BASE_URL must be an HTTPS URL without credentials or query parameters",
    );
  return {
    mock: parsed.data.USE_MOCK_ADAPTERS === "true",
    enabled: enabled as ProviderName[],
    timeoutMs: parsed.data.PROVIDER_TIMEOUT_MS,
    readRetries: parsed.data.PROVIDER_READ_RETRIES,
    seedanceModel: parsed.data.SEEDANCE_MODEL,
    // Accept either the API root or the complete create-task URL from provider examples.
    seedanceBaseUrl: base.href
      .replace(/\/$/, "")
      .replace(/\/contents\/generations\/tasks$/, ""),
  };
}
export function requireProviderKey(provider: ProviderName): string {
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
export function useMockProviders(): boolean {
  return providerConfig().mock;
}
export function validateProviderConfiguration() {
  const config = providerConfig();
  if (!config.mock)
    for (const provider of config.enabled) requireProviderKey(provider);
}
