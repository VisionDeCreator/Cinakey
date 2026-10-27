import { beforeEach, afterEach, vi } from "vitest";
import { setProviderTransportForTests } from "../src/providers/transport";
import nodemailer from "nodemailer";
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));
import { providerKeyNames } from "../src/config/env";
beforeEach(() => {
  for (const name of Object.values(providerKeyNames)) vi.stubEnv(name, "");
  vi.stubEnv("POLAR_PAYMENTS_ENABLED", "false");
  vi.stubEnv("SUBSCRIPTION_PAYWALL_ENABLED", "false");
  vi.stubEnv("POLAR_ACCESS_TOKEN", "");
  vi.stubEnv("POLAR_WEBHOOK_SECRET", "");
  vi.stubEnv("USE_MOCK_ADAPTERS", "true");
  vi.stubEnv("EMAIL_NOTIFICATIONS_ENABLED", "false");
  vi.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail: vi
      .fn()
      .mockRejectedValue(new Error("Unmocked SMTP is forbidden in tests")),
    close: vi.fn(),
  } as never);
  vi.stubEnv("ALLOW_DEVELOPMENT_PRICES", "true");
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.reject(
        new Error("Unmocked network access is forbidden in tests"),
      ),
    ),
  );
  setProviderTransportForTests(async (url, init) => {
    if (!vi.isMockFunction(globalThis.fetch))
      throw new Error("Real network transport is forbidden in tests");
    return globalThis.fetch(url, init);
  });
});
afterEach(() => {
  setProviderTransportForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
