import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { formatTimecode } from "@/features/blockout/editor/editorModel";
import {
  ShotRenderer,
  frameSize,
  type RenderableShot,
} from "@/features/blockout/editor/runtime/shotRenderer";

export type VideoClip = {
  shot: RenderableShot;
  shotLabel: string;
  sceneLabel: string;
};

export type VideoProgress = {
  frame: number;
  totalFrames: number;
  clipIndex: number;
  clipCount: number;
};

const CODEC_CANDIDATES = ["avc1.640028", "avc1.4d0028", "avc1.42e028", "avc1.42001f"];

export function webCodecsSupported(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
}

async function pickCodec(width: number, height: number, fps: number): Promise<VideoEncoderConfig> {
  for (const codec of CODEC_CANDIDATES) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      framerate: fps,
      bitrate: 6_000_000,
      avc: { format: "avc" },
    };
    const support = await VideoEncoder.isConfigSupported(config);
    if (support.supported) return config;
  }
  throw new Error("This browser cannot encode H.264 video");
}

export function framesForDuration(durationSec: number, fps: number): number {
  return Math.max(1, Math.round(durationSec * fps));
}

function drawBurnIn(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  clip: VideoClip,
  timecode: string,
) {
  const size = Math.max(12, Math.round(height * 0.035));
  const pad = Math.round(size * 0.6);
  const bar = size + pad * 2;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, height - bar, width, bar);
  ctx.font = `600 ${size}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fafafa";
  ctx.textAlign = "left";
  const y = height - bar / 2;
  ctx.fillText(`${clip.shotLabel}  ${clip.sceneLabel}`.slice(0, 80), pad, y);
  ctx.textAlign = "right";
  ctx.fillText(timecode, width - pad, y);
}

function abortError(): DOMException {
  return new DOMException("Export cancelled", "AbortError");
}

/**
 * Render clips frame by frame through Theatre at `fps` and encode them into
 * one H.264 MP4 (WebCodecs + mp4-muxer).
 */
export async function encodeClipsToMp4(input: {
  clips: VideoClip[];
  fps: number;
  aspect: number;
  longEdge?: number;
  burnIn: boolean;
  signal: AbortSignal;
  onProgress: (p: VideoProgress) => void;
}): Promise<Blob> {
  const { clips, fps, burnIn, signal } = input;
  const { width, height } = frameSize(input.aspect, input.longEdge ?? 1280);
  const config = await pickCodec(width, height, fps);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width, height, frameRate: fps },
    fastStart: "in-memory",
  });
  let encoderError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e;
    },
  });
  encoder.configure(config);

  const composite = document.createElement("canvas");
  composite.width = width;
  composite.height = height;
  const ctx = composite.getContext("2d")!;

  const totalFrames = clips.reduce((n, c) => n + framesForDuration(c.shot.durationSec, fps), 0);
  const frameDurationUs = 1_000_000 / fps;
  const gop = Math.max(1, Math.round(fps * 2));
  let frame = 0;

  try {
    for (const [clipIndex, clip] of clips.entries()) {
      const renderer = new ShotRenderer(clip.shot, fps, width, height);
      try {
        const n = framesForDuration(clip.shot.durationSec, fps);
        for (let i = 0; i < n; i++) {
          if (signal.aborted) throw abortError();
          if (encoderError) throw encoderError;
          ctx.drawImage(renderer.renderColor(i / fps), 0, 0);
          if (burnIn) drawBurnIn(ctx, width, height, clip, formatTimecode(frame / fps, fps));
          const videoFrame = new VideoFrame(composite, {
            timestamp: Math.round(frame * frameDurationUs),
            duration: Math.round(frameDurationUs),
          });
          encoder.encode(videoFrame, { keyFrame: frame % gop === 0 });
          videoFrame.close();
          frame += 1;
          while (encoder.encodeQueueSize > 6) {
            await new Promise((r) => setTimeout(r, 1));
          }
          if (i % 4 === 0) {
            input.onProgress({ frame, totalFrames, clipIndex, clipCount: clips.length });
            await new Promise((r) => setTimeout(r, 0));
          }
        }
      } finally {
        renderer.dispose();
      }
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    input.onProgress({ frame, totalFrames, clipIndex: clips.length - 1, clipCount: clips.length });
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}
