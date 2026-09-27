import { api, type Doc, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "convex/react";
import { Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  const asset = useQuery(
    api.storage.getAsset,
    assetId ? { assetId } : "skip",
  );
  const url = useQuery(
    api.storage.getAssetUrl,
    assetId ? { assetId } : "skip",
  );
  const update = useMutation(api.assets.update);
  const setStarred = useMutation(api.assets.setStarred);
  const remove = useMutation(api.assets.remove);

  const [name, setName] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (asset) {
      setName(asset.name);
      setTagsText(asset.tags.join(", "));
    }
  }, [asset]);

  async function saveMeta() {
    if (!assetId) return;
    setSaving(true);
    try {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await update({ assetId, name: name.trim(), tags });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
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
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="asset-tags">Tags (comma-separated)</Label>
                    <Textarea
                      id="asset-tags"
                      value={tagsText}
                      onChange={(e) => setTagsText(e.target.value)}
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
                      onClick={() => setConfirmDelete(true)}
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
                  {asset.shotId ? (
                    <>
                      <dt className="text-zinc-500">Shot</dt>
                      <dd className="font-mono text-xs text-zinc-300">
                        {asset.shotId}
                      </dd>
                    </>
                  ) : null}
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
                    <h3 className="text-sm font-medium text-zinc-200">
                      Lineage
                    </h3>
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

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete asset?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the file from storage. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-700 hover:bg-red-600"
              onClick={() => {
                if (!assetId) return;
                void remove({ assetId }).then(() => {
                  setConfirmDelete(false);
                  onOpenChange(false);
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Preview({
  asset,
  url,
}: {
  asset: AssetDoc;
  url: string | null;
}) {
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
    return (
      <video
        src={url}
        controls
        className="max-h-64 w-full bg-black"
      />
    );
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
