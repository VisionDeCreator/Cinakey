/**
 * Playback engine: clock + compositor + video frames (WebCodecs via Mediabunny
 * CanvasSink when available, HTMLVideoElement fallback) + Web Audio.
 */

import type { TimelineDocument, TimelineClip } from "@cinakey/shared";
import { Compositor } from "./Compositor";
import { AudioGraph, textClipsAt, videoClipsAt } from "./AudioGraph";
import { MediaCache } from "./MediaCache";
import {
  evenDims,
  videoUrlForClip,
  type MediaUrlMap,
} from "../mediaUrls";

export type PlaybackState = {
  playing: boolean;
  currentSec: number;
  rate: number;
};

export class PlaybackEngine {
  readonly compositor: Compositor;
  readonly audio: AudioGraph;
  readonly cache: MediaCache;
  private doc: TimelineDocument | null = null;
  private urls: MediaUrlMap = {};
  private currentSec = 0;
  private playing = false;
  private rate = 1;
  private raf = 0;
  private lastWall = 0;
  private listeners = new Set<(s: PlaybackState) => void>();
  private previewLongEdge = 960;

  constructor(canvas: HTMLCanvasElement) {
    this.compositor = new Compositor(canvas);
    this.audio = new AudioGraph();
    this.cache = new MediaCache();
    this.cache.setAudioContext(this.audio.ctx);
  }

  setDocument(doc: TimelineDocument, urls: MediaUrlMap) {
    this.doc = doc;
    this.urls = urls;
    const { width, height } = evenDims(
      this.previewLongEdge,
      doc.project.aspectRatio,
    );
    this.compositor.resize(width, height);
    void this.prefetchAround(this.currentSec);
    this.renderFrame(this.currentSec);
  }

  subscribe(fn: (s: PlaybackState) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const s = {
      playing: this.playing,
      currentSec: this.currentSec,
      rate: this.rate,
    };
    for (const fn of this.listeners) fn(s);
  }

  getCurrentSec() {
    return this.currentSec;
  }

  isPlaying() {
    return this.playing;
  }

  async play() {
    if (!this.doc) return;
    await this.audio.resume();
    this.playing = true;
    this.lastWall = performance.now();
    await this.audio.schedule(
      this.doc,
      this.currentSec,
      this.urls,
      this.cache,
    );
    this.tick();
    this.emit();
  }

  pause() {
    this.playing = false;
    this.audio.stopAll();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  setRate(rate: number) {
    this.rate = rate;
    if (rate === 0) {
      this.pause();
    } else if (!this.playing) {
      void this.play();
    }
    this.emit();
  }

  seek(sec: number) {
    if (!this.doc) return;
    this.currentSec = clamp(sec, 0, this.doc.durationSec);
    if (this.playing) {
      void this.audio.schedule(
        this.doc,
        this.currentSec,
        this.urls,
        this.cache,
      );
      this.lastWall = performance.now();
    }
    void this.prefetchAround(this.currentSec);
    this.renderFrame(this.currentSec);
    this.emit();
  }

  private tick = () => {
    if (!this.playing || !this.doc) return;
    const now = performance.now();
    const dt = (now - this.lastWall) / 1000;
    this.lastWall = now;

    const audioT = this.audio.timelineSecNow();
    if (audioT !== null && this.rate === 1) {
      this.currentSec = audioT;
    } else {
      this.currentSec += dt * this.rate;
    }

    if (this.currentSec >= this.doc.durationSec) {
      this.currentSec = this.doc.durationSec;
      this.pause();
      this.renderFrame(this.currentSec);
      this.emit();
      return;
    }

    this.renderFrame(this.currentSec);
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  };

  renderFrame(t: number) {
    if (!this.doc) return;
    this.compositor.clear();
    const videos = videoClipsAt(this.doc.tracks, t);
    const top = videos[videos.length - 1];
    if (top) {
      void this.drawClip(top, t);
    }
    const texts = textClipsAt(this.doc.tracks, t);
    this.compositor.drawTitles(
      texts.map((clip) => ({
        clip,
        localT: t - clip.startSec,
      })),
    );
  }

  private async drawClip(clip: TimelineClip, t: number) {
    const url = videoUrlForClip(clip.source, this.urls, true);
    if (!url || clip.source.type === "text") return;
    const assetId =
      clip.source.type === "take"
        ? clip.source.proxyAssetId && this.urls[clip.source.proxyAssetId]
          ? clip.source.proxyAssetId
          : clip.source.assetId
        : clip.source.type === "asset"
          ? clip.source.assetId
          : null;
    if (!assetId) return;

    const media = await this.cache.ensure(
      assetId,
      videoUrlForClip(clip.source, this.urls, true) ?? url,
      "video",
    );

    const local = (t - clip.startSec) * clip.speed;
    const sourceT = clip.inSec + local;

    if (media.canvasSink) {
      try {
        const wrapped = await media.canvasSink.getCanvas(sourceT);
        if (wrapped) {
          this.compositor.drawMedia(wrapped.canvas);
          return;
        }
      } catch {
        /* fall through */
      }
    }

    if (media.imageEl) {
      this.compositor.drawMedia(media.imageEl);
      return;
    }

    const video = media.videoEl;
    if (!video) return;
    if (Math.abs(video.currentTime - sourceT) > 0.04) {
      try {
        video.currentTime = sourceT;
      } catch {
        /* */
      }
    }
    if (video.readyState >= 2) {
      this.compositor.drawMedia(video);
    }
  }

  private async prefetchAround(t: number) {
    if (!this.doc) return;
    const window = 8;
    for (const track of this.doc.tracks) {
      if (track.kind !== "video") continue;
      for (const clip of track.clips) {
        const end = clip.startSec + clip.durationSec;
        if (end < t - 1 || clip.startSec > t + window) continue;
        const url = videoUrlForClip(clip.source, this.urls, true);
        if (!url || clip.source.type === "text") continue;
        const id =
          clip.source.type === "take" && clip.source.proxyAssetId
            ? clip.source.proxyAssetId
            : clip.source.type === "take" || clip.source.type === "asset"
              ? clip.source.assetId
              : null;
        if (id) await this.cache.ensure(id, url, "video");
      }
    }
  }

  dispose() {
    this.pause();
    this.compositor.dispose();
    this.audio.dispose();
    this.cache.dispose();
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
