import { useEffect, useRef, useState } from "react";
import { api } from "@cinakey/backend";
import { useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";

type TakeRow = {
  _id: string;
  assetId: string;
  selected: boolean;
  rating?: number;
  playbackUrl: string | null;
  assetUrl: string | null;
  proxyUrl: string | null;
  trimStartSec?: number;
  trimEndSec?: number;
  parentTakeId?: string;
  createdAt: number;
  asset?: { starred?: boolean } | null;
};

type Props = {
  takes: TakeRow[];
  onSelect: (takeId: string) => void;
  onRate: (takeId: string, rating: number) => void;
  onUpscale: (takeId: string) => void;
  onExtend: (takeId: string) => void;
  busy?: boolean;
};

export function TakeCompare({
  takes,
  onSelect,
  onRate,
  onUpscale,
  onExtend,
  busy,
}: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const starTake = useMutation(api.takes.starTakeAsset);

  const compareSet = takes.filter((t) => picked.includes(t._id)).slice(0, 4);
  const showCompare = compareSet.length >= 2;

  useEffect(() => {
    // Keep picked in sync when takes change
    setPicked((prev) => prev.filter((id) => takes.some((t) => t._id === id)));
  }, [takes]);

  function togglePick(id: string) {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  }

  function syncPlay(playing: boolean) {
    for (const t of compareSet) {
      const el = videoRefs.current.get(t._id);
      if (!el) continue;
      if (playing) void el.play().catch(() => undefined);
      else el.pause();
    }
  }

  function syncSeek(time: number) {
    for (const t of compareSet) {
      const el = videoRefs.current.get(t._id);
      if (!el) continue;
      const offset = t.trimStartSec ?? 0;
      el.currentTime = offset + time;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">Takes</h3>
        {showCompare ? (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => syncPlay(true)}
            >
              Play sync
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => syncPlay(false)}
            >
              Pause
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => syncSeek(0)}
            >
              Reset
            </Button>
          </div>
        ) : (
          <p className="text-[11px] text-zinc-500">
            Select 2–4 takes to compare
          </p>
        )}
      </div>

      {showCompare ? (
        <div
          className={`grid gap-2 ${
            compareSet.length === 2
              ? "grid-cols-2"
              : compareSet.length === 3
                ? "grid-cols-3"
                : "grid-cols-2 sm:grid-cols-4"
          }`}
        >
          {compareSet.map((t) => (
            <div key={t._id} className="space-y-1">
              <video
                ref={(el) => {
                  if (el) videoRefs.current.set(t._id, el);
                  else videoRefs.current.delete(t._id);
                }}
                src={t.playbackUrl ?? undefined}
                className="aspect-video w-full bg-black object-contain"
                muted
                playsInline
                controls
                onLoadedMetadata={(e) => {
                  const el = e.currentTarget;
                  if (t.trimStartSec !== undefined) {
                    el.currentTime = t.trimStartSec;
                  }
                }}
              />
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-zinc-500">
                  {t.selected ? "Selected" : new Date(t.createdAt).toLocaleString()}
                </span>
                <Button
                  type="button"
                  size="sm"
                  className="h-6 text-[10px]"
                  disabled={busy || t.selected}
                  onClick={() => onSelect(t._id)}
                >
                  Select
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <ul className="divide-y divide-zinc-800 border border-zinc-800">
        {takes.map((t) => (
          <li
            key={t._id}
            className="flex flex-wrap items-center gap-3 px-3 py-2"
          >
            <label className="flex items-center gap-2 text-[11px] text-zinc-400">
              <input
                type="checkbox"
                checked={picked.includes(t._id)}
                onChange={() => togglePick(t._id)}
              />
              Compare
            </label>
            <div className="h-12 w-20 shrink-0 overflow-hidden bg-zinc-900">
              {t.playbackUrl ? (
                <video
                  src={t.playbackUrl}
                  className="h-full w-full object-cover"
                  muted
                  playsInline
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[9px] text-zinc-600">
                  —
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-zinc-200">
                {t.selected ? "Selected take" : "Take"}
                {t.parentTakeId ? " · derived" : ""}
                {t.trimStartSec !== undefined
                  ? ` · ${t.trimStartSec.toFixed(1)}–${(t.trimEndSec ?? 0).toFixed(1)}s`
                  : ""}
              </p>
              <div className="mt-1 flex gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`text-xs ${
                      (t.rating ?? 0) >= n ? "text-amber-400" : "text-zinc-600"
                    }`}
                    onClick={() => onRate(t._id, n)}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                title="Star to keep if rejected"
                onClick={() =>
                  void starTake({
                    takeId: t._id as never,
                    starred: !(t.asset?.starred ?? false),
                  })
                }
              >
                <Star
                  className={`size-3.5 ${
                    t.asset?.starred ? "fill-amber-400 text-amber-400" : ""
                  }`}
                />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[10px]"
                disabled={busy || t.selected}
                onClick={() => onSelect(t._id)}
              >
                Select
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[10px]"
                disabled={busy}
                onClick={() => onUpscale(t._id)}
              >
                Upscale
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[10px]"
                disabled={busy}
                onClick={() => onExtend(t._id)}
              >
                Extend
              </Button>
            </div>
          </li>
        ))}
        {takes.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-zinc-500">
            No takes yet. Run a generation below.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
