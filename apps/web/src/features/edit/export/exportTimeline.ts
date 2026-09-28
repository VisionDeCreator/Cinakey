/**
 * In-browser timeline MP4 export via Mediabunny (WebCodecs H.264 + AAC).
 * Caps: 1080p long edge, 5 minutes.
 */

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import {
  TIMELINE_EXPORT_MAX_DURATION_SEC,
  TIMELINE_EXPORT_MAX_LONG_EDGE,
  type TimelineDocument,
  type TimelineClip,
} from "@cinakey/shared";
import { evenDims, videoUrlForClip, type MediaUrlMap } from "../mediaUrls";
import { MediaCache } from "../engine/MediaCache";
import { textClipsAt, videoClipsAt } from "../engine/AudioGraph";

export type ExportProgress = {
  phase: "prepare" | "video" | "audio" | "finalize";
  frame: number;
  totalFrames: number;
  message: string;
};

export function exportCapsOk(doc: TimelineDocument): string | null {
  if (doc.durationSec > TIMELINE_EXPORT_MAX_DURATION_SEC) {
    return `Timeline exceeds MVP export cap of ${TIMELINE_EXPORT_MAX_DURATION_SEC / 60} minutes (${doc.durationSec.toFixed(1)}s).`;
  }
  return null;
}

export async function webCodecsExportSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("VideoEncoder" in window) || !("AudioEncoder" in window)) return false;
  const v = await canEncodeVideo("avc");
  const a = await canEncodeAudio("aac");
  return Boolean(v && a);
}

export async function exportTimelineMp4(opts: {
  doc: TimelineDocument;
  urls: MediaUrlMap;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
  longEdge?: number;
}): Promise<Blob> {
  const cap = exportCapsOk(opts.doc);
  if (cap) throw new Error(cap);
  if (!(await webCodecsExportSupported())) {
    throw new Error(
      "This browser cannot encode H.264 + AAC. Use a Chromium-based browser.",
    );
  }

  const doc = opts.doc;
  const fps = doc.project.fps;
  const longEdge = Math.min(
    opts.longEdge ?? TIMELINE_EXPORT_MAX_LONG_EDGE,
    TIMELINE_EXPORT_MAX_LONG_EDGE,
  );
  const { width, height } = evenDims(longEdge, doc.project.aspectRatio);
  const totalFrames = Math.max(1, Math.round(doc.durationSec * fps));
  const frameDur = 1 / fps;

  opts.onProgress?.({
    phase: "prepare",
    frame: 0,
    totalFrames,
    message: "Preparing media…",
  });

  const cache = new MediaCache();
  const audioCtx = new AudioContext({ sampleRate: 48000 });
  cache.setAudioContext(audioCtx);

  // Prefetch original video/audio for all clips
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (clip.source.type === "text") continue;
      const url = videoUrlForClip(clip.source, opts.urls, false);
      const assetId =
        clip.source.type === "take" || clip.source.type === "asset"
          ? clip.source.assetId
          : null;
      if (assetId && url) {
        const kind =
          track.kind === "music" || track.kind === "sfx" ? "audio" : "video";
        await cache.ensure(assetId, url, kind);
        await cache.ensureAudio(assetId, opts.urls[assetId]?.url ?? url);
      }
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx2d = canvas.getContext("2d")!;

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });

  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    quality: QUALITY_HIGH,
  });
  output.addVideoTrack(videoSource, { frameRate: fps });

  const mixed = await mixAudioOffline(doc, opts.urls, cache, audioCtx.sampleRate);
  if (mixed) {
    const audioSource = new AudioBufferSource({
      codec: "aac",
      quality: QUALITY_HIGH,
    });
    output.addAudioTrack(audioSource);
    await output.start();
    await audioSource.add(mixed);
    audioSource.close();
  } else {
    await output.start();
  }

  opts.onProgress?.({
    phase: "video",
    frame: 0,
    totalFrames,
    message: "Encoding video…",
  });

  for (let i = 0; i < totalFrames; i++) {
    if (opts.signal?.aborted) {
      await output.cancel();
      cache.dispose();
      await audioCtx.close();
      throw new DOMException("Aborted", "AbortError");
    }
    const t = i * frameDur;
    await paintFrame(ctx2d, width, height, doc, t, opts.urls, cache);
    await videoSource.add(t, frameDur);
    if (i % 5 === 0 || i === totalFrames - 1) {
      opts.onProgress?.({
        phase: "video",
        frame: i + 1,
        totalFrames,
        message: `Encoding frame ${i + 1} / ${totalFrames}`,
      });
    }
  }
  videoSource.close();

  opts.onProgress?.({
    phase: "finalize",
    frame: totalFrames,
    totalFrames,
    message: "Finalizing MP4…",
  });
  await output.finalize();
  cache.dispose();
  await audioCtx.close();

  const buffer = target.buffer;
  if (!buffer) throw new Error("Export produced empty buffer");
  return new Blob([buffer], { type: "video/mp4" });
}

async function paintFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  doc: TimelineDocument,
  t: number,
  urls: MediaUrlMap,
  cache: MediaCache,
) {
  ctx.fillStyle = "#0a0a0b";
  ctx.fillRect(0, 0, w, h);

  const videos = videoClipsAt(doc.tracks, t);
  const clip = videos[videos.length - 1];
  if (clip) {
    await drawClipToCanvas(ctx, w, h, clip, t, urls, cache);
  }

  const texts = textClipsAt(doc.tracks, t);
  for (const textClip of texts) {
    if (textClip.source.type !== "text") continue;
    drawTitleOverlay(ctx, w, h, textClip);
  }
}

async function drawClipToCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  clip: TimelineClip,
  t: number,
  urls: MediaUrlMap,
  cache: MediaCache,
) {
  if (clip.source.type === "text") return;
  const assetId = clip.source.assetId;
  const url = videoUrlForClip(clip.source, urls, false);
  if (!url) return;
  const media = await cache.ensure(assetId, url, "video");
  const local = (t - clip.startSec) * clip.speed;
  const sourceT = clip.inSec + local;

  if (media.canvasSink) {
    try {
      const wrapped = await media.canvasSink.getCanvas(sourceT);
      if (wrapped) {
        drawCover(ctx, wrapped.canvas, w, h);
        return;
      }
    } catch {
      /* */
    }
  }

  if (media.imageEl) {
    drawCover(ctx, media.imageEl, w, h);
    return;
  }

  const video = media.videoEl;
  if (!video) return;
  if (Math.abs(video.currentTime - sourceT) > 0.02) {
    await seekVideo(video, sourceT);
  }
  if (video.readyState >= 2) {
    drawCover(ctx, video, w, h);
  }
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  w: number,
  h: number,
) {
  const sw =
    "videoWidth" in source && typeof source.videoWidth === "number"
      ? source.videoWidth || w
      : "naturalWidth" in source && typeof source.naturalWidth === "number"
        ? source.naturalWidth || w
        : "width" in source && typeof source.width === "number"
          ? Number(source.width) || w
          : w;
  const sh =
    "videoHeight" in source && typeof source.videoHeight === "number"
      ? source.videoHeight || h
      : "naturalHeight" in source && typeof source.naturalHeight === "number"
        ? source.naturalHeight || h
        : "height" in source && typeof source.height === "number"
          ? Number(source.height) || h
          : h;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function drawTitleOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  clip: TimelineClip,
) {
  if (clip.source.type !== "text") return;
  const styleId = clip.source.styleId;
  const lines =
    clip.source.lines && clip.source.lines.length > 0
      ? clip.source.lines.map((l) =>
          l.characterName ? `${l.characterName}: ${l.text}` : l.text,
        )
      : [clip.source.text];
  const fontSize = Math.max(18, Math.round(h * (styleId === "caption" ? 0.045 : 0.06)));
  ctx.font = `600 ${fontSize}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fafafa";
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = Math.max(2, fontSize * 0.08);

  if (styleId === "centered") {
    ctx.textAlign = "center";
    const startY = h * 0.5 - ((lines.length - 1) * fontSize * 1.2) / 2;
    lines.forEach((line, i) => {
      const y = startY + i * fontSize * 1.2;
      ctx.strokeText(line, w / 2, y);
      ctx.fillText(line, w / 2, y);
    });
  } else if (styleId === "lower-third") {
    ctx.textAlign = "left";
    const pad = Math.round(w * 0.04);
    const barH = fontSize * lines.length * 1.35 + pad;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, h - barH, w * 0.55, barH);
    ctx.fillStyle = "#fafafa";
    lines.forEach((line, i) => {
      const y = h - barH + pad * 0.7 + i * fontSize * 1.25 + fontSize * 0.5;
      ctx.fillText(line, pad, y);
    });
  } else {
    ctx.textAlign = "center";
    const pad = Math.round(h * 0.04);
    const blockH = lines.length * fontSize * 1.25 + pad;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(w * 0.1, h - blockH - pad, w * 0.8, blockH);
    ctx.fillStyle = "#fafafa";
    lines.forEach((line, i) => {
      const y =
        h - blockH - pad + pad * 0.6 + i * fontSize * 1.25 + fontSize * 0.5;
      ctx.strokeText(line, w / 2, y);
      ctx.fillText(line, w / 2, y);
    });
  }
}

function seekVideo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    try {
      video.currentTime = t;
    } catch {
      resolve();
    }
  });
}

async function mixAudioOffline(
  doc: TimelineDocument,
  urls: MediaUrlMap,
  cache: MediaCache,
  sampleRate: number,
): Promise<AudioBuffer | null> {
  const duration = Math.max(0.1, doc.durationSec);
  const length = Math.ceil(duration * sampleRate);
  const offline = new OfflineAudioContext(2, length, sampleRate);

  const dialogueRanges: Array<{ start: number; end: number }> = [];
  for (const track of doc.tracks) {
    if (track.kind !== "dialogue" || track.muted) continue;
    for (const clip of track.clips) {
      dialogueRanges.push({
        start: clip.startSec,
        end: clip.startSec + clip.durationSec,
      });
    }
  }

  let scheduled = 0;
  for (const track of doc.tracks) {
    if (track.muted) continue;
    if (track.kind !== "video" && track.kind !== "music" && track.kind !== "sfx")
      continue;
    for (const clip of track.clips) {
      if (clip.source.type === "text") continue;
      const assetId = clip.source.assetId;
      const url = urls[assetId]?.url;
      if (!url) continue;
      const buffer = await cache.ensureAudio(assetId, url);
      if (!buffer) continue;

      const src = offline.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = clip.speed;
      const gain = offline.createGain();
      const baseVol = clip.volume ?? 1;
      const when = clip.startSec;
      const remain = clip.durationSec;
      const fadeIn = Math.min(clip.fadeInSec ?? 0, remain / 2);
      const fadeOut = Math.min(clip.fadeOutSec ?? 0, remain / 2);

      if (fadeIn > 0) {
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(baseVol, when + fadeIn);
      } else {
        gain.gain.setValueAtTime(baseVol, when);
      }
      if (fadeOut > 0) {
        gain.gain.setValueAtTime(baseVol, when + remain - fadeOut);
        gain.gain.linearRampToValueAtTime(0, when + remain);
      }

      if (track.kind === "music") {
        for (const d of dialogueRanges) {
          const o0 = Math.max(clip.startSec, d.start);
          const o1 = Math.min(clip.startSec + remain, d.end);
          if (o1 <= o0) continue;
          gain.gain.setValueAtTime(baseVol, Math.max(when, o0 - 0.05));
          gain.gain.linearRampToValueAtTime(baseVol * 0.25, o0);
          gain.gain.setValueAtTime(baseVol * 0.25, o1);
          gain.gain.linearRampToValueAtTime(baseVol, o1 + 0.05);
        }
      }

      src.connect(gain);
      gain.connect(offline.destination);
      try {
        src.start(when, clip.inSec, remain * clip.speed);
        scheduled += 1;
      } catch {
        /* */
      }
    }
  }

  if (scheduled === 0) return null;
  return await offline.startRendering();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
