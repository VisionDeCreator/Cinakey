import { requireProviderKey } from "./env";
import { expect, it, vi } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { validatePolarDeployment } from "./polar-startup";
it("does no remote work when payments are disabled", async () => {
  const query = vi.spyOn(ConvexHttpClient.prototype, "query");
  try {
    await validatePolarDeployment();
    expect(query).not.toHaveBeenCalled();
  } finally {
    query.mockRestore();
  }
});
it("rejects mismatched payment environments before serving billing", async () => {
  for (const [name, value] of Object.entries({
    POLAR_PAYMENTS_ENABLED: "true",
    POLAR_ENVIRONMENT: "production",
    SITE_URL: "https://dirrio.example",
    POLAR_ACCESS_TOKEN: "test-token",
    POLAR_WEBHOOK_SECRET: "test-secret",
    POLAR_WORKSPACE_PRODUCT_ID: "sub",
    POLAR_TOPUP_10_PRODUCT_ID: "top10",
    POLAR_TOPUP_25_PRODUCT_ID: "top25",
    POLAR_TOPUP_50_PRODUCT_ID: "top50",
    CONVEX_URL: "https://example.convex.cloud",
    CONVEX_DEPLOY_KEY: "test-only",
  }))
    vi.stubEnv(name, value);
  const query = vi.spyOn(ConvexHttpClient.prototype, "query");
  try {
    query.mockResolvedValue({
      environment: "sandbox",
      paywall: false,
    });
    await expect(validatePolarDeployment()).rejects.toThrow("must match");
    query.mockResolvedValue({
      environment: "production",
      paywall: true,
    });
    await expect(validatePolarDeployment()).rejects.toThrow("must match");
    query.mockResolvedValue({
      environment: "production",
      paywall: false,
    });
    await expect(validatePolarDeployment()).resolves.toBeUndefined();
  } finally {
    query.mockRestore();
  }
});

it("starts in a matching sandbox deployment while provider requests remain blocked", async () => {
  for (const [name, value] of Object.entries({
    POLAR_PAYMENTS_ENABLED: "true",
    POLAR_ENVIRONMENT: "sandbox",
    CONVEX_URL: "https://example.convex.cloud",
    CONVEX_DEPLOY_KEY: "test-only",
    POLAR_ACCESS_TOKEN: "test-token",
    POLAR_WEBHOOK_SECRET: "test-secret",
    POLAR_WORKSPACE_PRODUCT_ID: "sub",
    POLAR_TOPUP_10_PRODUCT_ID: "top10",
    POLAR_TOPUP_25_PRODUCT_ID: "top25",
    POLAR_TOPUP_50_PRODUCT_ID: "top50",
  }))
    vi.stubEnv(name, value);
  const query = vi.spyOn(ConvexHttpClient.prototype, "query");
  try {
    query.mockResolvedValue({ environment: "sandbox", paywall: false });
    await expect(validatePolarDeployment()).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledOnce();
    expect(() => requireProviderKey("sume")).toThrow(
      "sandbox balances cannot fund live",
    );
  } finally {
    query.mockRestore();
  }
});
