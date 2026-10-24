import { ClipMedia } from "./media/ClipMedia";
import type { EditorMedia } from "./media/EditorMedia";
import type { MediaUrlMap } from "./mediaUrls";
import type {
  TimelineClip,
  TimelineDocument,
  TrackKind,
} from "@cinakey/shared";
import { cn } from "@/lib/utils";

const TRACK_COLORS: Record<TrackKind, string> = {
  video: "bg-[#31566c] border-[#4484a4]",
  dialogue: "bg-[#3c4956] border-[#657580]",
  music: "bg-[#354a43] border-[#66887a]",
  sfx: "bg-[#314852] border-[#587884]",
  titles: "bg-[#464d57] border-[#79828d]",
};

export type TrimMode = "ripple" | "roll";

type Props = {
  doc: TimelineDocument;
  media?: EditorMedia;
  urls?: MediaUrlMap;
  playheadSec: number;
  pxPerSec: number;
  selectedClipId: string | null;
  trimMode: TrimMode;
  onSelectClip: (id: string | null) => void;
  onToggleMute?: (trackId: string) => void;
  onSeek: (sec: number) => void;
  onMoveClip: (clipId: string, startSec: number, trackId?: string) => void;
  onTrim: (clipId: string, edge: "in" | "out", timelineEdgeSec: number) => void;
  onRoll: (leftClipId: string, cutSec: number) => void;
  onZoom: (pxPerSec: number) => void;
};

export function TimelineTracks({
  doc,
  media,
  urls,
  playheadSec,
  pxPerSec,
  selectedClipId,
  trimMode,
  onSelectClip,
  onToggleMute,
  onSeek,
  onMoveClip,
  onTrim,
  onRoll,
  onZoom,
}: Props) {
  const width = Math.max(800, (doc.durationSec + 5) * pxPerSec);
  const trackH = 40;

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
        <label className="flex items-center gap-2">
          Zoom
          <input
            type="range"
            min={20}
            max={200}
            value={pxPerSec}
            onChange={(e) => onZoom(Number(e.target.value))}
            className="w-28"
          />
        </label>
        <span className="text-zinc-600">
          Trim: {trimMode === "ripple" ? "Ripple" : "Roll"} (R to toggle)
        </span>
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-auto"
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const next = clamp(pxPerSec * (e.deltaY > 0 ? 0.9 : 1.1), 20, 200);
            onZoom(next);
          }
        }}
      >
        <div className="flex" style={{ minWidth: width + 120 }}>
          <div className="sticky left-0 z-20 w-[120px] shrink-0 border-r border-zinc-800 bg-zinc-950">
            {doc.tracks.map((track) => (
              <div
                key={track.id}
                className="flex items-center border-b border-zinc-900 px-2 text-xs text-zinc-400"
                style={{ height: trackH }}
              >
                <span className="min-w-0 flex-1 truncate">{track.name}</span>
                {track.kind !== "titles" && onToggleMute && (
                  <button
                    type="button"
                    className="studio-track-mute"
                    aria-label={`${track.audioMuted ? "Unmute" : "Mute"} ${track.name}`}
                    aria-pressed={Boolean(track.audioMuted)}
                    onClick={() => onToggleMute(track.id)}
                  >
                    M
                  </button>
                )}
              </div>
            ))}
          </div>
          <div
            className="relative"
            style={{ width, minHeight: doc.tracks.length * trackH }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).dataset.clip) return;
              const rect = (
                e.currentTarget as HTMLElement
              ).getBoundingClientRect();
              const x =
                e.clientX -
                rect.left +
                (e.currentTarget as HTMLElement).scrollLeft;
              onSeek(Math.max(0, x / pxPerSec));
              onSelectClip(null);
            }}
          >
            {/* Ruler ticks */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-0">
              {Array.from(
                { length: Math.ceil(doc.durationSec) + 1 },
                (_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 h-full border-l border-zinc-800/80"
                    style={{ left: i * pxPerSec }}
                  />
                ),
              )}
            </div>

            {doc.tracks.map((track, ti) => (
              <div
                key={track.id}
                className="relative border-b border-zinc-900"
                style={{ height: trackH }}
                data-track-id={track.id}
              >
                {track.clips.map((clip) => (
                  <ClipBlock
                    key={clip.id}
                    clip={clip}
                    media={media}
                    urls={urls}
                    waveform={track.kind !== "video" && track.kind !== "titles"}
                    top={0}
                    height={trackH - 6}
                    pxPerSec={pxPerSec}
                    selected={clip.id === selectedClipId}
                    color={TRACK_COLORS[track.kind]}
                    trimMode={trimMode}
                    trackClips={track.clips}
                    onSelect={() => onSelectClip(clip.id)}
                    onMove={(start) => onMoveClip(clip.id, start, track.id)}
                    onTrim={(edge, sec) => onTrim(clip.id, edge, sec)}
                    onRoll={(cut) => onRoll(clip.id, cut)}
                  />
                ))}
                {/* empty lane click already handled */}
                <span className="sr-only">Track {ti}</span>
              </div>
            ))}

            {/* Playhead */}
            <div
              className="pointer-events-none absolute top-0 z-10 w-px bg-red-500"
              style={{
                left: playheadSec * pxPerSec,
                height: doc.tracks.length * trackH,
              }}
            >
              <div className="absolute -left-1.5 -top-0 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-red-500" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ClipBlock({
  clip,
  media,
  urls,
  waveform,
  top,
  height,
  pxPerSec,
  selected,
  color,
  trimMode,
  trackClips,
  onSelect,
  onMove,
  onTrim,
  onRoll,
}: {
  clip: TimelineClip;
  media?: EditorMedia;
  urls?: MediaUrlMap;
  waveform?: boolean;
  top: number;
  height: number;
  pxPerSec: number;
  selected: boolean;
  color: string;
  trimMode: TrimMode;
  trackClips: TimelineClip[];
  onSelect: () => void;
  onMove: (startSec: number) => void;
  onTrim: (edge: "in" | "out", timelineEdgeSec: number) => void;
  onRoll: (cutSec: number) => void;
}) {
  const label =
    clip.source.type === "text"
      ? clip.source.text.slice(0, 24)
      : (urls?.[clip.source.assetId]?.name ??
        (clip.source.type === "take"
          ? `Take ${clip.source.takeId.slice(-4)}`
          : "Asset"));

  return (
    <div
      data-clip="1"
      role="button"
      tabIndex={0}
      aria-label={`Select ${label}`}
      aria-pressed={selected}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onSelect();
        }
      }}
      className={cn(
        "absolute top-[3px] overflow-hidden rounded-sm border text-[10px] text-zinc-100",
        color,
        selected && "ring-2 ring-white/70",
      )}
      style={{
        left: clip.startSec * pxPerSec,
        width: Math.max(8, clip.durationSec * pxPerSec),
        height,
        top,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
        const target = e.target as HTMLElement;
        const edge = target.dataset.edge as "in" | "out" | undefined;
        const startX = e.clientX;
        const origStart = clip.startSec;
        const origEnd = clip.startSec + clip.durationSec;

        const onMovePtr = (ev: PointerEvent) => {
          const dx = ev.clientX - startX;
          const dSec = dx / pxPerSec;
          if (edge === "in") {
            if (
              trimMode === "roll" &&
              trackClips.some(
                (c) =>
                  Math.abs(c.startSec + c.durationSec - clip.startSec) < 0.02,
              )
            ) {
              // roll handled on left neighbor via out edge — skip
            }
            onTrim("in", origStart + dSec);
          } else if (edge === "out") {
            if (trimMode === "roll") {
              onRoll(origEnd + dSec);
            } else {
              onTrim("out", origEnd + dSec);
            }
          } else {
            onMove(Math.max(0, origStart + dSec));
          }
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMovePtr);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMovePtr);
        window.addEventListener("pointerup", onUp);
      }}
    >
      {media && urls && clip.source.type !== "text" && (
        <ClipMedia
          clip={clip}
          media={media}
          urls={urls}
          width={clip.durationSec * pxPerSec}
          waveform={waveform}
        />
      )}
      <div
        data-edge="in"
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize hover:bg-white/40"
      />
      <div className="relative truncate px-2 py-1 pointer-events-none text-shadow-sm text-shadow-black">
        {label}
      </div>
      <div
        data-edge="out"
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize hover:bg-white/40"
      />
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
