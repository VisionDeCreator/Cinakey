import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";
afterEach(() => vi.unstubAllGlobals());
describe("API client", () => {
  it("deduplicates in-flight reads and caches results", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ value: [{ title: "Film" }] })),
      );
    vi.stubGlobal("fetch", fetcher);
    const client = new ApiClient("http://api", "token");
    const entry = client.entry("projects:listMine", {});
    await Promise.all([client.load(entry), client.load(entry)]);
    await client.load(entry);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(entry.data).toEqual([{ title: "Film" }]);
  });
  it("preserves structured credit errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { code: "INSUFFICIENT_CREDITS", required: 5, balance: 1 },
          }),
          { status: 422 },
        ),
      ),
    );
    const client = new ApiClient("http://api", "token");
    await expect(
      client.call("generation:startGeneration", {}),
    ).rejects.toMatchObject({
      data: { code: "INSUFFICIENT_CREDITS" },
    });
  });
  it("refreshes a binding after a mutation even if a previous read is still in flight", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(
        new Response(
          JSON.stringify({ value: [{ alias: "image_1", assetId: "new" }] }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const client = new ApiClient("http://api", "token");
    const entry = client.entry("references:list", {});
    entry.listeners.add(() => {});
    const initial = client.load(entry);
    const refresh = client.invalidate();
    finish(new Response(JSON.stringify({ value: [] })));
    await initial;
    await refresh;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(entry.data).toEqual([{ alias: "image_1", assetId: "new" }]);
  });
});

it("keeps the current query data during a network interruption and recovers through polling", async () => {
  const client = new ApiClient("http://api.test", "token");
  const entry = client.entry("workspace:list", { projectId: "p" });
  entry.listeners.add(() => {});
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: { script: "saved" } })),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(
        new Response(JSON.stringify({ value: { script: "saved" } })),
      ),
  );
  await client.load(entry, true);
  await client.load(entry, true);
  expect(entry.data).toEqual({ script: "saved" });
  expect(entry.error).toBeUndefined();
  expect(entry.transientError).toBe(true);
  await client.poll();
  expect(entry.transientError).toBe(false);
  client.close();
});
it("polls workspace generation jobs without waiting for a notification", async () => {
  const client = new ApiClient("http://api.test", "token");
  const entry = client.entry("workspace:videos", { projectId: "p" });
  entry.listeners.add(() => {});
  entry.data = { jobs: [{ status: "running" }] };
  const send = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ value: { jobs: [{ status: "succeeded" }] } }),
        ),
      ),
    );
  vi.stubGlobal("fetch", send);
  await client.poll();
  expect(entry.data.jobs[0].status).toBe("succeeded");
  expect(send).toHaveBeenCalled();
  client.close();
});
