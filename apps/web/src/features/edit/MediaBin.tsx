import { api } from "@cinakey/backend";
import type { AssetType, TimelineDocument, TrackKind } from "@cinakey/shared";
import { newTimelineId } from "@cinakey/shared";
import { useQuery } from "convex/react";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  projectId: string;
  doc: TimelineDocument;
  playheadSec: number;
  onAddClip: (
    trackKind: TrackKind,
    clip: TimelineDocument["tracks"][0]["clips"][0],
  ) => void;
};

export function MediaBin({ projectId, doc, playheadSec, onAddClip }: Props) {
  const assets = useQuery(api.assets.list, {
    projectId: projectId as never,
  });
  const { uploadFiles, uploads } = useAssetUpload(projectId);

  const media = (assets ?? []).filter((a) =>
    ["video", "audio", "music", "image"].includes(a.type),
  );

  const addAsset = (asset: {
    _id: string;
    type: string;
    name: string;
    durationSec?: number | null;
  }) => {
    const kind: TrackKind =
      asset.type === "music"
        ? "music"
        : asset.type === "audio"
          ? "sfx"
          : asset.type === "image" || asset.type === "video"
            ? "video"
            : "sfx";
    const track = doc.tracks.find((t) => t.kind === kind);
    if (!track) return;
    const durationSec = asset.durationSec && asset.durationSec > 0
      ? asset.durationSec
      : asset.type === "image"
        ? 3
        : 5;
    onAddClip(kind, {
      id: newTimelineId("clip"),
      startSec: playheadSec,
      durationSec,
      inSec: 0,
      outSec: durationSec,
      speed: 1,
      source: { type: "asset", assetId: asset._id },
      volume: 1,
    });
  };

  const onUpload = async (
    files: FileList | null,
    type?: AssetType,
  ) => {
    if (!files || files.length === 0) return;
    await uploadFiles(files, { type, tags: type === "music" ? ["music"] : [] });
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden border-l border-zinc-800 bg-zinc-950 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Media
        </h3>
        <div className="flex gap-1">
          <label className="cursor-pointer">
            <input
              type="file"
              accept="video/*,image/*"
              className="hidden"
              multiple
              onChange={(e) => void onUpload(e.target.files)}
            />
            <span className="inline-flex h-7 items-center rounded-md border border-zinc-700 px-2 text-[11px] text-zinc-300 hover:bg-zinc-900">
              Video/Img
            </span>
          </label>
          <label className="cursor-pointer">
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              multiple
              onChange={(e) => void onUpload(e.target.files, "music")}
            />
            <span className="inline-flex h-7 items-center rounded-md border border-zinc-700 px-2 text-[11px] text-zinc-300 hover:bg-zinc-900">
              Music
            </span>
          </label>
        </div>
      </div>
      {uploads.some((u) => u.status === "uploading") && (
        <p className="text-[11px] text-zinc-500">Uploading…</p>
      )}
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto text-sm">
        {media.map((asset) => (
          <li key={asset._id}>
            <button
              type="button"
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-zinc-300 hover:bg-zinc-900",
              )}
              onClick={() => addAsset(asset)}
              title="Add at playhead"
            >
              <span className="truncate">{asset.name}</span>
              <span className="shrink-0 text-[10px] uppercase text-zinc-600">
                {asset.type}
              </span>
            </button>
          </li>
        ))}
        {media.length === 0 && (
          <li className="text-xs text-zinc-600">No media yet. Upload above.</li>
        )}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          const titles = doc.tracks.find((t) => t.kind === "titles");
          if (!titles) return;
          onAddClip("titles", {
            id: newTimelineId("clip"),
            startSec: playheadSec,
            durationSec: 3,
            inSec: 0,
            outSec: 3,
            speed: 1,
            source: {
              type: "text",
              text: "Title",
              styleId: "centered",
            },
          });
        }}
      >
        Add title
      </Button>
    </div>
  );
}
