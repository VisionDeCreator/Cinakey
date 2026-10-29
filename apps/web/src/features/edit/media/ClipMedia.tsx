import { t, useLocale } from "@dirrio/ui/i18n";
import type { TimelineClip } from "@dirrio/shared";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MediaUrlMap } from "../mediaUrls";
import type { EditorMedia } from "./EditorMedia";
import { sourceTime } from "./analysis";

export function ClipMedia({
  clip,
  urls,
  media,
  width,
  waveform = false,
}: {
  clip: TimelineClip;
  urls: MediaUrlMap;
  media: EditorMedia;
  width: number;
  waveform?: boolean;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const id = clip.source.type === "text" ? "" : clip.source.assetId;
  const entry = urls[id];
  const hasProxy =
    !!entry?.proxyUrl ||
    (clip.source.type !== "text" &&
      !!clip.source.proxyAssetId &&
      !!urls[clip.source.proxyAssetId]?.url);
  const analysis = useSyncExternalStore(media.subscribe, () => media.get(id));
  useEffect(() => {
    if (!ref.current) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([row]) => {
        if (row?.isIntersecting) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (visible && entry?.url)
      media.request(id, entry.url, entry.type ?? "video", hasProxy);
  }, [visible, id, entry, media, hasProxy]);
  const count = Math.max(1, Math.min(40, Math.ceil(width / 64)));
  const bins = Math.max(1, Math.min(400, Math.ceil(width / 3)));
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {!waveform && analysis.thumbnails.length > 0 && (
        <div className="absolute inset-0 flex opacity-70">
          {Array.from({ length: count }, (_, i) => {
            const time = sourceTime(
              clip.inSec,
              clip.speed,
              (clip.durationSec * (i + 0.5)) / count,
            );
            const thumbnail = analysis.thumbnails.reduce((best, item) =>
              Math.abs(item.time - time) < Math.abs(best.time - time)
                ? item
                : best,
            );
            return (
              <img
                key={i}
                src={thumbnail.url}
                alt=""
                className="h-full min-w-0 flex-1 object-cover"
              />
            );
          })}
        </div>
      )}
      {waveform && analysis.peaks.length > 0 && (
        <svg
          viewBox={`0 0 ${bins} 32`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full text-white/70"
        >
          {Array.from({ length: bins }, (_, i) => {
            const start = sourceTime(
              clip.inSec,
              clip.speed,
              (clip.durationSec * i) / bins,
            );
            const end = sourceTime(
              clip.inSec,
              clip.speed,
              (clip.durationSec * (i + 1)) / bins,
            );
            const lo = Math.max(
              0,
              Math.floor((start / analysis.duration) * analysis.peaks.length),
            );
            const hi = Math.min(
              analysis.peaks.length,
              Math.max(
                lo + 1,
                Math.ceil((end / analysis.duration) * analysis.peaks.length),
              ),
            );
            let peak = 0;
            for (let j = lo; j < hi; j++)
              peak = Math.max(peak, analysis.peaks[j]!);
            return (
              <line
                key={i}
                x1={i + 0.5}
                x2={i + 0.5}
                y1={16 - peak * 15}
                y2={16 + peak * 15}
                stroke="currentColor"
                strokeWidth="0.65"
              />
            );
          })}
        </svg>
      )}
      <span className="absolute bottom-0 right-1 rounded bg-black/70 px-1 text-[8px] text-zinc-300">
        {analysis.proxyStatus === "creating"
          ? t("Creating proxy…")
          : analysis.proxyStatus === "ready"
            ? t("Proxy")
            : analysis.status === "processing"
              ? t("Analyzing…")
              : analysis.status === "unavailable"
                ? t("Original media")
                : ""}
      </span>
    </div>
  );
}
