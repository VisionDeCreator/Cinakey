/**
 * Fetch and cache media blobs / decoded audio for timeline playback & export.
 */

import {
  ALL_FORMATS,
  Input,
  BlobSource,
  CanvasSink,
  type InputVideoTrack,
} from "mediabunny";

export type CachedMedia = {
  url: string;
  blob?: Blob;
  objectUrl?: string;
  audioBuffer?: AudioBuffer;
  /** Mediabunny video sink for WebCodecs-backed frame access (when available). */
  canvasSink?: CanvasSink;
  input?: Input;
  videoTrack?: InputVideoTrack;
  videoEl?: HTMLVideoElement;
  imageEl?: HTMLImageElement;
  kind: "video" | "audio" | "image" | "unknown";
};

export class MediaCache {
  private pending = new Map<string, Promise<CachedMedia>>();
  private pendingAudio = new Map<string, Promise<AudioBuffer | null>>();
  private controller = new AbortController();
  private cache = new Map<string, CachedMedia>();
  constructor(private readonly signal?: AbortSignal) {}

  private audioCtx: AudioContext | null = null;

  setAudioContext(ctx: AudioContext) {
    this.audioCtx = ctx;
  }

  get(assetKey: string): CachedMedia | undefined {
    return this.cache.get(assetKey);
  }

  /** Let background analysis reuse an original already downloaded for playback. */
  async findBlob(url: string): Promise<Blob | undefined> {
    for (const [key, entry] of this.cache) {
      if (entry.url !== url) continue;
      if (entry.blob) return entry.blob;
      try {
        await this.pending.get(key);
      } catch {
        /* A decoder failure may still leave a usable source blob. */
      }
      return entry.blob;
    }
    return undefined;
  }

  ensure(
    assetKey: string,
    url: string,
    kindHint?: "video" | "audio" | "image",
  ): Promise<CachedMedia> {
    if (!this.pending.has(assetKey))
      this.pending.set(
        assetKey,
        this.load(assetKey, url, kindHint).finally(() =>
          this.pending.delete(assetKey),
        ),
      );
    return this.pending.get(assetKey)!;
  }

  private async load(
    assetKey: string,
    url: string,
    kindHint?: "video" | "audio" | "image",
  ): Promise<CachedMedia> {
    const existing = this.cache.get(assetKey);
    if (existing?.objectUrl || existing?.blob) {
      this.cache.delete(assetKey);
      this.cache.set(assetKey, existing);
      return existing;
    }

    const entry: CachedMedia = {
      url,
      kind: kindHint ?? guessKind(url),
    };
    this.cache.set(assetKey, entry);

    try {
      const res = await fetch(url, {
        signal: this.signal
          ? AbortSignal.any([this.controller.signal, this.signal])
          : this.controller.signal,
      });
      if (!res.ok) throw new Error(`Media download failed (${res.status})`);
      const blob = await res.blob();
      entry.blob = blob;
      entry.objectUrl = URL.createObjectURL(blob);
      if (blob.type.startsWith("image/")) entry.kind = "image";
      if (!kindHint) {
        if (blob.type.startsWith("video/")) entry.kind = "video";
        else if (blob.type.startsWith("audio/")) entry.kind = "audio";
        else if (blob.type.startsWith("image/")) entry.kind = "image";
      }

      if (entry.kind === "video") {
        await this.attachVideo(entry);
      } else if (entry.kind === "image") {
        entry.imageEl = await loadImage(entry.objectUrl);
      } else if (entry.kind === "audio" && this.audioCtx) {
        const buf = await blob.arrayBuffer();
        entry.audioBuffer = await this.audioCtx.decodeAudioData(buf.slice(0));
      }
    } catch (error) {
      this.cache.delete(assetKey);
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
      throw error;
    }

    this.trimCache(assetKey);
    return entry;
  }

  /** Decode audio from an original media URL (video or audio file). */
  ensureAudio(assetKey: string, url: string): Promise<AudioBuffer | null> {
    if (!this.pendingAudio.has(assetKey))
      this.pendingAudio.set(
        assetKey,
        this.loadAudio(assetKey, url).finally(() =>
          this.pendingAudio.delete(assetKey),
        ),
      );
    return this.pendingAudio.get(assetKey)!;
  }

  private async loadAudio(
    assetKey: string,
    url: string,
  ): Promise<AudioBuffer | null> {
    if (!this.audioCtx) return null;
    const key = `audio:${assetKey}`;
    const existing = this.cache.get(key);
    if (existing?.audioBuffer) return existing.audioBuffer;

    try {
      const pending = this.pending.get(assetKey);
      if (pending) await pending;
      const cachedBlob = this.cache.get(assetKey)?.blob;
      let buf: ArrayBuffer;
      if (cachedBlob) buf = await cachedBlob.arrayBuffer();
      else {
        const res = await fetch(url, {
          signal: this.signal
            ? AbortSignal.any([this.controller.signal, this.signal])
            : this.controller.signal,
        });
        if (!res.ok) throw new Error(`Media download failed (${res.status})`);
        buf = await res.arrayBuffer();
      }
      const audioBuffer = await this.audioCtx.decodeAudioData(buf.slice(0));
      this.cache.set(key, {
        url,
        audioBuffer,
        kind: "audio",
      });
      this.trimCache(key);
      return audioBuffer;
    } catch {
      return null;
    }
  }

  private async attachVideo(entry: CachedMedia) {
    // Prefer HTML video for reliable scrubbing of WebM proxies; also try Mediabunny.
    entry.videoEl = document.createElement("video");
    entry.videoEl.crossOrigin = "anonymous";
    entry.videoEl.muted = true;
    entry.videoEl.playsInline = true;
    entry.videoEl.preload = "auto";
    entry.videoEl.src = entry.objectUrl ?? entry.url;
    await waitForLoaded(entry.videoEl);

    try {
      const input = new Input({
        source: new BlobSource(entry.blob!),
        formats: ALL_FORMATS,
      });
      const videoTrack = await input.getPrimaryVideoTrack();
      if (videoTrack) {
        const canDecode = await videoTrack.canDecode();
        if (canDecode) {
          entry.input = input;
          entry.videoTrack = videoTrack;
          entry.canvasSink = new CanvasSink(videoTrack, {
            poolSize: 2,
          });
        } else {
          input.dispose();
        }
      } else {
        input.dispose();
      }
    } catch {
      // WebCodecs path unavailable; HTML video fallback is fine.
    }
  }

  /** Keep cached blobs/decoded buffers bounded. Scheduled audio owns its own buffer references. */
  private trimCache(keep: string) {
    const bytes = () =>
      [...this.cache.values()].reduce(
        (sum, entry) =>
          sum +
          (entry.blob?.size ?? 0) +
          (entry.audioBuffer
            ? entry.audioBuffer.length * entry.audioBuffer.numberOfChannels * 4
            : 0),
        0,
      );
    for (const [key, entry] of this.cache) {
      if (this.cache.size <= 32 && bytes() <= 256 * 1024 * 1024) break;
      if (
        key === keep ||
        this.pending.has(key) ||
        this.pendingAudio.has(key.replace(/^audio:/, ""))
      )
        continue;
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
      entry.input?.dispose();
      entry.videoEl?.removeAttribute("src");
      entry.videoEl?.load();
      this.cache.delete(key);
    }
  }

  dispose() {
    this.controller.abort();
    for (const entry of this.cache.values()) {
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
      entry.input?.dispose();
      entry.videoEl?.removeAttribute("src");
      entry.videoEl?.load();
    }
    this.cache.clear();
  }
}

function guessKind(url: string): CachedMedia["kind"] {
  const lower = url.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/.test(lower)) return "image";
  if (/\.(mp3|wav|ogg|m4a|aac)(\?|$)/.test(lower)) return "audio";
  if (/\.(mp4|webm|mov|m4v)(\?|$)/.test(lower)) return "video";
  return "unknown";
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}

function waitForLoaded(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadeddata", done);
      video.removeEventListener("error", fail);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("Video could not be decoded"));
    };
    const timer = setTimeout(fail, 15_000);
    video.addEventListener("loadeddata", done, { once: true });
    video.addEventListener("error", fail, { once: true });
    video.load();
  });
}
