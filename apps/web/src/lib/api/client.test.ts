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
  it("preserves structured USD funding errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { code: "INSUFFICIENT_FUNDS", required: 5, balance: 1 },
          }),
          { status: 422 },
        ),
      ),
    );
    const client = new ApiClient("http://api", "token");
    await expect(
      client.call("generation:startGeneration", {}),
    ).rejects.toMatchObject({
      data: { code: "INSUFFICIENT_FUNDS" },
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
  const listener = vi.fn();
  entry.listeners.add(listener);
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
  listener.mockClear();
  await client.poll();
  expect(entry.transientError).toBe(false);
  expect(listener).toHaveBeenCalled();
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

it("keeps a late previous-workspace response out of the selected workspace cache", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ value: [{ title: "Studio project" }] })),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const client = new ApiClient("http://api.test", "token");
  const previous = client.entry("projects:listMine", {
    workspaceId: "personal",
  });
  const selected = client.entry("projects:listMine", { workspaceId: "studio" });
  const oldRead = client.load(previous);
  await client.load(selected);
  finish(
    new Response(JSON.stringify({ value: [{ title: "Personal project" }] })),
  );
  await oldRead;
  expect(selected.data).toEqual([{ title: "Studio project" }]);
  expect(previous.data).toEqual([{ title: "Personal project" }]);
  client.close();
});

it("refreshes active workspace memberships so remote access changes become visible", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ value: [] })))),
  );
  const client = new ApiClient("http://api.test", "token");
  const entry = client.entry("teams:list", {});
  entry.data = [{ workspace: { _id: "removed" }, role: "creator" }];
  entry.loadedAt = Date.now() - 11_000;
  entry.listeners.add(() => {});
  await client.poll();
  expect(entry.data).toEqual([]);
  client.close();
});

it("refreshes spending when another workspace member creates a hold", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ value: { reservedUsdMicros: 10 } })),
      ),
    ),
  );
  const client = new ApiClient("http://api.test", "token");
  const entry = client.entry("workspace:spend", { projectId: "episode" });
  entry.data = { reservedUsdMicros: 0 };
  entry.loadedAt = Date.now() - 11_000;
  entry.listeners.add(() => {});
  await client.poll();
  expect(entry.data.reservedUsdMicros).toBe(10);
  client.close();
});

it("preserves structured error codes while displaying a human-readable failure message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Editing access expired.",
          data: {
            code: "TIMELINE_LEASE_LOST",
            message: "Your local draft is preserved.",
          },
        }),
        { status: 422 },
      ),
    ),
  );
  const client = new ApiClient("http://localhost", "token");
  await expect(client.call("timelineVersions:save", {})).rejects.toMatchObject({
    message: "Your local draft is preserved.",
    data: { code: "TIMELINE_LEASE_LOST" },
  });
});

it("keeps fenced lease releases alive across page navigation and client disposal", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ value: null })));
  vi.stubGlobal("fetch", fetcher);
  const client = new ApiClient("http://api", "token");
  await client.call("timelineLeases:release", {
    projectId: "project",
    sessionId: "session",
    fence: 1,
  });
  expect(fetcher).toHaveBeenCalledWith(
    "http://api/v1/timelineLeases/release",
    expect.objectContaining({ keepalive: true, signal: undefined }),
  );
  client.close();
});

it("refreshes only the requested active query names", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(
      async () => new Response(JSON.stringify({ value: [] })),
    );
  vi.stubGlobal("fetch", fetcher);
  const client = new ApiClient("http://api", "token");
  const billing = client.entry("billing:getBalance", {}),
    projects = client.entry("projects:listMine", {});
  billing.listeners.add(() => {});
  projects.listeners.add(() => {});
  await client.invalidate(["billing:getBalance"]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(billing.data).toEqual([]);
  expect(projects.data).toBeUndefined();
});

it("refreshes administrator permissions and Admin lists during polling", async () => {
  const client = new ApiClient("http://api.test", "token");
  const send = vi
    .fn()
    .mockImplementation(
      async () => new Response(JSON.stringify({ value: null })),
    );
  vi.stubGlobal("fetch", send);
  for (const name of [
    "users:viewer",
    "adminAccess:listAdministrators",
    "adminAccess:listAudit",
    "adminOperations:overview",
    "adminJobs:detail",
  ]) {
    const entry = client.entry(name, {});
    entry.loadedAt = Date.now() - 31_000;
    entry.data = null;
    entry.listeners.add(() => {});
  }
  await client.poll();
  expect(send).toHaveBeenCalledTimes(5);
  client.close();
});
