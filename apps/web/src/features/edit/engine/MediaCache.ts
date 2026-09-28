/**
 * Fetch and cache media blobs / decoded audio for timeline playback & export.
 */

import {
  ALL_FORMATS,
  Input,
  UrlSource,
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
  private cache = new Map<string, CachedMedia>();
  private audioCtx: AudioContext | null = null;

  setAudioContext(ctx: AudioContext) {
    this.audioCtx = ctx;
  }

  get(assetKey: string): CachedMedia | undefined {
    return this.cache.get(assetKey);
  }

  async ensure(
    assetKey: string,
    url: string,
    kindHint?: "video" | "audio" | "image",
  ): Promise<CachedMedia> {
    const existing = this.cache.get(assetKey);
    if (existing?.objectUrl || existing?.blob) return existing;

    const entry: CachedMedia = {
      url,
      kind: kindHint ?? guessKind(url),
    };
    this.cache.set(assetKey, entry);

    try {
      const res = await fetch(url);
      const blob = await res.blob();
      entry.blob = blob;
      entry.objectUrl = URL.createObjectURL(blob);
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
    } catch {
      // Leave entry with url only; callers may still try HTMLMediaElement.
      if (entry.kind === "video") {
        entry.videoEl = document.createElement("video");
        entry.videoEl.crossOrigin = "anonymous";
        entry.videoEl.muted = true;
        entry.videoEl.playsInline = true;
        entry.videoEl.preload = "auto";
        entry.videoEl.src = url;
      }
    }

    return entry;
  }

  /** Decode audio from an original media URL (video or audio file). */
  async ensureAudio(
    assetKey: string,
    url: string,
  ): Promise<AudioBuffer | null> {
    if (!this.audioCtx) return null;
    const key = `audio:${assetKey}`;
    const existing = this.cache.get(key);
    if (existing?.audioBuffer) return existing.audioBuffer;

    try {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const audioBuffer = await this.audioCtx.decodeAudioData(buf.slice(0));
      this.cache.set(key, {
        url,
        audioBuffer,
        kind: "audio",
      });
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
        source: new UrlSource(entry.url),
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

  dispose() {
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
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("loadeddata", done);
      resolve();
    };
    video.addEventListener("loadeddata", done);
    video.load();
  });
}
