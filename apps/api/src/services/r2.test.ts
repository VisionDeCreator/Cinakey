import { describe, expect, it, vi } from "vitest";
import { r2Config, resolveMediaUrls, signUpload, signDownload } from "./r2";
import { validateMediaUpload, validateMediaHeader } from "./r2Storage";
function configure() {
  vi.stubEnv("R2_ACCOUNT_ID", "a".repeat(32));
  vi.stubEnv(
    "R2_ENDPOINT",
    `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
  );
  vi.stubEnv("R2_BUCKET", "test-media");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret-key");
}
describe("R2 storage", () => {
  it("validates configuration without disclosing credentials", () => {
    configure();
    expect(r2Config().bucket).toBe("test-media");
    vi.stubEnv("R2_ENDPOINT", "https://untrusted.example");
    expect(() => r2Config()).toThrow("R2_ENDPOINT must be");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
    expect(() => r2Config()).toThrow("Configure all R2");
  });
  it("signs bounded uploads and downloads without putting the secret in URLs", async () => {
    configure();
    const put = new URL(await signUpload("staging/test", "image/png", 123));
    expect(put.hostname).toContain("r2.cloudflarestorage.com");
    expect(put.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(put.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-length",
    );
    expect(put.href).not.toContain("test-secret-key");
    const get = new URL(await signDownload("media/test", "test-media"));
    expect(get.searchParams.get("X-Amz-Expires")).toBe("86400");
    await expect(signDownload("media/test", "wrong-bucket")).rejects.toThrow(
      "different R2 bucket",
    );
  });
  it("resolves media references and suppresses deleted objects", async () => {
    configure();
    const lookup = vi.fn(async (id: string) =>
      id === "deleted"
        ? { key: "media/gone", bucket: "test-media", deletedAt: 1 }
        : { key: "media/test", bucket: "test-media" },
    );
    const result = await resolveMediaUrls(
      { items: [{ url: "r2://file" }, { url: "r2://deleted" }], title: "Film" },
      lookup,
    );
    expect(result.items[0].url).toContain("X-Amz-Signature=");
    expect(result.items[1].url).toBeNull();
    expect(result.title).toBe("Film");
  });
  it("rejects oversized, unsupported and spoofed media", () => {
    expect(validateMediaUpload("image/png", 100)).toBe("image/png");
    expect(() => validateMediaUpload("image/png", 26 * 1024 * 1024)).toThrow();
    expect(() => validateMediaUpload("video/mp4", 501 * 1024 * 1024)).toThrow();
    expect(() => validateMediaUpload("text/html", 100)).toThrow();
    expect(() => validateMediaUpload("image/png", -1)).toThrow();
    expect(() =>
      validateMediaHeader(
        "image/png",
        new TextEncoder().encode("not an image"),
      ),
    ).toThrow();
    expect(() =>
      validateMediaHeader(
        "image/png",
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      ),
    ).not.toThrow();
    expect(() =>
      validateMediaHeader(
        "video/mp4",
        new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
      ),
    ).not.toThrow();
  });
});
