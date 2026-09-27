import { api } from "@cinakey/backend";
import {
  allShots,
  validateBlockoutDocument,
  type BlockoutDocument,
} from "@cinakey/shared";
import { useAction } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shotId: string;
  onImported: () => void;
};

export function ImportBlockoutDialog({ open, onOpenChange, shotId, onImported }: Props) {
  const importToShot = useAction(api.blockouts.importToShot);
  const [doc, setDoc] = useState<BlockoutDocument | null>(null);
  const [sourceShotId, setSourceShotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const options = doc
    ? doc.scenes.flatMap((scene) =>
        scene.shots.map((shot) => ({
          id: shot.id,
          label: `SC ${scene.order + 1} / SH ${shot.order + 1} · ${shot.shotType}${scene.heading ? ` · ${scene.heading}` : ""}`,
        })),
      )
    : [];

  async function readFile(file: File) {
    setError(null);
    setDoc(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const err = validateBlockoutDocument(parsed);
      if (err) throw new Error(`Not a valid cinakey.blockout file: ${err}`);
      const valid = parsed as BlockoutDocument;
      const shots = allShots(valid);
      if (shots.length === 0) throw new Error("The file contains no shots");
      setDoc(valid);
      setSourceShotId(shots.find((s) => s.id === shotId)?.id ?? shots[0]!.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file");
    }
  }

  async function submit() {
    if (!doc || !sourceShotId) return;
    setBusy(true);
    setError(null);
    try {
      await importToShot({ shotId: shotId as never, document: doc, sourceShotId });
      onImported();
      onOpenChange(false);
      setDoc(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import blockout</DialogTitle>
          <DialogDescription>
            Load a cinakey.blockout JSON file into this shot. The current blockout is kept as a
            previous version.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <input
            type="file"
            accept="application/json,.json"
            className="text-sm text-zinc-300 file:mr-3 file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-100"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
          {options.length > 1 ? (
            <Select value={sourceShotId ?? undefined} onValueChange={setSourceShotId}>
              <SelectTrigger>
                <SelectValue placeholder="Shot to import" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {doc ? (
            <p className="text-xs text-zinc-400">
              {doc.project.title} · {options.length} shot{options.length === 1 ? "" : "s"} ·{" "}
              {doc.project.fps} fps
            </p>
          ) : null}
          {error ? <p className="text-xs text-red-400">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" disabled={!doc || busy} onClick={() => void submit()}>
            {busy ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
