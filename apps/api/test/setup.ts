import { beforeEach, afterEach, vi } from "vitest";
import { setProviderTransportForTests } from "../src/providers/transport";
import nodemailer from "nodemailer";
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));
const testProviderMode = vi.hoisted(() => ({ enabled: true }));
vi.mock("../src/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env")>();
  return {
    ...actual,
    useMockProviders: () => testProviderMode.enabled,
    validateProviderConfiguration: () => {
      if (!testProviderMode.enabled) actual.validateProviderConfiguration();
    },
    providerConfig: () => ({
      ...actual.providerConfig(),
      mock: testProviderMode.enabled,
    }),
  };
});
vi.mock("../src/providers/index", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/providers/index")>();
  const { createMockAdapter } = await import("./mock");
  return {
    ...actual,
    getAdapter: (id: string) => {
      if (!testProviderMode.enabled) return actual.getAdapter(id);
      const adapter = actual
        .listRealAdapters()
        .find((a) => a.capabilities.id === id);
      return adapter ? createMockAdapter(adapter) : undefined;
    },
    listAdapters: () =>
      testProviderMode.enabled
        ? actual.listRealAdapters().map(createMockAdapter)
        : actual.listAdapters(),
  };
});
export function setTestProviders(enabled: boolean) {
  testProviderMode.enabled = enabled;
}
import { providerKeyNames } from "../src/config/env";
beforeEach(() => {
  for (const name of Object.values(providerKeyNames)) vi.stubEnv(name, "");
  vi.stubEnv("POLAR_PAYMENTS_ENABLED", "false");
  vi.stubEnv("SUBSCRIPTION_PAYWALL_ENABLED", "false");
  vi.stubEnv("POLAR_ACCESS_TOKEN", "");
  vi.stubEnv("POLAR_WEBHOOK_SECRET", "");
  testProviderMode.enabled = true;
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
