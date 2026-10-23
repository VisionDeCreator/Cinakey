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
});
