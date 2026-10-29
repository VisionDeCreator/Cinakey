import { t, useLocale } from "@dirrio/ui/i18n";
import { Film, Image as ImageIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MediaPreview } from "./MediaPreview";
import { createPortal } from "react-dom";

export type ReferenceMediaAsset = {
  name: string;
  type: string;
  durationSec?: number | null;
};
export function MediaThumbnail({
  asset,
  url,
}: {
  asset: ReferenceMediaAsset;
  url?: string | null;
}) {
  useLocale();
  const [failed, setFailed] = useState<string | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "80px" },
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return (
    <span ref={root} className="reference-thumbnail" aria-hidden="true">
      {url && visible && failed !== url ? (
        asset.type === "image" ? (
          <img src={url} alt="" loading="lazy" onError={() => setFailed(url)} />
        ) : (
          <video
            src={`${url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            onError={() => setFailed(url)}
          />
        )
      ) : asset.type === "video" ? (
        <Film size={18} />
      ) : (
        <ImageIcon size={18} />
      )}
      {asset.type === "video" && (
        <span className="reference-video-mark">▶</span>
      )}
    </span>
  );
}
/** One lazy preview surface for keyboard focus, mouse hover and touch. */
export function ReferenceMedia({
  asset,
  url,
  children,
}: {
  asset: ReferenceMediaAsset;
  url?: string | null;
  children: ReactNode;
}) {
  useLocale();
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = () => {
    if (!["image", "video"].includes(asset.type)) return;
    if (timer.current) clearTimeout(timer.current);
    const rect = root.current?.getBoundingClientRect();
    if (rect)
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 292)),
        top:
          rect.bottom + 240 < window.innerHeight
            ? rect.bottom + 6
            : Math.max(8, rect.top - 240),
      });
  };
  const hide = () => {
    timer.current = setTimeout(() => setPosition(null), 160);
  };
  return (
    <span
      className="reference-media"
      ref={root}
      onClick={(event) => {
        if (root.current?.contains(event.target as Node)) setPosition(null);
      }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape") setPosition(null);
      }}
    >
      {children}
      {position &&
        createPortal(
          <div
            className="reference-hover-preview"
            style={position}
            role="group"
            aria-label={t("Preview {0}", { 0: asset.name })}
            onMouseEnter={() => {
              if (timer.current) clearTimeout(timer.current);
            }}
            onMouseLeave={hide}
            onFocus={show}
            onBlur={hide}
          >
            <MediaPreview
              url={url ?? null}
              name={asset.name}
              type={asset.type}
            />
            <strong>{asset.name}</strong>
            <small>
              {t(asset.type ?? "")}
              {asset.durationSec ? ` · ${asset.durationSec.toFixed(1)}s` : ""}
            </small>
          </div>,
          document.body,
        )}
    </span>
  );
}
