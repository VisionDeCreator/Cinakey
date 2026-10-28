import { afterEach, expect, it, vi } from "vitest";
import { uploadProgress } from "./uploadProgress";
import { uploadMedia } from "./uploadMedia";
let status = 200;
class TestUpload {
  status = status;
  upload: { onprogress?: (event: unknown) => void } = {};
  onload?: () => void;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send() {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: 50,
      total: 100,
    });
    this.onload?.();
  }
}
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
    .mockResolvedValueOnce(Response.json({ storageId: "file-id" }));
  vi.stubGlobal("fetch", fetcher);
  status = 200;
  vi.stubGlobal("XMLHttpRequest", TestUpload);
  const blob = new Blob(["png"], { type: "image/png" });
  const progress = vi.fn();
  expect(await (await uploadMedia(path, blob, progress)).json()).toEqual({
    storageId: "file-id",
  });
  expect(progress.mock.calls.map((call) => call[0])).toEqual([0, 50, 100]);
  expect(fetcher.mock.calls[0]![0]).toBe(`https://api.example${path}`);
  expect(fetcher.mock.calls[1]![0]).toBe(`https://api.example${path}/complete`);
  expect(uploadProgress.snapshot().at(-1)).toMatchObject({
    progress: 100,
    status: "done",
  });
});
it("does not register a failed direct upload", async () => {
  status = 403;
  vi.stubGlobal("XMLHttpRequest", TestUpload);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ uploadUrl: "https://r2.example/signed" }),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    uploadMedia(path, new Blob(["png"], { type: "image/png" })),
  ).rejects.toThrow("Media upload failed");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects unexpected upload endpoints before sending file data", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    uploadMedia("https://untrusted.example", new Blob(["private"])),
  ).rejects.toThrow("Invalid media upload session");
  expect(fetcher).not.toHaveBeenCalled();
});
