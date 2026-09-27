import type { BlockoutNode, BlockoutTracks } from "@cinakey/shared";
import { Diamond, Pause, Play, SkipBack, SkipForward, Trash2 } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatTimecode, keyframeAt, snapToFrame } from "./editorModel";
import { useTime, type TimeStore } from "./timeStore";

type Props = {
  timeStore: TimeStore;
  durationSec: number;
  fps: number;
  playing: boolean;
  nodes: BlockoutNode[];
  tracks: BlockoutTracks;
  selectedId: string | null;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  onSelect: (nodeId: string) => void;
  onSetKey: () => void;
  onDeleteKey: () => void;
};

export function EditorTimeline({
  timeStore,
  durationSec,
  fps,
  playing,
  nodes,
  tracks,
  selectedId,
  onTogglePlay,
  onSeek,
  onSelect,
  onSetKey,
  onDeleteKey,
}: Props) {
  const time = useTime(timeStore);
  const laneRef = useRef<HTMLDivElement>(null);

  const rows = nodes.filter((n) => (tracks[n.id]?.length ?? 0) > 0 || n.id === selectedId);
  const selectedKeyTimes = selectedId ? (tracks[selectedId] ?? []).map((k) => k.t) : [];
  const keyHere = selectedId ? keyframeAt(tracks, selectedId, time) : undefined;
  const pct = (t: number) => `${(t / durationSec) * 100}%`;

  function seekFromPointer(clientX: number) {
    const lane = laneRef.current;
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(snapToFrame(ratio * durationSec, fps));
  }

  function jump(direction: 1 | -1) {
    const times = direction === 1 ? selectedKeyTimes : [...selectedKeyTimes].reverse();
    const next = times.find((t) => (direction === 1 ? t > time + 1e-3 : t < time - 1e-3));
    onSeek(next ?? (direction === 1 ? durationSec : 0));
  }

  const ticks = Array.from({ length: Math.floor(durationSec) + 1 }, (_, i) => i);

  return (
    <div className="border-t border-zinc-800 bg-zinc-950/80">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Button type="button" size="icon" variant="secondary" className="size-8" onClick={onTogglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => jump(-1)} aria-label="Previous keyframe">
          <SkipBack />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => jump(1)} aria-label="Next keyframe">
          <SkipForward />
        </Button>
        <span className="font-mono text-xs tabular-nums text-zinc-200">
          {formatTimecode(time, fps)}
        </span>
        <span className="text-xs text-zinc-500">
          / {durationSec.toFixed(1)}s · {fps} fps
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" size="sm" variant={keyHere ? "secondary" : "outline"} disabled={!selectedId} onClick={onSetKey}>
            <Diamond className={cn(keyHere && "fill-amber-400 text-amber-400")} />
            {keyHere ? "Update key" : "Set key"}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={!keyHere} onClick={onDeleteKey}>
            <Trash2 />
            Delete key
          </Button>
        </div>
      </div>

      <div className="flex select-none text-[11px]">
        <div className="w-36 shrink-0 border-r border-zinc-800">
          <div className="h-6 border-b border-zinc-800" />
          {rows.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onSelect(n.id)}
              className={cn(
                "block h-6 w-full truncate px-3 text-left text-zinc-400 hover:text-zinc-100",
                n.id === selectedId && "bg-zinc-800/60 text-zinc-100",
              )}
            >
              {n.name}
            </button>
          ))}
        </div>
        <div
          ref={laneRef}
          className="relative min-w-0 flex-1 cursor-ew-resize"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            seekFromPointer(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) seekFromPointer(e.clientX);
          }}
        >
          <div className="relative h-6 border-b border-zinc-800">
            {ticks.map((s) => (
              <span
                key={s}
                className="absolute top-0 h-full border-l border-zinc-800 pl-1 leading-6 text-zinc-500"
                style={{ left: pct(s) }}
              >
                {s}s
              </span>
            ))}
          </div>
          {rows.map((n) => (
            <div
              key={n.id}
              className={cn("relative h-6 border-b border-zinc-900", n.id === selectedId && "bg-zinc-800/30")}
            >
              {(tracks[n.id] ?? []).map((k) => (
                <span
                  key={k.t}
                  className={cn(
                    "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border",
                    n.id === selectedId ? "border-amber-300 bg-amber-400" : "border-zinc-400 bg-zinc-500",
                  )}
                  style={{ left: pct(k.t) }}
                />
              ))}
            </div>
          ))}
          {rows.length === 0 ? (
            <p className="px-3 py-2 text-zinc-500">
              Select an object and press Set key to animate it. Keyframes on the shot camera
              create camera moves.
            </p>
          ) : null}
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-sky-400"
            style={{ left: pct(time) }}
          />
        </div>
      </div>
    </div>
  );
}
