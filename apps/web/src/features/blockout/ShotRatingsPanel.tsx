import { api } from "@cinakey/backend";
import { useMutation, useQuery } from "convex/react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

const REASONS: Array<[string, string]> = [
  ["framing", "Framing"],
  ["wrong_subject", "Wrong subject"],
  ["wrong_action", "Wrong action"],
  ["wrong_place", "Wrong place"],
  ["timing", "Timing"],
  ["missing_cast", "Missing cast"],
  ["other", "Other"],
];

/** Thumbs up / down per shot of the current staging — feeds the director. */
export function ShotRatingsPanel({
  sequenceId,
  shotCount,
}: {
  sequenceId: string;
  shotCount: number;
}) {
  const data = useQuery(api.stagingFeedback.shotRatings, {
    sequenceId: sequenceId as never,
  });
  const rate = useMutation(api.stagingFeedback.rateShot);
  if (data === undefined) return null;
  if (data === null) {
    return (
      <p className="text-[11px] text-zinc-500">
        Build the blockout to rate its shots.
      </p>
    );
  }
  const byShot = new Map(data.ratings.map((r) => [r.shotN, r] as const));

  const set = (shotN: number, rating: "up" | "down" | null, reason?: string) =>
    void rate({ sequenceId: sequenceId as never, shotN, rating, reason });

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-zinc-500">
        Rate shots — helps the director improve.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: shotCount }, (_, i) => i + 1).map((n) => {
          const r = byShot.get(n);
          return (
            <div
              key={n}
              className={cn(
                "flex items-center gap-1 rounded border px-1.5 py-1 text-[11px]",
                r?.rating === "down" ? "border-red-500/40" : "border-zinc-800",
              )}
            >
              <span className="w-4 text-center text-zinc-400">{n}</span>
              <button
                type="button"
                aria-label={`Shot ${n} good`}
                aria-pressed={r?.rating === "up"}
                onClick={() => set(n, r?.rating === "up" ? null : "up")}
                className={cn(
                  "rounded p-0.5",
                  r?.rating === "up"
                    ? "text-emerald-400"
                    : "text-zinc-600 hover:text-zinc-300",
                )}
              >
                <ThumbsUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label={`Shot ${n} needs work`}
                aria-pressed={r?.rating === "down"}
                onClick={() => set(n, r?.rating === "down" ? null : "down")}
                className={cn(
                  "rounded p-0.5",
                  r?.rating === "down"
                    ? "text-red-400"
                    : "text-zinc-600 hover:text-zinc-300",
                )}
              >
                <ThumbsDown className="h-3 w-3" />
              </button>
              {r?.rating === "down" ? (
                <select
                  aria-label={`Shot ${n} problem`}
                  value={r.reason ?? ""}
                  onChange={(e) => set(n, "down", e.target.value || undefined)}
                  className="rounded bg-zinc-900 px-1 text-[11px] text-zinc-300"
                >
                  <option value="">Why?</option>
                  {REASONS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
