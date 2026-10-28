import { I18nText, t, useLocale } from "@cinakey/ui/i18n";
import {
  Clapperboard,
  Film,
  FileVideo,
  Monitor,
  Info,
  Check,
  LoaderCircle,
} from "lucide-react";
import "./export-sharing.css";
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
  useLocale();
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
  useLocale();
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
      <DialogContent className="export-sharing-dialog max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-2xl">
            <Clapperboard size={25} />
            <I18nText text="Export MP4" />
          </DialogTitle>
          <DialogDescription>
            <I18nText text="Create a video from your saved edit." />
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-zinc-300">
          <div className="export-project-summary">
            <div className="stored-video-cover">
              <Film size={36} />
            </div>
            <div>
              <h3>{projectTitle}</h3>
              <p>
                {doc.durationSec.toFixed(1)}s · {doc.project.aspectRatio} ·{" "}
                {doc.project.fps} <I18nText text="fps" />
              </p>
            </div>
          </div>
          <div className="export-format-summary">
            <span>
              <FileVideo size={16} />
              MP4
            </span>
            <span>H.264 + AAC</span>
            <span>
              <Monitor size={16} />
              {
                evenDims(TIMELINE_EXPORT_MAX_LONG_EDGE, doc.project.aspectRatio)
                  .width
              }{" "}
              ×{" "}
              {
                evenDims(TIMELINE_EXPORT_MAX_LONG_EDGE, doc.project.aspectRatio)
                  .height
              }
            </span>
          </div>
          <label className="export-store-option">
            <input
              type="checkbox"
              checked={storeVideo && canStore}
              disabled={!canStore || running || stored}
              onChange={(e) => setStoreVideo(e.target.checked)}
            />
            <span>
              <I18nText text="Store video for sharing" />
              <small>
                <I18nText text="Up to 200 MiB per video" />
              </small>
            </span>
          </label>
          <p className="export-footnote">
            <Info size={15} />
            <I18nText text="Your MP4 downloads first, then uploads for sharing when selected. Keep this tab open until complete." />
          </p>
          {stored && (
            <p role="status">
              <I18nText text="Video stored. Open Share & videos in the project header to create a viewing link." />
            </p>
          )}
          {doc.durationSec <= 0 && (
            <p role="status" className="text-xs text-zinc-400">
              <I18nText text="Add media to the timeline before exporting." />
            </p>
          )}
          {supported === null && (
            <p role="status" className="text-xs text-zinc-400">
              <I18nText text="Checking browser export support…" />
            </p>
          )}
          {supported === false && (
            <p className="text-amber-400">
              <I18nText text="WebCodecs H.264 + AAC encode is not available in this browser." />
            </p>
          )}
          {error && (
            <p role="alert" className="text-rose-400">
              {t(error ?? "")}
            </p>
          )}
          {running && (
            <div
              className="export-progress-card"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center justify-between gap-3">
                <h3>
                  {uploadPercent === null
                    ? t("Exporting video")
                    : uploadPercent === 100
                      ? t("Verifying upload")
                      : t("Uploading video")}
                </h3>
                <strong>{uploadPercent ?? pct}%</strong>
              </div>
              <Progress
                aria-label={
                  uploadPercent === null
                    ? t("Rendering progress")
                    : t("Upload progress")
                }
                value={uploadPercent ?? pct}
              />
              {progress && (
                <p className="text-xs text-zinc-400">
                  {uploadPercent === null
                    ? progress.message
                    : uploadPercent === 100
                      ? t("Validating and storing…")
                      : t("Uploading your exported video…")}
                </p>
              )}
              <div className="export-steps">
                <span
                  className={uploadPercent === null ? "active" : "complete"}
                >
                  <i>{uploadPercent === null ? "1" : <Check size={12} />}</i>
                  <I18nText text="Render video" />
                </span>
                {storeVideo && (
                  <span className={uploadPercent !== null ? "active" : ""}>
                    <i>2</i>
                    <I18nText text="Upload & store" />
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {running ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => abortRef.current?.abort()}
              >
                <I18nText text="Cancel export" />
              </Button>
              <Button disabled>
                <LoaderCircle size={15} className="animate-spin" />
                {uploadPercent === null ? t("Exporting…") : t("Uploading…")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                <I18nText text="Close" />
              </Button>
              {hasPendingUpload && !stored && (
                <Button disabled={!canStore} onClick={() => void retryUpload()}>
                  <I18nText text="Retry upload" />
                </Button>
              )}
              <Button
                type="button"
                disabled={
                  doc.durationSec <= 0 ||
                  hasPendingUpload ||
                  stored ||
                  supported !== true ||
                  Boolean(exportCapsOk(doc))
                }
                onClick={() => void start()}
              >
                <I18nText text="Export" />
              </Button>
            </>
          )}
        </DialogFooter>
        <p className="export-footnote">
          <I18nText text="Original media · Up to" />{" "}
          {TIMELINE_EXPORT_MAX_DURATION_SEC / 60} <I18nText text="minutes" />
        </p>
      </DialogContent>
    </Dialog>
  );
}
