/**
 * Browser-side lightweight playback proxies for takes.
 * Downloads the take video, encodes a low-res proxy, uploads via storage.
 */

type AttachArgs = {
  takeId: string;
  createUploadUrl: () => Promise<string>;
  createAssetFromUpload: (args: {
    projectId: string;
    storageId: string;
    type: "video";
    name: string;
    format: string;
    sizeBytes?: number;
    shotId?: string;
    tags?: string[];
    durationSec?: number;
  }) => Promise<string>;
  attachTakeProxy: (args: {
    takeId: string;
    proxyAssetId: string;
    clippedAssetId?: string;
  }) => Promise<void>;
  projectId: string;
  shotId: string;
  sourceUrl: string;
  trimStartSec?: number;
  trimEndSec?: number;
};

/**
 * Generate a low-res proxy by capturing frames to canvas and re-encoding
 * with MediaRecorder (WebM). Falls back silently if unsupported.
 */
export async function generateAndUploadProxy(
  args: AttachArgs,
): Promise<{ proxyAssetId: string } | null> {
  if (typeof document === "undefined") return null;

  try {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.src = args.sourceUrl;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Failed to load video for proxy"));
    });

    const start = args.trimStartSec ?? 0;
    const end =
      args.trimEndSec ??
      (Number.isFinite(video.duration) ? video.duration : start + 2);
    const duration = Math.max(0.2, end - start);

    video.currentTime = start;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    const targetW = 480;
    const scale = Math.min(1, targetW / (video.videoWidth || targetW));
    const w = Math.max(2, Math.round((video.videoWidth || targetW) * scale));
    const h = Math.max(2, Math.round((video.videoHeight || 270) * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return null;

    const stream = canvas.captureStream(12);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm;codecs=vp8"
      : "video/webm";
    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 400_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const stopped = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: mime }));
      };
    });

    recorder.start(100);
    await video.play().catch(() => undefined);

    const draw = () => {
      if (video.currentTime >= end || video.ended || video.paused) {
        if (recorder.state === "recording") recorder.stop();
        video.pause();
        return;
      }
      ctx2d.drawImage(video, 0, 0, w, h);
      requestAnimationFrame(draw);
    };
    draw();

    setTimeout(() => {
      if (recorder.state === "recording") {
        recorder.stop();
        video.pause();
      }
    }, Math.ceil(duration * 1000) + 2000);

    const blob = await stopped;
    if (blob.size < 100) return null;

    const uploadUrl = await args.createUploadUrl();
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": blob.type || "video/webm" },
      body: blob,
    });
    if (!res.ok) throw new Error(`Proxy upload failed: ${res.status}`);
    const { storageId } = (await res.json()) as { storageId: string };

    const proxyAssetId = await args.createAssetFromUpload({
      projectId: args.projectId,
      storageId,
      type: "video",
      name: `proxy-${args.takeId}`,
      format: blob.type || "video/webm",
      sizeBytes: blob.size,
      shotId: args.shotId,
      tags: ["proxy", "playback"],
      durationSec: duration,
    });

    await args.attachTakeProxy({
      takeId: args.takeId,
      proxyAssetId,
    });

    return { proxyAssetId };
  } catch {
    return null;
  }
}
