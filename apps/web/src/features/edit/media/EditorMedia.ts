import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
import { addPeaks, proxyDimensions } from "./analysis";

export type MediaAnalysis = {
  status: "queued" | "processing" | "ready" | "unavailable";
  duration: number;
  thumbnails: { time: number; url: string }[];
  peaks: number[];
  proxyUrl?: string;
  proxyStatus?: "creating" | "ready" | "original";
};
const EMPTY: MediaAnalysis = {
  status: "queued",
  duration: 0,
  thumbnails: [],
  peaks: [],
};
const MAX_BYTES = 128 * 1024 * 1024;

/** Project-session cache. Never uploads derivatives or rewrites saved source references. */
export class EditorMedia {
  private entries = new Map<string, MediaAnalysis>();
  private listeners = new Set<() => void>();
  private tail = Promise.resolve();
  private controller = new AbortController();
  private objects: string[] = [];
  private conversion?: Conversion;
  private retainedBytes = 0;
  private disposed = false;

  constructor(
    private onProxy: (id: string, url: string) => void,
    private findBlob?: (url: string) => Promise<Blob | undefined>,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get = (id: string) => this.entries.get(id) ?? EMPTY;
  private publish(id: string, value: MediaAnalysis) {
    if (this.disposed) return;
    this.entries.set(id, value);
    this.listeners.forEach((listener) => listener());
  }
  request(id: string, url: string, type: string, existingProxy = false) {
    if (this.disposed || !url || this.entries.has(id)) return;
    if (this.entries.size >= 256) return;
    this.entries.set(id, EMPTY);
    // One decoder/encoder at a time; duplicate clips reuse the same result.
    this.tail = this.tail.then(async () => {
      if (this.disposed) return;
      this.publish(id, { ...EMPTY, status: "processing" });
      try {
        await this.process(id, url, type, existingProxy);
      } catch {
        this.publish(id, {
          ...this.get(id),
          status: "unavailable",
          proxyStatus: "original",
        });
      }
    });
  }
  private object(blob: Blob) {
    this.controller.signal.throwIfAborted();
    const url = URL.createObjectURL(blob);
    this.objects.push(url);
    return url;
  }
  private async download(url: string): Promise<Blob> {
    const response = await fetch(url, {
      signal: AbortSignal.any([
        this.controller.signal,
        AbortSignal.timeout(30_000),
      ]),
    });
    if (!response.ok) throw new Error("Media unavailable");
    if (Number(response.headers.get("content-length")) > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error("Media too large for background processing");
    }
    // Bound downloads even when the server omits Content-Length.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Streaming media unavailable");
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Media too large for background processing");
      }
      chunks.push(new Uint8Array(value));
    }
    return new Blob(chunks);
  }
  private async process(
    id: string,
    url: string,
    type: string,
    existingProxy: boolean,
  ) {
    if (type === "image") {
      this.publish(id, {
        ...EMPTY,
        status: "ready",
        thumbnails: [{ time: 0, url }],
      });
      return;
    }
    if (this.retainedBytes >= MAX_BYTES)
      throw new Error("Session media cache full");
    const blob = (await this.findBlob?.(url)) ?? (await this.download(url));
    this.controller.signal.throwIfAborted();
    if (blob.size > MAX_BYTES)
      throw new Error("Media too large for background processing");
    const input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    });
    try {
      const duration = await input.computeDuration();
      if (!Number.isFinite(duration) || duration <= 0 || duration > 300)
        throw new Error("Media exceeds background processing limit");
      const result: MediaAnalysis = {
        status: "processing",
        duration,
        thumbnails: [],
        peaks: [],
      };
      const video = await input.getPrimaryVideoTrack();
      if (video && (await video.canDecode())) {
        const sink = new CanvasSink(video, {
          width: 160,
          height: 90,
          fit: "contain",
          poolSize: 1,
        });
        const times = Array.from({ length: 16 }, (_, i) => (duration * i) / 16);
        for await (const frame of sink.canvasesAtTimestamps(times)) {
          this.controller.signal.throwIfAborted();
          if (!frame) continue;
          const canvas = document.createElement("canvas");
          canvas.width = 160;
          canvas.height = 90;
          canvas.getContext("2d")!.drawImage(frame.canvas, 0, 0);
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", 0.65),
          );
          if (blob) {
            this.retainedBytes += blob.size;
            result.thumbnails.push({
              time: frame.timestamp,
              url: this.object(blob),
            });
          }
        }
        this.publish(id, { ...result });
      }
      // Decode incrementally rather than retaining a full uncompressed audio buffer.
      try {
        const audio = await input.getPrimaryAudioTrack();
        if (audio && (await audio.canDecode())) {
          result.peaks = Array<number>(2048).fill(0);
          for await (const { buffer, timestamp } of new AudioBufferSink(
            audio,
          ).buffers()) {
            this.controller.signal.throwIfAborted();
            addPeaks(
              result.peaks,
              Array.from({ length: buffer.numberOfChannels }, (_, c) =>
                buffer.getChannelData(c),
              ),
              buffer.sampleRate,
              timestamp,
              duration,
            );
          }
        }
      } catch {
        result.peaks = [];
      }
      this.controller.signal.throwIfAborted();
      const needsProxy =
        video &&
        Math.max(video.displayWidth, video.displayHeight) > 960 &&
        !existingProxy;
      this.publish(id, {
        ...result,
        status: "ready",
        proxyStatus: needsProxy ? "creating" : "original",
      });
      if (needsProxy) {
        try {
          const target = new BufferTarget();
          const output = new Output({ format: new Mp4OutputFormat(), target });
          const conversion = await Conversion.init({
            input,
            output,
            tracks: "primary",
            copy: false,
            video: {
              ...proxyDimensions(video.displayWidth, video.displayHeight),
              codec: "avc",
              bitrate: 800_000,
              frameRate: 24,
              keyFrameInterval: 1,
              allowTransformationMetadata: false,
            },
            audio: { discard: true },
            trim: { start: 0 },
            showWarnings: false,
          });
          this.conversion = conversion;
          this.controller.signal.throwIfAborted();
          if (!conversion.isValid) throw new Error("Encoding unsupported");
          await conversion.execute();
          this.controller.signal.throwIfAborted();
          if (
            !target.buffer ||
            this.retainedBytes + target.buffer.byteLength > MAX_BYTES
          )
            throw new Error("Proxy cache full");
          this.retainedBytes += target.buffer.byteLength;
          const proxyUrl = this.object(
            new Blob([target.buffer], { type: "video/mp4" }),
          );
          this.publish(id, {
            ...result,
            status: "ready",
            proxyStatus: "ready",
            proxyUrl,
          });
          this.onProxy(id, proxyUrl);
        } catch {
          this.publish(id, {
            ...result,
            status: "ready",
            proxyStatus: "original",
          });
        } finally {
          this.conversion = undefined;
        }
      }
    } finally {
      input.dispose();
    }
  }
  dispose() {
    this.disposed = true;
    this.controller.abort();
    void this.conversion?.cancel().catch(() => {});
    this.objects.forEach((url) => URL.revokeObjectURL(url));
    this.objects = [];
    this.entries.clear();
    this.listeners.clear();
  }
}
