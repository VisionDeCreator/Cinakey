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
  it("decodes split streaming frames and updates the cached conversation", async () => {
    const client = new ApiClient("http://api", "token");
    const entry = client.entry("copilot:listMessages", { projectId: "p" });
    entry.data = [];
    const text =
      [
        JSON.stringify({
          type: "assistant",
          message: { _id: "m", projectId: "p", content: "" },
        }),
        JSON.stringify({ type: "delta", messageId: "m", delta: "Hello" }),
        JSON.stringify({ type: "result", value: { done: true } }),
      ].join("\n") + "\n";
    const bytes = new TextEncoder().encode(text);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes.slice(0, 13));
              controller.enqueue(bytes.slice(13));
              controller.close();
            },
          }),
        ),
      ),
    );
    expect(await client.call("copilot:runTurn", {}, true)).toEqual({
      done: true,
    });
    expect(entry.data[0].content).toBe("Hello");
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
    await expect(client.call("copilot:runTurn", {})).rejects.toMatchObject({
      data: { code: "INSUFFICIENT_CREDITS" },
    });
  });
});
