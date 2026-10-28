import * as r2 from "./r2";
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
it("refuses a legacy Convex upstream that ignores ranges", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ cancel });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
  );
  const ctx = {
    runQuery: vi
      .fn()
      .mockResolvedValueOnce({ storageId: "file", sizeBytes: 100 })
      .mockResolvedValueOnce(null),
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

it("authorizes R2 shares before redirecting to a short-lived signed URL", async () => {
  const sign = vi
    .spyOn(r2, "signDownload")
    .mockResolvedValue("https://r2.example/signed");
  const ctx = {
    runQuery: vi
      .fn()
      .mockResolvedValueOnce({ storageId: "file", sizeBytes: 100 })
      .mockResolvedValueOnce({ key: "media/test", bucket: "test-media" }),
    runMutation: vi.fn(),
  };
  try {
    const response = await serveSharedMedia(
      ctx as never,
      new Request("https://app.example/media", {
        headers: {
          Cookie: `cinakey_share=${"a".repeat(64)}`,
          Range: "bytes=0-9",
        },
      }),
      "link" as never,
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe("https://r2.example/signed");
    expect(sign).toHaveBeenCalledWith("media/test", "test-media", false, 300);
    expect(ctx.runMutation).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    sign.mockRestore();
  }
});
it("does not sign a URL when a share has been revoked", async () => {
  const sign = vi.spyOn(r2, "signDownload");
  const ctx = {
    runQuery: vi.fn().mockRejectedValue(new Error("Share unavailable")),
  };
  try {
    await expect(
      serveSharedMedia(
        ctx as never,
        new Request("https://app.example/media", {
          headers: { Cookie: `cinakey_share=${"a".repeat(64)}` },
        }),
        "link" as never,
      ),
    ).rejects.toThrow("Share unavailable");
    expect(sign).not.toHaveBeenCalled();
  } finally {
    sign.mockRestore();
  }
});
