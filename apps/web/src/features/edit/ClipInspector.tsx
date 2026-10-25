import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery } from "@/lib/api/hooks";
import { api } from "@cinakey/backend";
import {
  newTimelineId,
  TITLE_STYLE_IDS,
  type CaptionLine,
  type TimelineClip,
  type TitleStyleId,
} from "@cinakey/shared";
import { useState, type ReactNode } from "react";
import { resolveMediaDuration } from "./insertMedia";

type Props = {
  projectId: string;
  clip: TimelineClip | null;
  onChange: (patch: Partial<TimelineClip>) => void;
  onDelete: () => void;
};

export function ClipInspector({ projectId, clip, onChange, onDelete }: Props) {
  const assets = useQuery(api.assets.list, { projectId: projectId as never });
  const urls = useQuery(api.storage.listProjectAssetUrls, {
    projectId: projectId as never,
  });
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);

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
        {clip.source.type !== "text" && (
          <Field label="Source in (seconds)">
            <Input
              type="number"
              step={0.01}
              min={0}
              value={clip.inSec}
              onChange={(event) => {
                const inSec = Math.max(0, Number(event.target.value) || 0);
                onChange({
                  inSec,
                  outSec: inSec + clip.durationSec * clip.speed,
                });
              }}
            />
          </Field>
        )}
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
            onChange={(e) =>
              onChange({ fadeInSec: Number(e.target.value) || 0 })
            }
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
                    const lines: CaptionLine[] = (
                      clip.source.type === "text"
                        ? (clip.source.lines ?? [])
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

      {clip.source.type !== "text" && (
        <label>
          Replace source
          <select
            aria-label="Replace clip source"
            value={clip.source.assetId}
            disabled={replacing}
            onChange={async (event) => {
              const asset = assets?.find(
                (asset) => asset._id === event.target.value,
              );
              if (!asset) return;
              setReplacing(true);
              setSourceError(null);
              try {
                const available =
                  asset.durationSec ??
                  (asset.type === "image"
                    ? clip.outSec
                    : await resolveMediaDuration(
                        urls?.find((url) => url.assetId === asset._id)?.url ??
                          "",
                        asset.type,
                      ));
                const inSec = Math.min(
                  clip.inSec,
                  Math.max(0, available - 1 / 24),
                );
                const outSec = Math.min(
                  available,
                  inSec + clip.durationSec * clip.speed,
                );
                onChange({
                  source: {
                    type: "asset",
                    assetId: asset._id,
                    proxyAssetId: asset.playbackProxyAssetId,
                  },
                  inSec,
                  outSec,
                  durationSec: (outSec - inSec) / clip.speed,
                });
              } catch (error) {
                setSourceError(
                  error instanceof Error
                    ? error.message
                    : "Could not replace source",
                );
              } finally {
                setReplacing(false);
              }
            }}
          >
            {assets
              ?.filter((asset) =>
                (clip.source.type !== "text" &&
                ["audio", "music"].includes(
                  assets.find(
                    (current) =>
                      clip.source.type !== "text" &&
                      current._id === clip.source.assetId,
                  )?.type ?? "",
                )
                  ? ["audio", "music"]
                  : ["video", "image"]
                ).includes(asset.type),
              )
              .map((asset) => (
                <option key={asset._id} value={asset._id}>
                  {asset.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {sourceError && <p role="alert">{sourceError}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}
