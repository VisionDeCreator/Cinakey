import { createPolar } from "@polar-sh/sdk/2026-10";

export const polarSecretNames = [
  "POLAR_ACCESS_TOKEN",
  "POLAR_WEBHOOK_SECRET",
] as const;
export function polarConfiguration() {
  const enabled = process.env.POLAR_PAYMENTS_ENABLED ?? "false";
  const paywall = process.env.SUBSCRIPTION_PAYWALL_ENABLED ?? "false";
  if (!["true", "false"].includes(paywall))
    throw new Error("Invalid SUBSCRIPTION_PAYWALL_ENABLED");
  const environment = process.env.POLAR_ENVIRONMENT ?? "sandbox";
  if (
    !["true", "false"].includes(enabled) ||
    !["sandbox", "production"].includes(environment)
  )
    throw new Error("Invalid Polar enable/environment configuration");
  const products = {
    subscription: process.env.POLAR_WORKSPACE_PRODUCT_ID?.trim() ?? "",
    topup10: process.env.POLAR_TOPUP_10_PRODUCT_ID?.trim() ?? "",
    topup25: process.env.POLAR_TOPUP_25_PRODUCT_ID?.trim() ?? "",
    topup50: process.env.POLAR_TOPUP_50_PRODUCT_ID?.trim() ?? "",
  };
  const site = process.env.SITE_URL?.trim() || "http://localhost:5173";
  const url = new URL(site);
  if (
    environment === "production" &&
    enabled === "true" &&
    url.protocol !== "https:"
  )
    throw new Error("Production Polar payments require an HTTPS SITE_URL");
  if (enabled === "true") {
    const missing = [
      ...polarSecretNames,
      ...[
        "POLAR_WORKSPACE_PRODUCT_ID",
        "POLAR_TOPUP_10_PRODUCT_ID",
        "POLAR_TOPUP_25_PRODUCT_ID",
        "POLAR_TOPUP_50_PRODUCT_ID",
      ],
    ].filter((n) => !process.env[n]?.trim());
    if (missing.length)
      throw new Error(`Missing Polar configuration: ${missing.join(", ")}`);
    const ids = Object.values(products);
    if (new Set(ids).size !== ids.length)
      throw new Error("Polar products must have distinct IDs");
  }
  return {
    enabled: enabled === "true",
    paywall: paywall === "true",
    environment: environment as "sandbox" | "production",
    products,
    siteUrl: url.origin,
  };
}
export function polarClient() {
  const config = polarConfiguration();
  if (!config.enabled) throw new Error("Payments are not enabled yet");
  return createPolar({
    accessToken: process.env.POLAR_ACCESS_TOKEN!,
    environment: config.environment,
    timeout: 15,
  });
}
export function polarRedirect(url: string) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !(parsed.hostname === "polar.sh" || parsed.hostname.endsWith(".polar.sh"))
  )
    throw new Error("Invalid Polar redirect URL");
  return url;
}
