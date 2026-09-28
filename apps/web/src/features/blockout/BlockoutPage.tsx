import { api } from "@cinakey/backend";
import { useAction, useMutation, useQuery } from "convex/react";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExportDialog } from "@/features/blockout/export/ExportDialog";
import {
  encodePrevizMp4,
  type ExportProgress,
} from "@/features/blockout/export/runExport";
import { useCopilotContext } from "@/features/copilot/CopilotContext";
import { cn } from "@/lib/utils";

export function BlockoutPage() {
  const { projectId } = useParams();
  const { setContext } = useCopilotContext();
  const parts = useQuery(
    api.promptSheets.listScriptParts,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const tips = useQuery(
    api.promptSheets.pipelineSummary,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const exportDocument = useAction(api.blockouts.exportDocument);
  const updateBlockout = useAction(api.sequences.updateBlockoutFromScript);
  const setPrevizAsset = useAction(api.sequences.setPrevizAsset);
  const createUploadUrl = useMutation(api.storage.createUploadUrl);
  const createAsset = useMutation(api.storage.createAssetFromUpload);

  const [activeSequenceId, setActiveSequenceId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!parts || parts.length === 0) return;
    if (
      !activeSequenceId ||
      !parts.some((p) => p.sequenceId === activeSequenceId)
    ) {
      setActiveSequenceId(parts[0]!.sequenceId);
    }
  }, [parts, activeSequenceId]);

  const active =
    parts?.find((p) => p.sequenceId === activeSequenceId) ?? parts?.[0];

  const previzUrl = useQuery(
    api.storage.getAssetUrl,
    active?.previzAssetId
      ? { assetId: active.previzAssetId as never }
      : "skip",
  );

  const blockoutRendered = useMemo(() => {
    if (!active || !tips) return null;
    const sheet = tips.blockoutSheets.find(
      (s) => s.sequenceId === active.sequenceId,
    );
    return sheet?.renderedText ?? null;
  }, [active, tips]);

  useEffect(() => {
    if (!projectId) return;
    setContext({
      view: "blockout",
      projectId,
      selectionIds: active ? [active.sequenceId] : [],
    });
  }, [projectId, active, setContext]);

  if (!projectId) return null;

  const onUpdate = async () => {
    if (!active || updating) return;
    setUpdating(true);
    setError(null);
    setStatusLine(null);
    const ac = new AbortController();
    try {
      setProgress({ label: "Updating blockout…", fraction: 0.05 });
      const result = await updateBlockout({
        projectId: projectId as never,
        sequenceId: active.sequenceId as never,
      });
      setStatusLine(
        `Rebuilt ${result.rebuiltCount} shots; kept ${result.keptCount}.`,
      );
      setProgress({ label: "Exporting pre-viz…", fraction: 0.35 });
      const { document } = await exportDocument({
        projectId: projectId as never,
      });
      const blob = await encodePrevizMp4({
        document,
        signal: ac.signal,
        onProgress: (p) =>
          setProgress({
            label: p.label,
            fraction: 0.35 + p.fraction * 0.55,
          }),
      });
      setProgress({ label: "Uploading pre-viz…", fraction: 0.92 });
      const uploadUrl = await createUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "video/mp4" },
        body: blob,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: string };
      const assetId = await createAsset({
        projectId: projectId as never,
        storageId: storageId as never,
        type: "video",
        name: `${active.label} pre-viz`,
        format: "video/mp4",
        tags: ["previz", "blockout"],
        durationSec: active.durationSec,
      });
      await setPrevizAsset({
        sequenceId: active.sequenceId as never,
        previzAssetId: assetId as never,
      });
      setProgress({ label: "Done", fraction: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(false);
      setTimeout(() => setProgress(null), 800);
    }
  };

  const firstShotId = active?.shotIds?.[0];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-sm font-medium text-zinc-200">Blockout</h1>
        {(parts?.length ?? 0) > 1 ? (
          <div className="flex gap-1">
            {parts!.map((p, i) => (
              <button
                key={p.sequenceId}
                type="button"
                onClick={() => setActiveSequenceId(p.sequenceId)}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  p.sequenceId === active?.sequenceId
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {p.label || `Part ${i + 1}`}
              </button>
            ))}
          </div>
        ) : null}
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="ghost" className="h-8">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">More</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {firstShotId ? (
                <DropdownMenuItem asChild>
                  <Link
                    to={`/projects/${projectId}/blockout/shots/${firstShotId}`}
                  >
                    Open shot in 3D editor
                  </Link>
                </DropdownMenuItem>
              ) : null}
              {(active?.shotIds ?? []).slice(0, 8).map((id, i) => (
                <DropdownMenuItem key={id} asChild>
                  <Link to={`/projects/${projectId}/blockout/shots/${id}`}>
                    Shot {i + 1}
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onClick={() => setSheetOpen(true)}
                disabled={!blockoutRendered}
              >
                View blockout sheet
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setExportOpen(true)}>
                Export JSON / MP4
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {active?.scriptChanged ? (
        <div className="flex flex-wrap items-center gap-3 border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-200">Script changed</p>
          <Button
            type="button"
            size="sm"
            disabled={updating}
            onClick={() => void onUpdate()}
          >
            {updating ? "Updating…" : "Update blockout and pre-viz"}
          </Button>
        </div>
      ) : null}

      {progress ? (
        <div className="space-y-1">
          <p className="text-[11px] text-zinc-400">{progress.label}</p>
          <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-800">
            <div
              className="h-full bg-zinc-400 transition-[width]"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {statusLine ? (
        <p className="text-[11px] text-zinc-400">{statusLine}</p>
      ) : null}
      {error ? <p className="text-[11px] text-red-300">{error}</p> : null}

      <div className="flex min-h-0 flex-1 items-center justify-center border border-zinc-800 bg-zinc-950">
        {previzUrl ? (
          <video
            key={previzUrl}
            src={previzUrl}
            controls
            className="max-h-full max-w-full"
          />
        ) : (
          <div className="px-6 text-center">
            <p className="text-sm text-zinc-400">
              {active
                ? "No pre-viz yet. Update blockout and pre-viz to build it from the script."
                : "Write a script first, then build the blockout here."}
            </p>
            {active && !active.scriptChanged ? (
              <Button
                type="button"
                size="sm"
                className="mt-3"
                disabled={updating}
                onClick={() => void onUpdate()}
              >
                Build blockout and pre-viz
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {exportOpen ? (
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          scopeLabel="Whole project"
          baseName="blockout"
          multiShot
          loadDocument={async () => {
            const result = await exportDocument({
              projectId: projectId as never,
            });
            return {
              document: result.document,
              skippedCount: result.skippedShotIds?.length,
            };
          }}
        />
      ) : null}

      {sheetOpen && blockoutRendered ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col border border-zinc-700 bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
              <p className="text-xs text-zinc-300">Blockout sheet</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSheetOpen(false)}
              >
                Close
              </Button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] text-zinc-400">
              {blockoutRendered}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
