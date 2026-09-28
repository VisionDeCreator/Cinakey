/**
 * Resolve media URLs for timeline clips from Convex asset/take lookups.
 */

export type MediaUrlMap = Record<
  string,
  { url: string; proxyUrl?: string; durationSec?: number; type?: string }
>;

export function videoUrlForClip(
  source: { type: string; assetId?: string; proxyAssetId?: string },
  urls: MediaUrlMap,
  preferProxy: boolean,
): string | null {
  if (source.type === "take" || source.type === "asset") {
    const assetId = source.assetId;
    if (!assetId) return null;
    const entry = urls[assetId];
    if (!entry) return null;
    if (preferProxy) {
      const proxyId =
        source.type === "take" && "proxyAssetId" in source
          ? (source as { proxyAssetId?: string }).proxyAssetId
          : undefined;
      if (proxyId && urls[proxyId]?.url) return urls[proxyId]!.url;
      if (entry.proxyUrl) return entry.proxyUrl;
    }
    return entry.url;
  }
  return null;
}

export function audioUrlForClip(
  source: { type: string; assetId?: string },
  urls: MediaUrlMap,
): string | null {
  if (source.type === "take" || source.type === "asset") {
    const assetId = source.assetId;
    if (!assetId) return null;
    return urls[assetId]?.url ?? null;
  }
  return null;
}

export function parseAspect(aspectRatio: string): { w: number; h: number } {
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(aspectRatio.trim());
  if (!m) return { w: 16, h: 9 };
  return { w: Number(m[1]), h: Number(m[2]) };
}

export function evenDims(
  longEdge: number,
  aspectRatio: string,
): { width: number; height: number } {
  const { w, h } = parseAspect(aspectRatio);
  let width: number;
  let height: number;
  if (w >= h) {
    width = longEdge;
    height = Math.round((longEdge * h) / w);
  } else {
    height = longEdge;
    width = Math.round((longEdge * w) / h);
  }
  width -= width % 2;
  height -= height % 2;
  return { width: Math.max(2, width), height: Math.max(2, height) };
}

export function formatTimecode(sec: number, fps: number): string {
  const totalFrames = Math.max(0, Math.round(sec * fps));
  const ff = totalFrames % Math.round(fps);
  const totalSec = Math.floor(totalFrames / Math.round(fps));
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}
