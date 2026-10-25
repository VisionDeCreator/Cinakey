import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorker } from "./worker";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONVEX_URL", "https://example.convex.cloud");
  vi.stubEnv("CONVEX_DEPLOY_KEY", "test-only");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("worker startup", () => {
  it("waits once for deployment, then resumes when worker functions are uploaded", async () => {
    const controller = new AbortController();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let attempts = 0;
    const calls: string[] = [];
    vi.spyOn(ConvexHttpClient.prototype, "mutation").mockImplementation(
      async (...[reference]) => {
        const name = getFunctionName(reference as never);
        calls.push(name);
        if (name === "tasks:reconcileGeneration" && ++attempts <= 2)
          throw new Error(
            "Could not find public function for 'tasks:reconcileGeneration'.",
          );
        if (name === "tasks:reconcileGeneration")
          return { isDone: true, cursor: "" };
        if (name === "tasks:claim") {
          controller.abort();
          return [];
        }
        return null;
      },
    );
    const running = runWorker(controller.signal);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(warning).toHaveBeenCalledOnce();
    expect(calls).not.toContain("tasks:claim");
    await vi.advanceTimersByTimeAsync(4_000);
    await running;
    expect(attempts).toBe(5);
    expect(calls).toContain("tasks:claim");
    expect(info).toHaveBeenCalledWith(expect.stringContaining("resuming"));
    expect(errors).not.toHaveBeenCalled();
  });
  it("can shut down while waiting for backend deployment", async () => {
    const controller = new AbortController();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(ConvexHttpClient.prototype, "mutation").mockRejectedValue(
      new Error(
        "Could not find public function for 'tasks:reconcileGeneration'.",
      ),
    );
    const running = runWorker(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await running;
  });
  it("does not hide authentication errors as missing deployment functions", async () => {
    const controller = new AbortController();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(ConvexHttpClient.prototype, "mutation").mockImplementation(
      async () => {
        controller.abort();
        throw new Error("Invalid deployment credential");
      },
    );
    await runWorker(controller.signal);
    expect(warning).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      "[worker] tick failed",
      "Invalid deployment credential",
    );
  });
});
