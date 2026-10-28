import { uploadMedia } from "../../lib/api/uploadMedia";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { formatUsd } from "@cinakey/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Box,
  Clapperboard,
  Link2,
  Plus,
  Sparkles,
  Play,
  Download,
  RotateCcw,
  LoaderCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/use-confirm";
import { useAction, useMutation, useQuery } from "@/lib/api/hooks";
import { api } from "@cinakey/backend";
import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { MediaPreview } from "../studio/MediaPreview";
import { ExportDialog } from "./export/ExportDialog";
import { encodePrevizMp4 } from "./export/runExport";

export function BlockoutPage({
  onUseForGeneration,
}: { onUseForGeneration?: (id: string) => void } = {}) {
  const navigate = useNavigate();
  const { canWrite } = useWorkspace();
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const state = useQuery(api.workspace.list, { projectId: projectId as never });
  const ensure = useAction(api.workspace.ensure);
  const generate = useAction(api.workspace.generateStaging);
  const load = useAction(api.workspace.loadStaging);
  const createUpload = useMutation(api.storage.createUploadUrl);
  const createAsset = useMutation(api.storage.createAssetFromUpload);
  const setPreviz = useMutation(api.workspace.setPreviz);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [duration, setDuration] = useState(10);
  const [exportOpen, setExportOpen] = useState(false);
  const [progress, setProgress] = useState("");
  const confirm = useConfirm();
  const loadHistory = useAction(api.workspace.stagingHistory);
  const restore = useAction(api.workspace.restoreStaging);
  const [history, setHistory] = useState<
    Array<{
      fileId: import("@cinakey/backend").Id<"_storage">;
      version: number;
      name: string;
    }>
  >([]);
  useEffect(() => {
    void ensure({ projectId: projectId as never }).catch((error) =>
      setError(
        error instanceof Error ? error.message : "Could not initialize project",
      ),
    );
  }, [projectId, ensure]);
  const selected =
    state?.staging.find((item) => item._id === params.get("staging")) ??
    state?.staging[0];
  const selectedId = selected?._id;
  const selectedFile = selected?.contentFileId;
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void load({ projectId: projectId as never, id: selectedId })
      .then(({ document }) => {
        if (!cancelled) setDuration(document.frames / document.fps);
      })
      .catch((error) => {
        if (!cancelled)
          setError(
            error instanceof Error ? error.message : "Could not load staging",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedFile, projectId, load]);
  const estimate = useQuery(api.workspace.estimateStaging, {
    projectId: projectId as never,
    durationSec: duration,
  });
  const url = useQuery(
    api.storage.getAssetUrl,
    selected?.previzAssetId ? { assetId: selected.previzAssetId } : "skip",
  );
  async function run(reuse = false) {
    if (canWrite === false || busy) return;
    if (
      !reuse &&
      estimate?.usdMicros &&
      !(await confirm({
        title: "Generate staging?",
        description: `Approximately ${formatUsd(estimate.usdMicros)}. Your script and saved staging versions are preserved.`,
        confirmLabel: "Generate staging",
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const result = await generate({
        projectId: projectId as never,
        id: selected?._id,
        durationSec: duration,
        reuse,
      });
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("staging", result.id);
          return next;
        },
        { replace: true },
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Staging failed");
    } finally {
      setBusy(false);
    }
  }
  async function render() {
    if (canWrite === false || !selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { document } = await load({
        projectId: projectId as never,
        id: selected._id,
      });
      const blob = await encodePrevizMp4({
        document,
        signal: new AbortController().signal,
        onProgress: (p) => setProgress(p.label),
      });
      const upload = await createUpload({ projectId: projectId as never });
      const response = await uploadMedia(upload, blob);
      if (!response.ok) throw new Error("Upload failed");
      const { storageId } = await response.json();
      const assetId = await createAsset({
        projectId: projectId as never,
        storageId,
        type: "video",
        name: `${selected.name} previsualization`,
        format: "video/mp4",
        durationSec: document.frames / document.fps,
        tags: ["previz", "blockout"],
      });
      await setPreviz({ id: selected._id, assetId });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Render failed");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  return (
    <section className="studio-staging staging-workspace">
      <h2 className="staging-title">
        <Clapperboard size={20} />
        Staging
      </h2>
      <p className="studio-muted">
        Plan movement and camera timing from your script, or start in the 3D
        editor.
      </p>
      <ol className="staging-workflow" aria-label="Staging workflow">
        <li className={!selected ? "active" : "complete"}>
          <span>1</span>Plan your scene
        </li>
        <li
          className={
            selected && !selected.previzAssetId
              ? "active"
              : selected?.previzAssetId
                ? "complete"
                : ""
          }
        >
          <span>2</span>Render a preview
        </li>
        <li className={selected?.previzAssetId ? "active" : ""}>
          <span>3</span>Use as a reference
        </li>
      </ol>
      <div className="staging-plan-settings">
        <div>
          <label id="staging-document-label">Staging document</label>
          <Select
            disabled={busy || !state?.staging.length}
            value={selected?._id ?? ""}
            onValueChange={(id) => {
              setHistory([]);
              setParams(
                (previous) => {
                  const next = new URLSearchParams(previous);
                  next.set("staging", id);
                  return next;
                },
                { replace: true },
              );
            }}
          >
            <SelectTrigger aria-labelledby="staging-document-label">
              <SelectValue placeholder="No staging documents yet" />
            </SelectTrigger>
            <SelectContent>
              {state?.staging.map((item) => (
                <SelectItem key={item._id} value={item._id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="staging-duration">
          <label htmlFor="staging-duration">
            Duration
            <output htmlFor="staging-duration">
              {Number(duration.toFixed(1))} seconds
            </output>
          </label>
          <input
            id="staging-duration"
            aria-label="Staging duration"
            aria-valuetext={`${Number(duration.toFixed(1))} seconds`}
            type="range"
            min={1}
            max={600}
            step={1}
            value={duration}
            disabled={busy}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
          <div className="staging-duration-limits">
            <span>1s</span>
            <span>600s</span>
          </div>
        </div>
      </div>
      <div className="staging-main-actions">
        <Button
          disabled={canWrite === false || busy || !state?.migrated || !estimate}
          onClick={() => void run()}
        >
          {busy ? (
            <LoaderCircle size={15} className="animate-spin" />
          ) : (
            <Sparkles size={15} />
          )}
          Generate staging
          {estimate?.usdMicros ? ` · ~${formatUsd(estimate.usdMicros)}` : ""}
        </Button>
        <Button variant="outline" asChild>
          <Link
            to={`/projects/${projectId}/blockout/edit${selected ? `?staging=${selected._id}` : ""}`}
          >
            <Box size={15} />
            Open 3D editor
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to={`/projects/${projectId}/blockout/edit?new=1`}>
            <Plus size={15} />
            New document
          </Link>
        </Button>
      </div>
      <section
        className="staging-preview-card"
        aria-label="Staging previsualization"
      >
        <div className="staging-preview-header">
          <h3>Previsualization</h3>
          <Button
            variant="outline"
            size="sm"
            disabled={canWrite === false || !selected || busy}
            onClick={() => void render()}
          >
            <Play size={14} />
            Render preview
          </Button>
        </div>
        {selected?.previzAssetId ? (
          url === undefined ? (
            <p role="status" className="staging-empty-preview">
              Loading previsualization…
            </p>
          ) : (
            <MediaPreview url={url} name={selected.name} />
          )
        ) : (
          <div className="staging-empty-preview">
            <Box size={36} />
            <h3>
              {selected
                ? "Your scene is ready to preview"
                : "Plan your first scene"}
            </h3>
            <p>
              {selected
                ? "Render a preview to review movement and camera timing."
                : "Generate staging from your script, or open the 3D editor to start manually."}
            </p>
          </div>
        )}
      </section>
      <div className="staging-use-reference">
        <Link2 size={20} />
        <div>
          <h3>Use this preview as a video reference</h3>
          <p>Your script and staging stay connected.</p>
        </div>
        <Button
          disabled={
            canWrite === false || busy || !selected?.previzAssetId || !url
          }
          onClick={() => {
            if (!selected?.previzAssetId || !url) return;
            if (onUseForGeneration) onUseForGeneration(selected._id);
            else
              navigate(
                `/projects/${projectId}/studio?staging=${selected._id}&stagingReference=1`,
              );
          }}
        >
          Use for generation
        </Button>
      </div>
      <div className="staging-utility-actions">
        <Button
          variant="outline"
          disabled={canWrite === false || !selected || busy}
          onClick={() => setExportOpen(true)}
        >
          <Download size={15} />
          Export staging
        </Button>
        {selected?.planFileId && (
          <Button
            variant="outline"
            disabled={canWrite === false || busy}
            onClick={() => void run(true)}
          >
            <RotateCcw size={15} />
            Recompile saved plan
          </Button>
        )}
      </div>
      {progress && <p role="status">{progress}</p>}
      {error && (
        <p role="alert" className="studio-error">
          {error}
        </p>
      )}
      {selected && (
        <details className="staging-history">
          <summary>Staging history</summary>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                setHistory(await loadHistory({ id: selected._id }));
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Could not load history",
                );
              }
            }}
          >
            Load saved versions
          </Button>
          {history.map((version) => (
            <p key={version.fileId}>
              {version.name} · v{version.version}{" "}
              <Button
                variant="outline"
                disabled={
                  canWrite === false ||
                  busy ||
                  version.fileId === selected.contentFileId
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    await restore({ id: selected._id, fileId: version.fileId });
                    setHistory([]);
                  } catch (error) {
                    setError(
                      error instanceof Error ? error.message : "Restore failed",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Restore as new version
              </Button>
            </p>
          ))}
        </details>
      )}
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        scopeLabel="Staging document"
        baseName={selected?.name ?? "staging"}
        multiShot
        loadDocument={async () => {
          const result = await load({
            projectId: projectId as never,
            id: selected?._id,
          });
          return { document: result.document };
        }}
      />
    </section>
  );
}
