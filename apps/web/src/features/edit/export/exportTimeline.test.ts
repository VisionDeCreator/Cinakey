import { describe, expect, it, vi } from "vitest";
import { timelineWithMedia } from "../../../../../../packages/shared/test/timelineFixture";

import { evenDims } from "../mediaUrls";
import { exportTimelineMp4 } from "./exportTimeline";
vi.mock("mediabunny", async () => ({
  ...(await vi.importActual("mediabunny")),
  canEncodeVideo: async () => true,
  canEncodeAudio: async () => true,
}));
describe("export preflight", () => {
  const doc = timelineWithMedia({
    project: { id: "p", aspectRatio: "9:16", fps: 24 },
    clips: [
      {
        order: 0,
        durationSec: 5,
        assetId: "a",
      },
    ],
  });
  it("fails before rendering or fetching when a source is missing", async () => {
    vi.stubGlobal("VideoEncoder", class {});
    vi.stubGlobal("AudioEncoder", class {});
    await expect(exportTimelineMp4({ doc, urls: {} })).rejects.toThrow(
      "Missing source media",
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("rejects out-of-range trims rather than exporting a frozen tail", async () => {
    vi.stubGlobal("VideoEncoder", class {});
    vi.stubGlobal("AudioEncoder", class {});
    await expect(
      exportTimelineMp4({
        doc,
        urls: { a: { url: "https://fixture.test/video.mp4", durationSec: 2 } },
      }),
    ).rejects.toThrow("beyond its source");
  });
  it("honors cancellation before starting work and uses correct portrait dimensions", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      exportTimelineMp4({ doc, urls: {}, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(evenDims(1080, "9:16")).toEqual({ width: 608, height: 1080 });
    expect(evenDims(1080, "1:1")).toEqual({ width: 1080, height: 1080 });
  });
});
