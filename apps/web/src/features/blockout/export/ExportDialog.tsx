import type { BlockoutDocument } from "@cinakey/shared";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  runExport,
  type ExportOptions,
  type ExportProgress,
} from "./runExport";
import { webCodecsSupported } from "./videoExport";

type Format = "json" | "mp4" | "both";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopeLabel: string;
  baseName: string;
  multiShot: boolean;
  loadDocument: () => Promise<{
    document: BlockoutDocument;
    skippedCount?: number;
  }>;
};

function Choice({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex-1 border px-3 py-2 text-sm transition-colors disabled:opacity-40",
        active
          ? "border-zinc-200 bg-zinc-100 text-zinc-950"
          : "border-zinc-700 text-zinc-300 hover:border-zinc-500",
      )}
    >
      {children}
    </button>
  );
}

export function ExportDialog({
  open,
  onOpenChange,
  scopeLabel,
  baseName,
  multiShot,
  loadDocument,
}: Props) {
  const canEncode = webCodecsSupported();
  const [format, setFormat] = useState<Format>("json");
  const [burnIn, setBurnIn] = useState(true);
  const [passMode, setPassMode] = useState<ExportOptions["mode"]>("clay");
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const running = progress !== null;

  async function start() {
    const controller = new AbortController();
    abortRef.current = controller;
    setMessage(null);
    setProgress({ label: "Collecting blockouts", fraction: 0 });
    try {
      const { document, skippedCount } = await loadDocument();
      await runExport({
        document,
        baseName,
        options: {
          json: format !== "mp4",
          mp4: format !== "json",
          burnIn,
          mode: passMode,
          range: "part",
        },
        signal: controller.signal,
        onProgress: setProgress,
      });
      setMessage(
        skippedCount
          ? `Exported. ${skippedCount} shot${skippedCount === 1 ? " has" : "s have"} no 3D blockout and ${skippedCount === 1 ? "was" : "were"} skipped.`
          : "Export complete.",
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessage("Export cancelled.");
      } else {
        setMessage(err instanceof Error ? err.message : "Export failed");
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) abortRef.current?.abort();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export blockout</DialogTitle>
          <DialogDescription>{scopeLabel}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex gap-2">
            <Choice
              active={format === "json"}
              disabled={running}
              onClick={() => setFormat("json")}
            >
              JSON
            </Choice>
            <Choice
              active={format === "mp4"}
              disabled={running || !canEncode}
              onClick={() => setFormat("mp4")}
            >
              MP4
            </Choice>
            <Choice
              active={format === "both"}
              disabled={running || !canEncode}
              onClick={() => setFormat("both")}
            >
              Both (zip)
            </Choice>
          </div>
          {!canEncode ? (
            <p className="text-xs text-amber-400">
              MP4 export needs WebCodecs (current Chrome, Edge or Safari).
            </p>
          ) : null}

          {format !== "json" ? (
            <div className="grid gap-3 text-sm text-zinc-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={burnIn}
                  disabled={running}
                  onChange={(e) => setBurnIn(e.target.checked)}
                  className="size-4 accent-zinc-100"
                />
                Burn in shot number and timecode
              </label>
              {multiShot ? (
                <div className="flex gap-2">
                  <Choice
                    active={passMode === "clay"}
                    disabled={running}
                    onClick={() => setPassMode("clay")}
                  >
                    Clay
                  </Choice>
                  <Choice
                    active={passMode === "depth"}
                    disabled={running}
                    onClick={() => setPassMode("depth")}
                  >
                    Depth
                  </Choice>
                </div>
              ) : null}
            </div>
          ) : null}

          {progress ? (
            <div className="grid gap-1.5">
              <Progress value={Math.round(progress.fraction * 100)} />
              <p className="text-xs text-zinc-400">{progress.label}</p>
            </div>
          ) : null}
          {message ? <p className="text-xs text-zinc-300">{message}</p> : null}
        </div>

        <DialogFooter>
          {running ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => abortRef.current?.abort()}
            >
              Cancel
            </Button>
          ) : (
            <Button type="button" onClick={() => void start()}>
              Export
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
