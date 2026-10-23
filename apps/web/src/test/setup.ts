import "@testing-library/jest-dom/vitest";

import { beforeEach, afterEach, vi } from "vitest";
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.reject(
        new Error("Unmocked network access is forbidden in tests"),
      ),
    ),
  ),
);
afterEach(() => vi.unstubAllGlobals());
