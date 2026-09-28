import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api, type Id } from "@cinakey/backend";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TimelineDocument } from "@cinakey/shared";
import {
  TIMELINE_EXPORT_MAX_DURATION_SEC,
  TIMELINE_EXPORT_MAX_LONG_EDGE,
} from "@cinakey/shared";
import type { MediaUrlMap } from "./mediaUrls";
import {
  downloadBlob,
  exportCapsOk,
  exportTimelineMp4,
  webCodecsExportSupported,
  type ExportProgress,
} from "./export/exportTimeline";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: TimelineDocument;
  urls: MediaUrlMap;
  projectTitle: string;
  projectId: Id<"projects">;
};

export function ExportDialog({
  open,
  onOpenChange,
  doc,
  urls,
  projectTitle,
  projectId,
}: Props) {
  const recordExport = useMutation(api.exports.record);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    void webCodecsExportSupported().then(setSupported);
    setError(exportCapsOk(doc));
  }, [open, doc]);

  useEffect(() => {
    if (!running) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [running]);

  const start = async () => {
    setError(null);
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const longEdge = Math.max(
      ...doc.tracks
        .flatMap(() => [TIMELINE_EXPORT_MAX_LONG_EDGE])
        .concat([TIMELINE_EXPORT_MAX_LONG_EDGE]),
    );
    const width = longEdge;
    const height = Math.round(longEdge / (16 / 9));
    try {
      const blob = await exportTimelineMp4({
        doc,
        urls,
        signal: ac.signal,
        onProgress: setProgress,
      });
      const safe = projectTitle.replace(/[^\w-]+/g, "-").slice(0, 40) || "edit";
      downloadBlob(blob, `${safe}.mp4`);
      try {
        await recordExport({
          projectId,
          durationSec: Math.min(
            doc.durationSec,
            TIMELINE_EXPORT_MAX_DURATION_SEC,
          ),
          width,
          height,
          status: "succeeded",
        });
      } catch (recordErr) {
        console.warn("Failed to record export", recordErr);
      }
      onOpenChange(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Export canceled");
      } else {
        const message = err instanceof Error ? err.message : "Export failed";
        setError(message);
        try {
          await recordExport({
            projectId,
            durationSec: doc.durationSec,
            width,
            height,
            status: "failed",
            errorMessage: message,
          });
        } catch {
          // ignore
        }
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      setProgress(null);
    }
  };

  const pct =
    progress && progress.totalFrames > 0
      ? Math.round((progress.frame / progress.totalFrames) * 100)
      : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !running && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export MP4</DialogTitle>
          <DialogDescription>
            Renders the timeline in this browser at up to{" "}
            {TIMELINE_EXPORT_MAX_LONG_EDGE}p for{" "}
            {TIMELINE_EXPORT_MAX_DURATION_SEC / 60} minutes max. Uses original
            media (not proxies). Closing the tab cancels the export.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-zinc-300">
          <p>
            Duration: {doc.durationSec.toFixed(1)}s · {doc.project.fps} fps ·{" "}
            {doc.project.aspectRatio}
          </p>
          {supported === false && (
            <p className="text-amber-400">
              WebCodecs H.264 + AAC encode is not available in this browser.
            </p>
          )}
          {error && <p className="text-rose-400">{error}</p>}
          {running && progress && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">{progress.message}</p>
              <Progress value={pct} />
            </div>
          )}
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
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              <Button
                type="button"
                disabled={supported === false || Boolean(exportCapsOk(doc))}
                onClick={() => void start()}
              >
                Export
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
