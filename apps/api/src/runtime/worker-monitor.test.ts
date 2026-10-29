import { afterEach, expect, it, vi } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { startWorkerMonitor } from "./worker-monitor";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("keeps heartbeats running during idle periods and long jobs, and stops on shutdown", async () => {
  vi.useFakeTimers();
  const send = vi
    .spyOn(ConvexHttpClient.prototype, "mutation")
    .mockResolvedValue(null);
  const monitor = startWorkerMonitor(
    new ConvexHttpClient("https://example.convex.cloud"),
    "worker-test",
  );
  await vi.advanceTimersByTimeAsync(40_000);
  expect(send).toHaveBeenCalledTimes(3);
  expect(send.mock.calls.at(-1)![1]).toMatchObject({
    instanceId: "worker-test",
    activeTasks: 0,
    stopping: false,
  });
  monitor.polled();
  await vi.advanceTimersByTimeAsync(0);
  monitor.setWorkload(4);
  await vi.advanceTimersByTimeAsync(80_000);
  expect(send.mock.calls.at(-1)![1]).toMatchObject({
    activeTasks: 4,
    stopping: false,
  });
  await monitor.close();
  const count = send.mock.calls.length;
  expect(send.mock.calls.at(-1)![1]).toMatchObject({
    activeTasks: 0,
    stopping: true,
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(send).toHaveBeenCalledTimes(count);
});
it("does not overlap slow heartbeats", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const send = vi
    .spyOn(ConvexHttpClient.prototype, "mutation")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(null);
        }),
    )
    .mockResolvedValue(null);
  const monitor = startWorkerMonitor(
    new ConvexHttpClient("https://example.convex.cloud"),
    "worker-slow",
  );
  await vi.advanceTimersByTimeAsync(4000);
  expect(send).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(0);
  await monitor.close();
});
it("bounds shutdown time when monitoring requests never return", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(ConvexHttpClient.prototype, "mutation").mockImplementation(
    () => new Promise(() => {}),
  );
  const monitor = startWorkerMonitor(
    new ConvexHttpClient("https://example.convex.cloud"),
    "worker-hung",
  );
  const closing = monitor.close();
  await vi.advanceTimersByTimeAsync(11_000);
  await closing;
});

it("writes container health only after successful monitoring and marks graceful shutdown", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "cinakey-monitor-"));
  const path = join(dir, "health.json");
  vi.stubEnv("WORKER_HEALTH_FILE", path);
  vi.useFakeTimers();
  const send = vi
    .spyOn(ConvexHttpClient.prototype, "mutation")
    .mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const monitor = startWorkerMonitor(
      new ConvexHttpClient("https://example.convex.cloud"),
      "health-test",
    );
    await vi.advanceTimersByTimeAsync(0);
    const first = JSON.parse(readFileSync(path, "utf8"));
    send.mockRejectedValue(new Error("offline"));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(JSON.parse(readFileSync(path, "utf8")).at).toBe(first.at);
    send.mockResolvedValue(null);
    monitor.polled();
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(readFileSync(path, "utf8")).lastPollAt).toBe(Date.now());
    await monitor.close();
    expect(JSON.parse(readFileSync(path, "utf8")).stopping).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});
