import type { ReactNode } from "react";
import { api } from "@cinakey/backend";
import {
  TITLE_STYLE_IDS,
  type TimelineClip,
  type TitleStyleId,
  type CaptionLine,
  newTimelineId,
} from "@cinakey/shared";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  projectId: string;
  clip: TimelineClip | null;
  onChange: (patch: Partial<TimelineClip>) => void;
  onSwapTake: (take: {
    takeId: string;
    shotId: string;
    assetId: string;
    proxyAssetId?: string;
    trimStartSec?: number;
    trimEndSec?: number;
  }) => void;
  onDelete: () => void;
};

export function ClipInspector({
  projectId,
  clip,
  onChange,
  onSwapTake,
  onDelete,
}: Props) {
  const shotId =
    clip?.source.type === "take"
      ? clip.source.shotId
      : clip?.linkedShotId;
  const takes = useQuery(
    api.takes.listByShot,
    shotId ? { shotId: shotId as never } : "skip",
  );

  if (!clip) {
    return (
      <div className="border-l border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-500">
        Select a clip to inspect.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Clip
        </h3>
        <Button type="button" variant="ghost" size="sm" onClick={onDelete}>
          Delete
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field label="Start">
          <Input
            type="number"
            step={0.01}
            value={clip.startSec}
            onChange={(e) =>
              onChange({ startSec: Number(e.target.value) || 0 })
            }
          />
        </Field>
        <Field label="Duration">
          <Input
            type="number"
            step={0.01}
            value={clip.durationSec}
            onChange={(e) =>
              onChange({
                durationSec: Math.max(0.05, Number(e.target.value) || 0.05),
              })
            }
          />
        </Field>
        <Field label="Volume">
          <Input
            type="number"
            step={0.05}
            min={0}
            max={2}
            value={clip.volume ?? 1}
            onChange={(e) => onChange({ volume: Number(e.target.value) })}
          />
        </Field>
        <Field label="Speed">
          <Input
            type="number"
            step={0.05}
            min={0.1}
            value={clip.speed}
            onChange={(e) =>
              onChange({ speed: Math.max(0.1, Number(e.target.value) || 1) })
            }
          />
        </Field>
        <Field label="Fade in">
          <Input
            type="number"
            step={0.05}
            min={0}
            value={clip.fadeInSec ?? 0}
            onChange={(e) => onChange({ fadeInSec: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Fade out">
          <Input
            type="number"
            step={0.05}
            min={0}
            value={clip.fadeOutSec ?? 0}
            onChange={(e) =>
              onChange({ fadeOutSec: Number(e.target.value) || 0 })
            }
          />
        </Field>
      </div>

      {clip.source.type === "text" && (
        <div className="space-y-2">
          <Field label="Style">
            <select
              className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs"
              value={clip.source.styleId}
              onChange={(e) => {
                if (clip.source.type !== "text") return;
                onChange({
                  source: {
                    type: "text",
                    text: clip.source.text,
                    styleId: e.target.value as TitleStyleId,
                    lines: clip.source.lines,
                  },
                });
              }}
            >
              {TITLE_STYLE_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Text">
            <textarea
              className="min-h-16 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
              value={clip.source.text}
              onChange={(e) => {
                if (clip.source.type !== "text") return;
                onChange({
                  source: {
                    type: "text",
                    styleId: clip.source.styleId,
                    text: e.target.value,
                    lines: [
                      {
                        id: clip.source.lines?.[0]?.id ?? newTimelineId("cap"),
                        text: e.target.value,
                        characterName: clip.source.lines?.[0]?.characterName,
                      },
                    ],
                  },
                });
              }}
            />
          </Field>
          {clip.source.lines && clip.source.lines.length > 0 && (
            <div className="space-y-1">
              <Label className="text-[11px] text-zinc-500">Caption lines</Label>
              {clip.source.lines.map((line, i) => (
                <Input
                  key={line.id}
                  value={line.text}
                  className="text-xs"
                  onChange={(e) => {
                    const lines: CaptionLine[] = (clip.source.type === "text"
                      ? clip.source.lines ?? []
                      : []
                    ).map((l, idx) =>
                      idx === i ? { ...l, text: e.target.value } : l,
                    );
                    onChange({
                      source: {
                        type: "text",
                        text: lines.map((l) => l.text).join("\n"),
                        styleId:
                          clip.source.type === "text"
                            ? clip.source.styleId
                            : "caption",
                        lines,
                      },
                    });
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {shotId && (
        <div className="space-y-2 border-t border-zinc-800 pt-3">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">
            Linked shot
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" asChild>
              <Link to={`/projects/${projectId}/video/${shotId}`}>
                Regenerate
              </Link>
            </Button>
          </div>
          {takes && takes.length > 0 && (
            <div className="space-y-1">
              <Label className="text-[11px] text-zinc-500">Swap take</Label>
              <ul className="max-h-32 space-y-1 overflow-y-auto">
                {takes.map((take) => {
                  const active =
                    clip.source.type === "take" &&
                    clip.source.takeId === take._id;
                  return (
                    <li key={take._id}>
                      <button
                        type="button"
                        disabled={active}
                        className="w-full rounded-md border border-zinc-800 px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-40"
                        onClick={() =>
                          onSwapTake({
                            takeId: take._id,
                            shotId: take.shotId,
                            assetId: take.assetId,
                            proxyAssetId: take.proxyAssetId,
                            trimStartSec: take.trimStartSec,
                            trimEndSec: take.trimEndSec,
                          })
                        }
                      >
                        Take {take._id.slice(-6)}
                        {take.selected ? " (selected)" : ""}
                        {active ? " · current" : ""}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}
