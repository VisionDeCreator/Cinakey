/**
 * Playback engine: clock + compositor + video frames (WebCodecs via Mediabunny
 * CanvasSink when available, HTMLVideoElement fallback) + Web Audio.
 */

import type { TimelineDocument, TimelineClip } from "@cinakey/shared";
import { seekMediaFrame } from "./mediaSeek";
import { Compositor } from "./Compositor";
import { AudioGraph, textClipsAt, videoClipsAt } from "./AudioGraph";
import { MediaCache } from "./MediaCache";
import {
  evenDims,
  videoUrlForClip,
  videoCacheKeyForClip,
  type MediaUrlMap,
} from "../mediaUrls";

export type PlaybackState = {
  playing: boolean;
  currentSec: number;
  rate: number;
  error?: string;
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
  private renderRevision = 0;
  private transportRevision = 0;
  private pendingFrame: { t: number; revision: number } | null = null;
  private rendering = false;
  private error: string | undefined;
  private reportError = (error: unknown) => {
    if (!this.disposed) {
      this.error =
        error instanceof Error
          ? error.message
          : "Preview media could not be loaded";
      this.pause();
    }
  };
  private disposed = false;
  private previewLongEdge = 960;

  constructor(canvas: HTMLCanvasElement) {
    this.compositor = new Compositor(canvas);
    this.audio = new AudioGraph();
    this.cache = new MediaCache();
    this.cache.setAudioContext(this.audio.ctx);
  }

  setDocument(doc: TimelineDocument, urls: MediaUrlMap) {
    const changed = this.doc !== doc;
    this.doc = doc;
    this.urls = urls;
    const { width, height } = evenDims(
      this.previewLongEdge,
      doc.project.aspectRatio,
    );
    this.compositor.resize(width, height);
    void this.prefetchAround(this.currentSec).catch(this.reportError);
    this.renderFrame(this.currentSec);
    if (changed && this.playing && this.rate === 1)
      void this.audio
        .schedule(doc, this.currentSec, urls, this.cache)
        .catch(this.reportError);
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
      error: this.error,
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
    if (this.playing) return;
    this.error = undefined;
    const revision = ++this.transportRevision;
    await this.audio.resume();
    if (revision !== this.transportRevision) return;
    this.playing = true;
    this.lastWall = performance.now();
    if (this.rate === 1)
      await this.audio.schedule(
        this.doc,
        this.currentSec,
        this.urls,
        this.cache,
      );
    if (!this.playing || revision !== this.transportRevision) return;
    this.lastWall = performance.now();
    this.tick();
    this.emit();
  }

  pause() {
    this.transportRevision++;
    this.playing = false;
    this.audio.stopAll();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play().catch(this.reportError);
  }

  setRate(rate: number) {
    this.rate = rate;
    if (rate !== 1) this.audio.stopAll();
    if (rate === 0) {
      this.pause();
    } else if (!this.playing) {
      void this.play().catch(this.reportError);
    }
    if (rate === 1 && this.playing && this.doc)
      void this.audio
        .schedule(this.doc, this.currentSec, this.urls, this.cache)
        .catch(this.reportError);
    this.emit();
  }

  seek(sec: number) {
    if (!this.doc) return;
    this.currentSec = clamp(sec, 0, this.doc.durationSec);
    if (this.playing) {
      if (this.rate === 1)
        void this.audio
          .schedule(this.doc, this.currentSec, this.urls, this.cache)
          .catch(this.reportError);
      else this.audio.stopAll();
      this.lastWall = performance.now();
    }
    void this.prefetchAround(this.currentSec).catch(this.reportError);
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

    if (this.currentSec >= this.doc.durationSec || this.currentSec < 0) {
      this.currentSec = clamp(this.currentSec, 0, this.doc.durationSec);
      this.pause();
      // Hold the last visible frame rather than clearing the preview at the exclusive end.
      this.renderFrame(
        this.currentSec >= this.doc.durationSec
          ? Math.max(0, this.doc.durationSec - 1 / this.doc.project.fps)
          : this.currentSec,
      );
      this.emit();
      return;
    }

    this.renderFrame(this.currentSec, false);
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  };

  renderFrame(t: number, invalidate = true) {
    if (!this.doc || this.disposed) return;
    // Clock ticks coalesce, but must not invalidate every decode that takes longer
    // than one animation frame. Only seeks/document changes supersede that work.
    if (invalidate) this.renderRevision++;
    this.pendingFrame = { t, revision: this.renderRevision };
    if (this.rendering) return;
    this.rendering = true;
    void (async () => {
      try {
        while (this.pendingFrame && !this.disposed) {
          const { t: time, revision } = this.pendingFrame;
          this.pendingFrame = null;
          const videos = videoClipsAt(this.doc!.tracks, time);
          const top = videos[videos.length - 1];
          if (top) await this.drawClip(top, time, revision);
          else this.compositor.clear();
          if (revision !== this.renderRevision || this.disposed) continue;
          this.compositor.drawTitles(
            textClipsAt(this.doc!.tracks, time).map((clip) => ({
              clip,
              localT: time - clip.startSec,
            })),
          );
        }
      } catch (error) {
        this.reportError(error);
      } finally {
        this.rendering = false;
      }
    })();
  }

  private async drawClip(clip: TimelineClip, t: number, revision: number) {
    const url = videoUrlForClip(clip.source, this.urls, true);
    if (!url || clip.source.type === "text") return;
    const key = videoCacheKeyForClip(clip.source, this.urls);
    if (!key) return;
    const media = await this.cache.ensure(key, url, "video");

    if (revision !== this.renderRevision || this.disposed) return;
    const local = (t - clip.startSec) * clip.speed;
    const sourceT = clip.inSec + local;

    if (media.canvasSink) {
      try {
        const wrapped = await media.canvasSink.getCanvas(sourceT);
        if (wrapped && revision === this.renderRevision && !this.disposed) {
          this.presentMedia(wrapped.canvas);
          return;
        }
      } catch {
        /* fall through */
      }
    }

    if (media.imageEl) {
      this.presentMedia(media.imageEl);
      return;
    }

    const video = media.videoEl;
    if (!video) return;
    await seekMediaFrame(video, sourceT);
    if (
      revision === this.renderRevision &&
      !this.disposed &&
      video.readyState >= 2
    )
      this.presentMedia(video);
  }

  private presentMedia(source: TexImageSource) {
    // Keep the current frame visible while the next one decodes.
    this.compositor.clear();
    this.compositor.drawMedia(source);
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
        const key = videoCacheKeyForClip(clip.source, this.urls);
        if (key) await this.cache.ensure(key, url, "video");
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.renderRevision++;
    this.pendingFrame = null;
    this.pause();
    this.compositor.dispose();
    this.audio.dispose();
    this.cache.dispose();
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
