import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/use-confirm";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { api, type Doc, type Id } from "@cinakey/backend";
import { Star, Trash2 } from "lucide-react";
import { useState } from "react";

type AssetDoc = Doc<"assets">;

export function AssetDetailDrawer({
  assetId,
  open,
  onOpenChange,
}: {
  assetId: Id<"assets"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const asset = useQuery(api.storage.getAsset, assetId ? { assetId } : "skip");
  const url = useQuery(api.storage.getAssetUrl, assetId ? { assetId } : "skip");
  const update = useMutation(api.assets.update);
  const setStarred = useMutation(api.assets.setStarred);
  const remove = useMutation(api.assets.remove);
  const confirm = useConfirm();

  const [draft, setDraft] = useState<{
    assetId: string;
    name: string;
    tagsText: string;
  } | null>(null);
  const name =
    draft && draft.assetId === assetId ? draft.name : (asset?.name ?? "");
  const tagsText =
    draft && draft.assetId === assetId
      ? draft.tagsText
      : (asset?.tags.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  async function saveMeta() {
    if (!assetId) return;
    setSaving(true);
    try {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await update({ assetId, name: name.trim(), tags });
      setDraft((current) =>
        current?.assetId === assetId &&
        current.name === name &&
        current.tagsText === tagsText
          ? null
          : current,
      );
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!assetId) return;
    const ok = await confirm({
      title: "Delete asset?",
      description:
        "This permanently removes the file from storage. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await remove({ assetId });
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        {asset === undefined ? (
          <SheetHeader>
            <SheetTitle>Loading…</SheetTitle>
          </SheetHeader>
        ) : asset === null ? (
          <SheetHeader>
            <SheetTitle>Asset not found</SheetTitle>
          </SheetHeader>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6">{asset.name}</SheetTitle>
              <SheetDescription>
                {asset.type} · {formatBytes(asset.sizeBytes)}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 p-4">
              <Preview asset={asset} url={url ?? null} />

              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="asset-name">Name</Label>
                  <Input
                    id="asset-name"
                    value={name}
                    onChange={(e) =>
                      setDraft({
                        assetId: asset._id,
                        name: e.target.value,
                        tagsText,
                      })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="asset-tags">Tags (comma-separated)</Label>
                  <Textarea
                    id="asset-tags"
                    value={tagsText}
                    onChange={(e) =>
                      setDraft({
                        assetId: asset._id,
                        name,
                        tagsText: e.target.value,
                      })
                    }
                    rows={2}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void saveMeta()}
                    disabled={saving}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void setStarred({
                        assetId: asset._id,
                        starred: !asset.starred,
                      })
                    }
                  >
                    <Star
                      className={
                        asset.starred
                          ? "fill-amber-400 text-amber-400"
                          : undefined
                      }
                    />
                    {asset.starred ? "Starred" : "Star"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void onDelete()}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </div>
              </div>

              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-zinc-500">Format</dt>
                <dd className="truncate text-zinc-200">{asset.format}</dd>
                <dt className="text-zinc-500">Created</dt>
                <dd className="text-zinc-200">
                  {new Date(asset.createdAt).toLocaleString()}
                </dd>
                {asset.jobId ? (
                  <>
                    <dt className="text-zinc-500">Job</dt>
                    <dd className="font-mono text-xs text-zinc-300">
                      {asset.jobId}
                    </dd>
                  </>
                ) : null}
              </dl>

              {asset.lineage || asset.jobId ? (
                <section className="space-y-2 border-t border-zinc-800 pt-4">
                  <h3 className="text-sm font-medium text-zinc-200">Lineage</h3>
                  {asset.lineage ? (
                    <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                      {asset.lineage.model ? (
                        <>
                          <dt className="text-zinc-500">Model</dt>
                          <dd className="text-zinc-200">
                            {asset.lineage.model}
                            {asset.lineage.modelVersion
                              ? ` @ ${asset.lineage.modelVersion}`
                              : ""}
                          </dd>
                        </>
                      ) : null}
                      {asset.lineage.prompt ? (
                        <>
                          <dt className="text-zinc-500">Prompt</dt>
                          <dd className="whitespace-pre-wrap text-zinc-200">
                            {asset.lineage.prompt}
                          </dd>
                        </>
                      ) : null}
                      {asset.lineage.seed !== undefined ? (
                        <>
                          <dt className="text-zinc-500">Seed</dt>
                          <dd className="text-zinc-200">
                            {asset.lineage.seed}
                          </dd>
                        </>
                      ) : null}
                      {asset.lineage.parentAssetIds &&
                      asset.lineage.parentAssetIds.length > 0 ? (
                        <>
                          <dt className="text-zinc-500">Parents</dt>
                          <dd className="font-mono text-xs text-zinc-400">
                            {asset.lineage.parentAssetIds.join(", ")}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  ) : (
                    <p className="text-sm text-zinc-500">
                      Linked to generation job {asset.jobId}
                    </p>
                  )}
                </section>
              ) : null}

              {asset.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {asset.tags.map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Preview({ asset, url }: { asset: AssetDoc; url: string | null }) {
  if (!url) {
    return (
      <div className="flex aspect-video items-center justify-center bg-zinc-950 text-sm text-zinc-600">
        Loading preview…
      </div>
    );
  }
  if (asset.type === "image" || asset.type === "logo") {
    return (
      <img
        src={url}
        alt={asset.name}
        className="max-h-64 w-full bg-zinc-950 object-contain"
      />
    );
  }
  if (asset.type === "video") {
    return <video src={url} controls className="max-h-64 w-full bg-black" />;
  }
  if (asset.type === "audio" || asset.type === "music") {
    return <audio src={url} controls className="w-full" />;
  }
  return (
    <div className="flex aspect-video items-center justify-center bg-zinc-950 text-sm text-zinc-500">
      No preview for {asset.type}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
