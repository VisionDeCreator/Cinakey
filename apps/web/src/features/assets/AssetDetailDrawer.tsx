import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DetailDrawer } from "@/components/DetailDrawer";
import { useWorkspace } from "@/features/workspaces/workspace-context";
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
  const { canWrite } = useWorkspace();
  const writable = canWrite !== false;
  const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  async function saveMeta() {
    if (!assetId || !writable || saving || removing || !name.trim()) return;
    setSaving(true);
    setMessage("");
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
      setMessage("Changes saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save changes.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!assetId || !writable || saving || removing) return;
    const ok = await confirm({
      title: "Delete asset?",
      description:
        "This permanently removes the file from storage. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setRemoving(true);
    try {
      await remove({ assetId });
      onOpenChange(false);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not delete asset.",
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="ASSET DETAILS"
      title={
        asset === undefined
          ? "Loading…"
          : asset === null
            ? "Asset not found"
            : asset.name
      }
      description={
        asset ? (
          <span className="flex items-center gap-3">
            <Badge variant="outline" className="rounded-full capitalize">
              {asset.type}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                asset.starred ? "Remove from favourites" : "Add to favourites"
              }
              aria-pressed={asset.starred}
              disabled={!writable || saving || removing}
              onClick={() =>
                void setStarred({
                  assetId: asset._id,
                  starred: !asset.starred,
                }).catch(() => setMessage("Could not update favourite."))
              }
            >
              <Star
                className={
                  asset.starred
                    ? "fill-[var(--color-studio-accent)] text-[var(--color-studio-accent)]"
                    : ""
                }
              />
            </Button>
          </span>
        ) : undefined
      }
      footer={
        asset && (
          <>
            <Button
              variant="ghost"
              className="text-red-400 hover:text-red-300"
              disabled={!writable || saving || removing}
              onClick={() => void onDelete()}
            >
              <Trash2 />
              {removing ? "Deleting…" : "Delete asset"}
            </Button>
            <Button
              disabled={!writable || saving || removing || !name.trim()}
              onClick={() => void saveMeta()}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        )
      }
    >
      {asset && (
        <>
          <div className="space-y-6">
            <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
              <Preview asset={asset} url={url ?? null} />
            </div>
            {message && (
              <p role="status" className="text-sm text-zinc-400">
                {message}
              </p>
            )}

            <fieldset
              disabled={!writable || saving || removing}
              className="grid gap-4"
            >
              <h3 className="font-semibold">Asset information</h3>
              <div className="grid gap-2">
                <Label htmlFor="asset-name">Name</Label>
                <Input
                  id="asset-name"
                  required
                  maxLength={200}
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
                <Label htmlFor="asset-tags">Tags</Label>
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
              <p className="text-xs text-zinc-400">
                Separate tags with commas.
              </p>
            </fieldset>
            <h3 className="font-semibold">File details</h3>
            <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm">
              <dt className="text-zinc-500">Format</dt>
              <dd className="truncate text-zinc-200">{asset.format}</dd>
              <dt className="text-zinc-500">Size</dt>
              <dd>{formatBytes(asset.sizeBytes)}</dd>
              {asset.width && asset.height ? (
                <>
                  <dt className="text-zinc-500">Dimensions</dt>
                  <dd>
                    {asset.width} × {asset.height}
                  </dd>
                </>
              ) : null}
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
                  <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm">
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
                        <dd className="text-zinc-200">{asset.lineage.seed}</dd>
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
    </DetailDrawer>
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
