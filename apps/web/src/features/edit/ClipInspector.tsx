import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Film, SlidersHorizontal, Trash2, Type } from "lucide-react";
import { MediaThumbnail } from "../studio/ReferenceMedia";
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
import { useState, type CSSProperties, type ReactNode } from "react";
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
      <div className="clip-inspector-empty">
        <SlidersHorizontal size={26} />
        <h3>Clip settings</h3>
        <p>
          Select a clip in the timeline to adjust its timing, playback, and
          audio.
        </p>
      </div>
    );
  }

  const asset =
    clip.source.type === "asset"
      ? assets?.find(
          (item) =>
            clip.source.type === "asset" && item._id === clip.source.assetId,
        )
      : undefined;
  const sourceUrl = urls?.find((item) => item.assetId === asset?._id)?.url;
  return (
    <div className="clip-inspector">
      <h3>Clip settings</h3>
      <div className="clip-inspector-summary">
        {asset ? (
          <MediaThumbnail asset={asset} url={sourceUrl} />
        ) : (
          <span className="clip-inspector-placeholder">
            {clip.source.type === "text" ? (
              <Type size={22} />
            ) : (
              <Film size={22} />
            )}
          </span>
        )}
        <div>
          <strong>
            {asset?.name ??
              (clip.source.type === "text" ? "Title clip" : "Media clip")}
          </strong>
          <span className="clip-inspector-kind">
            {asset?.type ?? (clip.source.type === "text" ? "Text" : "Media")}
          </span>
        </div>
      </div>
      <section className="clip-inspector-section" aria-label="Timing">
        <h4>Timing</h4>
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
        </div>
      </section>
      <section className="clip-inspector-section" aria-label="Playback">
        <h4>Playback</h4>
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
      </section>
      <section className="clip-inspector-section" aria-label="Audio">
        <h4>Audio</h4>
        <div className="clip-volume">
          <label htmlFor={`clip-volume-${clip.id}`}>
            Volume{" "}
            <output htmlFor={`clip-volume-${clip.id}`}>
              {Math.round((clip.volume ?? 1) * 100)}%
            </output>
          </label>
          <input
            id={`clip-volume-${clip.id}`}
            aria-label="Volume"
            aria-valuetext={`${Math.round((clip.volume ?? 1) * 100)} percent`}
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={clip.volume ?? 1}
            onChange={(event) =>
              onChange({ volume: Number(event.target.value) })
            }
            style={
              {
                "--volume-progress": `${((clip.volume ?? 1) / 2) * 100}%`,
              } as CSSProperties
            }
          />
          <div className="clip-volume-limits">
            <span>0%</span>
            <span>200%</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
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
      </section>

      {clip.source.type === "text" && (
        <div className="space-y-2">
          <Field label="Style">
            <Select
              value={clip.source.styleId}
              onValueChange={(value) => {
                if (clip.source.type !== "text") return;
                onChange({
                  source: {
                    type: "text",
                    text: clip.source.text,
                    styleId: value as TitleStyleId,
                    lines: clip.source.lines,
                  },
                });
              }}
            >
              <SelectTrigger aria-label="Title style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TITLE_STYLE_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
        <section className="clip-inspector-section" aria-label="Source">
          <h4>Source</h4>
          <span className="clip-source-label">Replace source</span>
          <Select
            value={clip.source.assetId}
            disabled={replacing}
            onValueChange={async (value) => {
              const asset = assets?.find((asset) => asset._id === value);
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
            <SelectTrigger aria-label="Replace clip source">
              <SelectValue placeholder="Choose media" />
            </SelectTrigger>
            <SelectContent>
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
                  <SelectItem key={asset._id} value={asset._id}>
                    {asset.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </section>
      )}
      {sourceError && <p role="alert">{sourceError}</p>}
      <div className="clip-inspector-delete">
        <Button type="button" variant="outline" onClick={onDelete}>
          <Trash2 size={15} />
          Delete clip
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-400">{label}</span>
      {children}
    </label>
  );
}
