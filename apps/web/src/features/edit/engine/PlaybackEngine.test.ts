import { expect, it, vi } from "vitest";
import { assembleFromShotList } from "@cinakey/shared";
import { PlaybackEngine } from "./PlaybackEngine";
const state = vi.hoisted(() => ({
  ensure: vi.fn(),
  draw: vi.fn(),
  titles: vi.fn(),
}));
vi.mock("./Compositor", () => ({
  Compositor: class {
    resize() {}
    clear() {}
    drawMedia = state.draw;
    drawTitles = state.titles;
    dispose() {}
  },
}));
vi.mock("./MediaCache", () => ({
  MediaCache: class {
    ensure = state.ensure;
    setAudioContext() {}
    dispose() {}
  },
}));
vi.mock("./AudioGraph", async () => {
  const actual =
    await vi.importActual<typeof import("./AudioGraph")>("./AudioGraph");
  return {
    ...actual,
    AudioGraph: class {
      ctx = {};
      stopAll() {}
      dispose() {}
    },
  };
});
it("discards late frames and paints titles after the current frame", async () => {
  let ready!: (value: unknown) => void;
  const delayed = new Promise((resolve) => {
    ready = resolve;
  });
  const decode = vi.fn(async (time: number) => ({ canvas: { time } }));
  state.ensure.mockImplementation(() => delayed);
  state.draw.mockClear();
  state.titles.mockClear();
  const engine = new PlaybackEngine(document.createElement("canvas"));
  const doc = assembleFromShotList({
    project: { id: "p", aspectRatio: "16:9", fps: 24 },
    shots: [
      {
        shotId: "s",
        sceneOrder: 0,
        shotOrder: 0,
        durationSec: 5,
        take: { takeId: "t", assetId: "a" },
      },
    ],
  });
  engine.setDocument(doc, { a: { url: "https://fixture.test/video.mp4" } });
  engine.seek(1);
  engine.seek(2);
  ready({ canvasSink: { getCanvas: decode } });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(state.draw).toHaveBeenCalledOnce();
  expect(state.draw).toHaveBeenCalledWith({ time: 2 });
  expect(state.titles.mock.invocationCallOrder[0]).toBeGreaterThan(
    state.draw.mock.invocationCallOrder[0]!,
  );
  engine.dispose();
});

it("presents decoded frames during continuous playback instead of starving them on every clock tick", async () => {
  let finishFrame!: () => void;
  const firstFrame = new Promise<void>((resolve) => {
    finishFrame = resolve;
  });
  const decode = vi.fn(async (time: number) => {
    if (time === 1) await firstFrame;
    return { canvas: { time } };
  });
  state.ensure.mockResolvedValue({ canvasSink: { getCanvas: decode } });
  const engine = new PlaybackEngine(document.createElement("canvas"));
  const doc = assembleFromShotList({
    project: { id: "p", aspectRatio: "16:9", fps: 24 },
    shots: [
      {
        shotId: "s",
        sceneOrder: 0,
        shotOrder: 0,
        durationSec: 5,
        take: { takeId: "t", assetId: "a" },
      },
    ],
  });
  engine.setDocument(doc, { a: { url: "https://fixture.test/video.mp4" } });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  state.draw.mockClear();
  engine.renderFrame(1, false);
  for (let i = 0; i < 6; i++) await Promise.resolve();
  engine.renderFrame(2, false);
  finishFrame();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(state.draw.mock.calls.map((call) => call[0])).toEqual([
    { time: 1 },
    { time: 2 },
  ]);
  engine.dispose();
});
