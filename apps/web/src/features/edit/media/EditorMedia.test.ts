import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorMedia } from "./EditorMedia";
const mock = vi.hoisted(() => ({
  init: vi.fn(),
  execute: vi.fn(),
  cancel: vi.fn(async () => {}),
  dispose: vi.fn(),
  width: 1920,
  height: 1080,
  duration: 4,
  video: true,
}));
vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  Mp4OutputFormat: class {},
  BufferTarget: class {
    buffer = new ArrayBuffer(10);
  },
  Output: class {},
  Input: class {
    computeDuration = async () => mock.duration;
    getPrimaryVideoTrack = async () =>
      mock.video
        ? {
            displayWidth: mock.width,
            displayHeight: mock.height,
            canDecode: async () => true,
          }
        : null;
    getPrimaryAudioTrack = async () => ({ canDecode: async () => true });
    dispose = mock.dispose;
  },
  CanvasSink: class {
    async *canvasesAtTimestamps(times: number[]) {
      for (const timestamp of times)
        yield { canvas: document.createElement("canvas"), timestamp };
    }
  },
  AudioBufferSink: class {
    async *buffers() {
      yield {
        timestamp: 0,
        buffer: {
          numberOfChannels: 1,
          sampleRate: 1,
          getChannelData: () => new Float32Array([0.5]),
        },
      };
    }
  },
  Conversion: { init: mock.init },
}));
let media: EditorMedia;
let onProxy: ReturnType<typeof vi.fn<(id: string, url: string) => void>>;
function response(length = 1) {
  return {
    ok: true,
    headers: new Headers(),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(length));
        controller.close();
      },
    }),
  };
}
beforeEach(() => {
  mock.width = 1920;
  mock.height = 1080;
  mock.duration = 4;
  mock.video = true;
  mock.execute.mockReset();
  mock.execute.mockResolvedValue(undefined);
  mock.dispose.mockClear();
  mock.cancel.mockClear();
  mock.init.mockReset();
  mock.init.mockImplementation(async () => ({
    isValid: true,
    execute: mock.execute,
    cancel: mock.cancel,
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:${Math.random()}`),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => callback(new Blob(["jpeg"])),
  );
  onProxy = vi.fn();
  media = new EditorMedia(onProxy);
});
afterEach(() => {
  media.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("deduplicates clips, streams waveforms and creates a muted full-source proxy", async () => {
  media.request("a", "https://fixture.test/a", "video");
  media.request("a", "https://fixture.test/a", "video");
  await vi.waitFor(() => expect(onProxy).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledOnce();
  expect(media.get("a").thumbnails).toHaveLength(16);
  expect(media.get("a").peaks[0]).toBe(0.5);
  expect(mock.init.mock.calls[0]![0]).toMatchObject({
    trim: { start: 0 },
    audio: { discard: true },
    copy: false,
    video: { width: 640, height: 360, frameRate: 24, keyFrameInterval: 1 },
  });
  const objectCount = vi.mocked(URL.createObjectURL).mock.calls.length;
  media.dispose();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(objectCount);
});
it("falls back to originals when encoding is unsupported and continues the queue", async () => {
  mock.init.mockResolvedValue({ isValid: false });
  media.request("a", "https://fixture.test/a", "video");
  media.request("b", "https://fixture.test/b", "video");
  await vi.waitFor(() => expect(mock.dispose).toHaveBeenCalledTimes(2));
  expect(media.get("b").status).toBe("ready");
  expect(media.get("a").proxyStatus).toBe("original");
  expect(onProxy).not.toHaveBeenCalled();
});
it("does not encode media with an existing proxy or low-resolution media", async () => {
  media.request("a", "https://fixture.test/a", "video", true);
  await vi.waitFor(() => expect(mock.dispose).toHaveBeenCalledTimes(1));
  mock.width = 640;
  mock.height = 360;
  media.request("small", "https://fixture.test/small", "video");
  await vi.waitFor(() => expect(mock.dispose).toHaveBeenCalledTimes(2));
  media.request("image", "https://fixture.test/image", "image");
  await vi.waitFor(() => expect(media.get("image").status).toBe("ready"));
  expect(mock.init).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("cancels active conversion, drops queued jobs and never publishes disposed proxies", async () => {
  let finish!: () => void;
  mock.execute.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  media.request("a", "https://fixture.test/a", "video");
  media.request("b", "https://fixture.test/b", "video");
  await vi.waitFor(() => expect(mock.execute).toHaveBeenCalledOnce());
  media.dispose();
  finish();
  await vi.waitFor(() => expect(mock.dispose).toHaveBeenCalledOnce());
  expect(mock.cancel).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
  expect(onProxy).not.toHaveBeenCalled();
});
it("bounds processing duration and rejects failed downloads without blocking later media", async () => {
  mock.duration = 301;
  media.request("long", "https://fixture.test/long", "video");
  await vi.waitFor(() => expect(media.get("long").status).toBe("unavailable"));
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
  media.request("missing", "https://fixture.test/missing", "audio");
  await vi.waitFor(() =>
    expect(media.get("missing").status).toBe("unavailable"),
  );
  expect(mock.init).not.toHaveBeenCalled();
});

it("reuses a playback source blob without a second media download", async () => {
  media.dispose();
  media = new EditorMedia(onProxy, async () => new Blob(["local fixture"]));
  media.request("cached", "https://fixture.test/cached", "video");
  await vi.waitFor(() => expect(onProxy).toHaveBeenCalledOnce());
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects oversized downloads before decoding", async () => {
  const cancel = vi.fn();
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    headers: new Headers({ "content-length": String(129 * 1024 * 1024) }),
    body: { cancel },
  } as unknown as Response);
  media.request("huge", "https://fixture.test/huge", "video");
  await vi.waitFor(() => expect(media.get("huge").status).toBe("unavailable"));
  expect(cancel).toHaveBeenCalledOnce();
  expect(mock.init).not.toHaveBeenCalled();
});
