import { afterEach, expect, it, vi } from "vitest";
import { uploadMedia } from "./uploadMedia";
const path = "/storage/uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("uploads bytes directly to R2 and finalizes metadata through the API", async () => {
  vi.stubEnv("VITE_API_URL", "https://api.example");
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ uploadUrl: "https://r2.example/signed" }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(Response.json({ storageId: "file-id" }));
  vi.stubGlobal("fetch", fetcher);
  const blob = new Blob(["png"], { type: "image/png" });
  expect(await (await uploadMedia(path, blob)).json()).toEqual({
    storageId: "file-id",
  });
  expect(fetcher.mock.calls[0]![0]).toBe(`https://api.example${path}`);
  expect(fetcher.mock.calls[1]).toEqual([
    "https://r2.example/signed",
    { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob },
  ]);
  expect(fetcher.mock.calls[2]![0]).toBe(`https://api.example${path}/complete`);
});
it("does not register a failed direct upload", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ uploadUrl: "https://r2.example/signed" }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(
    uploadMedia(path, new Blob(["png"], { type: "image/png" })),
  ).rejects.toThrow("Media upload failed");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("rejects unexpected upload endpoints before sending file data", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    uploadMedia("https://untrusted.example", new Blob(["private"])),
  ).rejects.toThrow("Invalid media upload session");
  expect(fetcher).not.toHaveBeenCalled();
});
