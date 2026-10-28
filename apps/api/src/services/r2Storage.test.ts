import { beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { completeUpload } from "./r2Storage";
import { inspectObject, objectHeader, removeObject, sealUpload } from "./r2";
vi.mock("./r2", () => ({
  r2Config: () => ({ bucket: "test-media" }),
  inspectObject: vi.fn(),
  objectHeader: vi.fn(),
  removeObject: vi.fn(),
  sealUpload: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(inspectObject)
    .mockReset()
    .mockResolvedValue({
      bucket: "test-media",
      contentType: "image/png",
      size: 8,
    });
  vi.mocked(objectHeader)
    .mockReset()
    .mockResolvedValue(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  vi.mocked(removeObject).mockReset().mockResolvedValue(undefined);
  vi.mocked(sealUpload).mockReset().mockResolvedValue(undefined);
});
function context(completed = false, failCommit = false) {
  const runMutation = vi.fn(
    async (reference: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(reference);
      if (name === "storageIO:claimR2Upload")
        return {
          key: "staging/test",
          ...(completed ? { fileId: "file-id" } : {}),
        };
      if (name === "storageIO:completeR2Upload") {
        if (failCommit) throw new Error("Registration failed");
        expect(removeObject).not.toHaveBeenCalled();
        return "file-id";
      }
      return null;
    },
  );
  return { runMutation };
}
it("deletes only the staging copy after verified metadata registration commits", async () => {
  const ctx = context();
  expect(await completeUpload(ctx as never, "token")).toEqual({
    storageId: "file-id",
  });
  expect(sealUpload).toHaveBeenCalledWith("staging/test", "media/test");
  expect(removeObject).toHaveBeenCalledExactlyOnceWith(
    "staging/test",
    "test-media",
  );
});
it("retains staging for retry when metadata registration fails", async () => {
  const ctx = context(false, true);
  await expect(completeUpload(ctx as never, "token")).rejects.toThrow(
    "Upload verification failed",
  );
  expect(removeObject).not.toHaveBeenCalled();
  expect(
    ctx.runMutation.mock.calls.map(([ref]) => getFunctionName(ref)),
  ).toContain("storageIO:releaseR2Upload");
});
it("keeps a committed upload successful when staging deletion fails", async () => {
  vi.mocked(removeObject).mockRejectedValue(new Error("Temporary R2 failure"));
  const ctx = context();
  expect(await completeUpload(ctx as never, "token")).toEqual({
    storageId: "file-id",
  });
  expect(
    ctx.runMutation.mock.calls.map(([ref]) => getFunctionName(ref)),
  ).not.toContain("storageIO:releaseR2Upload");
});
it("retries staging deletion on repeated completion without copying media again", async () => {
  const ctx = context(true);
  expect(await completeUpload(ctx as never, "token")).toEqual({
    storageId: "file-id",
  });
  expect(removeObject).toHaveBeenCalledExactlyOnceWith(
    "staging/test",
    "test-media",
  );
  expect(sealUpload).not.toHaveBeenCalled();
  expect(inspectObject).not.toHaveBeenCalled();
  expect(ctx.runMutation).toHaveBeenCalledOnce();
});
