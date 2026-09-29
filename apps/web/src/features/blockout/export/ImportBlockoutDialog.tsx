import { api } from "@cinakey/backend";
import {
  normalizeImportedDocument,
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sequenceId: string;
  onImported: (doc: BlockoutDocument) => void;
};

export function ImportBlockoutDialog({
  open,
  onOpenChange,
  sequenceId,
  onImported,
}: Props) {
  const importToSequence = useAction(api.blockouts.importToSequence);
  const [doc, setDoc] = useState<BlockoutDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function readFile(file: File) {
    setError(null);
    setDoc(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const { doc: next, error: err } = normalizeImportedDocument(parsed);
      if (err) throw new Error(err);
      setDoc(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file");
    }
  }

  async function submit() {
    if (!doc) return;
    setBusy(true);
    setError(null);
    try {
      await importToSequence({
        sequenceId: sequenceId as never,
        document: doc,
      });
      onImported(doc);
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
            Load a cinakey.blockout JSON file into this part.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
            }}
          />
          {doc ? (
            <p className="text-xs text-zinc-400">
              {doc.name} · {doc.frames} frames · {doc.objects.length} objects
            </p>
          ) : null}
          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            disabled={!doc || busy}
            onClick={() => void submit()}
          >
            {busy ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
