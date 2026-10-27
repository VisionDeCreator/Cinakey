import { useWorkspace } from "@/features/workspaces/workspace-context";
import { useClient } from "@/lib/api/context";
import { documentHash } from "./timelineHistory";
import { uploadPublication } from "./publicationUpload";
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
import { useAction, useMutation } from "@/lib/api/hooks";
import { api, type Id } from "@cinakey/backend";
import type { TimelineDocument } from "@cinakey/shared";
import {
  TIMELINE_EXPORT_MAX_DURATION_SEC,
  TIMELINE_EXPORT_MAX_LONG_EDGE,
} from "@cinakey/shared";
import { useEffect, useRef, useState } from "react";
import {
  downloadBlob,
  exportCapsOk,
  exportTimelineMp4,
  webCodecsExportSupported,
  type ExportProgress,
} from "./export/exportTimeline";
import type { MediaUrlMap } from "./mediaUrls";
import { evenDims } from "./mediaUrls";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: TimelineDocument;
  urls: MediaUrlMap;
  projectTitle: string;
  projectId: Id<"projects">;
};

export function ExportDialog(props: Props) {
  return props.open ? <ExportSession {...props} /> : null;
}
function ExportSession({
  open,
  onOpenChange,
  doc: initialDoc,
  urls,
  projectTitle,
  projectId,
}: Props) {
  const { canWrite } = useWorkspace();
  const canStore = canWrite !== false;
  const [doc] = useState(() => structuredClone(initialDoc));
  const client = useClient();
  const getContent = useAction(api.timelineVersions.getContent);
  const beginPublication = useAction(api.publishedExports.begin);
  const [storeVideo, setStoreVideo] = useState(canStore);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [hasPendingUpload, setHasPendingUpload] = useState(false);
  const [stored, setStored] = useState(false);
  const pendingUpload = useRef<{ publicationId: string; blob: Blob } | null>(
    null,
  );
  const recordExport = useMutation(api.exports.record);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [exportError, setError] = useState<string | null>(null);
  const error = exportError ?? exportCapsOk(doc);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void webCodecsExportSupported().then((value) => {
      if (active) setSupported(value);
    });
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, [open]);

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
    const { width, height } = evenDims(
      TIMELINE_EXPORT_MAX_LONG_EDGE,
      doc.project.aspectRatio,
    );
    try {
      let publicationId: string | undefined;
      if (storeVideo && canStore) {
        const saved = await getContent({ projectId });
        if (
          !saved.document ||
          !saved.version ||
          documentHash(saved.document) !== documentHash(doc)
        )
          throw new Error(
            "Wait for this edit to save, then reopen Export to store this video.",
          );
        const intent = await beginPublication({
          projectId,
          versionId: saved.version._id,
          requestId: crypto.randomUUID(),
        });
        publicationId = intent.publicationId;
      }
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
      if (publicationId) {
        pendingUpload.current = { publicationId, blob };
        setHasPendingUpload(true);
        setUploadPercent(0);
        await uploadPublication(
          client,
          publicationId,
          blob,
          ac.signal,
          setUploadPercent,
        );
        pendingUpload.current = null;
        setHasPendingUpload(false);
        setStored(true);
        await client.invalidate();
      } else onOpenChange(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Export canceled");
      } else {
        const message = err instanceof Error ? err.message : "Export failed";
        setError(message);
        if (pendingUpload.current) return;
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

  const retryUpload = async () => {
    const pending = pendingUpload.current;
    if (!pending || !canStore) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setUploadPercent(0);
    try {
      await uploadPublication(
        client,
        pending.publicationId,
        pending.blob,
        controller.signal,
        setUploadPercent,
      );
      pendingUpload.current = null;
      setHasPendingUpload(false);
      setStored(true);
      await client.invalidate();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setRunning(false);
      abortRef.current = null;
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
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={storeVideo && canStore}
              disabled={!canStore || running || stored}
              onChange={(e) => setStoreVideo(e.target.checked)}
            />
            Store video for sharing (up to 200 MiB)
          </label>
          <p className="text-xs text-zinc-400">
            A local MP4 is downloaded before upload. Stored video uses the saved
            edit from when this dialog opened.
          </p>
          {stored && (
            <p role="status">
              Video stored. Open Stored videos in the editor to create a private
              link.
            </p>
          )}
          {running && uploadPercent !== null && (
            <div role="status">
              Uploading: {uploadPercent}%
              {uploadPercent === 100 ? " · validating and storing…" : ""}
              <Progress value={uploadPercent} />
            </div>
          )}
          {supported === false && (
            <p className="text-amber-400">
              WebCodecs H.264 + AAC encode is not available in this browser.
            </p>
          )}
          {error && (
            <p role="alert" className="text-rose-400">
              {error}
            </p>
          )}
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
              {hasPendingUpload && !stored && (
                <Button disabled={!canStore} onClick={() => void retryUpload()}>
                  Retry upload
                </Button>
              )}
              <Button
                type="button"
                disabled={
                  hasPendingUpload ||
                  stored ||
                  supported !== true ||
                  Boolean(exportCapsOk(doc))
                }
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
