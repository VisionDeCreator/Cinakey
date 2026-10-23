import { describe, expect, it, vi } from "vitest";
import { MediaCache } from "./MediaCache";

describe("media read safety", () => {
  it("deduplicates simultaneous reads of the same media", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const cache = new MediaCache();
    const first = cache.ensure(
      "asset",
      "https://fixture.test/audio.wav",
      "audio",
    );
    const second = cache.ensure(
      "asset",
      "https://fixture.test/audio.wav",
      "audio",
    );
    resolve(new Response(new Blob(["fixture"], { type: "audio/wav" })));
    expect(await first).toBe(await second);
    expect(fetcher).toHaveBeenCalledOnce();
    cache.dispose();
  });
  it("rejects failed media downloads instead of treating an error page as playable media", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("missing", { status: 404 })),
    );
    await expect(
      new MediaCache().ensure(
        "asset",
        "https://fixture.test/video.mp4",
        "video",
      ),
    ).rejects.toThrow("404");
  });
});
