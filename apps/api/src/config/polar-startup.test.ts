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
it("rejects mismatched payment environments or provider modes before serving billing", async () => {
  for (const [name, value] of Object.entries({
    POLAR_PAYMENTS_ENABLED: "true",
    POLAR_ENVIRONMENT: "sandbox",
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
      environment: "production",
      mock: true,
      paywall: false,
    });
    await expect(validatePolarDeployment()).rejects.toThrow("must match");
    query.mockResolvedValue({
      environment: "sandbox",
      mock: false,
      paywall: false,
    });
    await expect(validatePolarDeployment()).rejects.toThrow("must match");
    query.mockResolvedValue({
      environment: "sandbox",
      mock: true,
      paywall: false,
    });
    await expect(validatePolarDeployment()).resolves.toBeUndefined();
  } finally {
    query.mockRestore();
  }
});

it("rejects sandbox payments with live generation even when both runtimes would otherwise match", async () => {
  for (const [name, value] of Object.entries({
    POLAR_PAYMENTS_ENABLED: "true",
    POLAR_ENVIRONMENT: "sandbox",
    POLAR_ACCESS_TOKEN: "test-token",
    POLAR_WEBHOOK_SECRET: "test-secret",
    POLAR_WORKSPACE_PRODUCT_ID: "sub",
    POLAR_TOPUP_10_PRODUCT_ID: "top10",
    POLAR_TOPUP_25_PRODUCT_ID: "top25",
    POLAR_TOPUP_50_PRODUCT_ID: "top50",
    USE_MOCK_ADAPTERS: "false",
  }))
    vi.stubEnv(name, value);
  const query = vi.spyOn(ConvexHttpClient.prototype, "query");
  try {
    await expect(validatePolarDeployment()).rejects.toThrow(
      "sandbox payments require USE_MOCK_ADAPTERS=true",
    );
    expect(query).not.toHaveBeenCalled();
  } finally {
    query.mockRestore();
  }
});
