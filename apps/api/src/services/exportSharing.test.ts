import { expect, it, vi } from "vitest";
import { byteRange, serveSharedMedia } from "./exportSharing";
import { readBoundedUpload } from "./publishedExports";
it("handles single, open-ended and suffix ranges, rejecting invalid/multiple ranges", () => {
  expect(byteRange("bytes=10-19", 100)).toEqual({
    start: 10,
    end: 19,
    partial: true,
  });
  expect(byteRange("bytes=95-", 100)).toEqual({
    start: 95,
    end: 99,
    partial: true,
  });
  expect(byteRange("bytes=-10", 100)).toEqual({
    start: 90,
    end: 99,
    partial: true,
  });
  for (const value of [
    "bytes=-0",
    "bytes=100-",
    "bytes=20-10",
    "bytes=1-2,4-5",
    "bytes=9007199254740992-",
  ])
    expect(() => byteRange(value, 100)).toThrow();
});
it("rejects oversized streaming uploads without trusting Content-Length", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(6));
      controller.enqueue(new Uint8Array(6));
      controller.close();
    },
  });
  await expect(
    readBoundedUpload(
      new Request("http://localhost/upload", {
        method: "POST",
        headers: { "Content-Type": "video/mp4" },
        body: stream,
        duplex: "half",
      } as RequestInit),
      10,
    ),
  ).rejects.toThrow("size limit");
});
it("never redirects to a storage URL and refuses an upstream that ignores ranges", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ cancel });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
  );
  const ctx = {
    runQuery: vi.fn().mockResolvedValue({ storageId: "file", sizeBytes: 100 }),
    storage: {
      getUrl: vi.fn().mockResolvedValue("https://storage.example/file"),
    },
    runMutation: vi.fn(),
  };
  await expect(
    serveSharedMedia(
      ctx as never,
      new Request("http://localhost/media", {
        headers: {
          Cookie: `cinakey_share=${"a".repeat(64)}`,
          Range: "bytes=0-9",
        },
      }),
      "link" as never,
    ),
  ).rejects.toThrow("range delivery unavailable");
  expect(ctx.runMutation).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalled();
});
