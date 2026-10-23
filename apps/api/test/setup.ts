import { beforeEach, afterEach, vi } from "vitest";
import { setProviderTransportForTests } from "../src/providers/transport";
import { providerKeyNames } from "../src/config/env";
beforeEach(() => {
  for (const name of Object.values(providerKeyNames)) vi.stubEnv(name, "");
  vi.stubEnv("USE_MOCK_ADAPTERS", "true");
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
