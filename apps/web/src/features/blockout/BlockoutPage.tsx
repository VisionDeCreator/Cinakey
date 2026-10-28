import { uploadMedia } from "../../lib/api/uploadMedia";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { formatUsd } from "@cinakey/shared";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/use-confirm";
import { useAction, useMutation, useQuery } from "@/lib/api/hooks";
import { api } from "@cinakey/backend";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { MediaPreview } from "../studio/MediaPreview";
import { ExportDialog } from "./export/ExportDialog";
import { encodePrevizMp4 } from "./export/runExport";

export function BlockoutPage() {
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
      setParams({ staging: result.id }, { replace: true });
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
    <section className="studio-staging">
      <h2>Staging</h2>
      <p className="studio-muted">
        Plan movement and camera timing from your script, or start in the 3D
        editor.
      </p>
      {state?.staging.length ? (
        <label>
          Document
          <select
            aria-label="Staging document"
            value={selected?._id ?? ""}
            onChange={(e) =>
              setParams({ staging: e.target.value }, { replace: true })
            }
          >
            {state.staging.map((item) => (
              <option key={item._id} value={item._id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>
          No staging yet. Generate from your script or open the 3D editor to
          start manually.
        </p>
      )}
      <label>
        Duration (seconds)
        <input
          aria-label="Staging duration"
          type="number"
          min={1}
          max={600}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={canWrite === false || busy || !state?.migrated || !estimate}
          onClick={() => void run()}
        >
          Generate staging
          {estimate?.usdMicros ? ` · ~${formatUsd(estimate.usdMicros)}` : ""}
        </Button>
        {selected?.planFileId && (
          <Button
            variant="outline"
            disabled={canWrite === false || busy}
            onClick={() => void run(true)}
          >
            Recompile saved plan
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link to={`/projects/${projectId}/blockout/edit?new=1`}>
            New staging document
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link
            to={`/projects/${projectId}/blockout/edit${selected ? `?staging=${selected._id}` : ""}`}
          >
            Open 3D editor
          </Link>
        </Button>
        <Button
          variant="outline"
          disabled={canWrite === false || !selected || busy}
          onClick={() => void render()}
        >
          Render previsualization
        </Button>
        <Button
          variant="outline"
          disabled={canWrite === false || !selected || busy}
          onClick={() => setExportOpen(true)}
        >
          Export staging
        </Button>
      </div>
      {selected?.previzAssetId &&
        (url === undefined ? (
          <p role="status">Loading previsualization…</p>
        ) : (
          <MediaPreview url={url} name={selected.name} />
        ))}
      {progress && <p role="status">{progress}</p>}
      {error && (
        <p role="alert" className="studio-error">
          {error}
        </p>
      )}
      {selected && (
        <details>
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
