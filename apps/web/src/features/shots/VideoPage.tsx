import { api } from "@cinakey/backend";
import { COST_CONFIRM_THRESHOLD_CREDITS } from "@cinakey/shared";
import { useAction, useMutation, useQuery } from "convex/react";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCopilotContext } from "@/features/copilot/CopilotContext";
import { cn } from "@/lib/utils";

type Master = {
  assetId: string;
  jobId: string;
  url: string | null;
  durationSec: number;
  estimatedCostCredits: number;
  actualCostCredits: number | null;
  createdAt: number;
  kind: string;
  chosen: boolean;
};

export function VideoPage() {
  const { projectId } = useParams();
  const { setContext } = useCopilotContext();
  const parts = useQuery(
    api.promptSheets.listScriptParts,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const activeJobs = useQuery(
    api.shotGeneration.listActiveJobsForProject,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const spend = useQuery(
    api.shotGeneration.getProjectSpend,
    projectId ? { projectId: projectId as never } : "skip",
  );

  const [activeSequenceId, setActiveSequenceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [usePrevizRef, setUsePrevizRef] = useState(false);

  const startSequence = useAction(api.shotGeneration.startSequenceGeneration);
  const startUpscale = useAction(api.shotGeneration.startMasterUpscale);
  const startExtend = useAction(api.shotGeneration.startMasterExtend);
  const chooseMaster = useMutation(api.shotGeneration.chooseMaster);
  const deleteMaster = useMutation(api.shotGeneration.deleteMaster);

  const resolvedSequenceId =
    activeSequenceId &&
    parts?.some((p) => p.sequenceId === activeSequenceId)
      ? activeSequenceId
      : (parts?.[0]?.sequenceId ?? null);

  const active =
    parts?.find((p) => p.sequenceId === resolvedSequenceId) ?? null;
  const masters = useQuery(
    api.shotGeneration.listSequenceMasters,
    active
      ? { sequenceId: active.sequenceId as never }
      : "skip",
  ) as Master[] | undefined;

  const estimate = useQuery(
    api.generation.estimateCost,
    active
      ? {
          adapterId: "seedance-2.5",
          kind: "text-to-video",
          input: {
            durationSec: Math.min(active.durationSec ?? 30, 30),
            prompt: "sequence",
          },
        }
      : "skip",
  );

  const credits = estimate?.credits ?? 0;
  const overCap =
    spend?.spendCapCredits != null &&
    spend.remaining != null &&
    credits > spend.remaining;

  useEffect(() => {
    if (!projectId) return;
    setContext({
      view: "video",
      projectId,
      selectionIds: active ? [active.sequenceId] : [],
    });
  }, [projectId, active, setContext]);

  const comparePair = useMemo(() => {
    if (!masters || compareIds.length !== 2) return null;
    const a = masters.find((m) => m.assetId === compareIds[0]);
    const b = masters.find((m) => m.assetId === compareIds[1]);
    return a && b ? [a, b] as const : null;
  }, [masters, compareIds]);

  if (!projectId) return null;

  async function runGenerate() {
    if (!active || busy || overCap) return;
    setBusy(true);
    setError(null);
    setConfirmOpen(false);
    try {
      await startSequence({
        sequenceId: active.sequenceId as never,
        usePrevizAsReference: usePrevizRef || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  function onGenerateClick() {
    if (credits >= COST_CONFIRM_THRESHOLD_CREDITS) {
      setConfirmOpen(true);
      return;
    }
    void runGenerate();
  }

  function toggleCompare(assetId: string) {
    setCompareIds((prev) => {
      if (prev.includes(assetId)) return prev.filter((id) => id !== assetId);
      if (prev.length >= 2) return [prev[1]!, assetId];
      return [...prev, assetId];
    });
  }

  async function onChoose(assetId: string) {
    if (!active) return;
    try {
      await chooseMaster({
        sequenceId: active.sequenceId as never,
        masterAssetId: assetId as never,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not choose video");
    }
  }

  async function onDelete(assetId: string, chosen: boolean) {
    if (!active) return;
    if (
      !window.confirm(
        chosen
          ? "Delete the chosen video? Edit will need a new choice."
          : "Delete this video?",
      )
    ) {
      return;
    }
    try {
      await deleteMaster({
        sequenceId: active.sequenceId as never,
        masterAssetId: assetId as never,
      });
      setCompareIds((ids) => ids.filter((id) => id !== assetId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function onUpscale(assetId: string) {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await startUpscale({
        sequenceId: active.sequenceId as never,
        masterAssetId: assetId as never,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upscale failed");
    } finally {
      setBusy(false);
    }
  }

  async function onExtend(assetId: string) {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await startExtend({
        sequenceId: active.sequenceId as never,
        masterAssetId: assetId as never,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extend failed");
    } finally {
      setBusy(false);
    }
  }

  if (parts === undefined) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }

  if (parts.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 pb-16">
        <h1 className="text-xl font-semibold text-zinc-100">Video</h1>
        <p className="text-sm text-zinc-500">Write a script first.</p>
      </div>
    );
  }

  const seqJobs =
    activeJobs?.filter(
      (j) =>
        j.sequenceId === active?.sequenceId &&
        (j.status === "queued" ||
          j.status === "submitted" ||
          j.status === "running"),
    ) ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold text-zinc-100">Video</h1>
        {seqJobs.length > 0 ? (
          <span className="text-xs text-amber-300">Generating…</span>
        ) : null}
      </div>

      {parts.length > 1 ? (
        <div className="flex flex-wrap gap-1 border-b border-zinc-800 pb-2">
          {parts.map((p, i) => (
            <button
              key={p.sequenceId}
              type="button"
              onClick={() => {
                setActiveSequenceId(p.sequenceId);
                setCompareIds([]);
              }}
              className={cn(
                "rounded px-3 py-1.5 text-xs",
                p.sequenceId === active?.sequenceId
                  ? "bg-zinc-100 text-zinc-900"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
              )}
            >
              {p.label || `Part ${i + 1}`}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={busy || overCap || !active}
          onClick={onGenerateClick}
        >
          {busy ? "Starting…" : `Generate video · ${credits} cr`}
        </Button>
        {overCap ? (
          <span className="text-xs text-rose-400">Spend cap reached</span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="ghost">
              <MoreHorizontal className="size-4" />
              <span className="sr-only">More</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 p-2">
            {active?.previzAssetId ? (
              <label className="flex cursor-pointer items-start gap-2 px-1 py-1.5 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={usePrevizRef}
                  onChange={(e) => setUsePrevizRef(e.target.checked)}
                />
                <span>Use pre-viz as reference video</span>
              </label>
            ) : (
              <p className="px-1 py-1.5 text-xs text-zinc-500">
                No pre-viz yet — export from Blockout first.
              </p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      {masters === undefined ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : masters.length === 0 ? (
        <p className="text-sm text-zinc-500">No videos yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {masters.map((m) => (
            <article
              key={m.assetId}
              className={cn(
                "space-y-2 border border-zinc-800 p-2",
                m.chosen && "border-emerald-600/60",
              )}
            >
              {m.url ? (
                <video
                  src={m.url}
                  controls
                  className="aspect-video w-full bg-zinc-950"
                  preload="metadata"
                />
              ) : (
                <div className="flex aspect-video items-center justify-center bg-zinc-950 text-xs text-zinc-500">
                  No preview
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={m.chosen ? "default" : "outline"}
                  disabled={m.chosen}
                  onClick={() => void onChoose(m.assetId)}
                >
                  {m.chosen ? "Chosen" : "Choose"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    compareIds.includes(m.assetId) ? "secondary" : "ghost"
                  }
                  onClick={() => toggleCompare(m.assetId)}
                >
                  Compare
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="sm" variant="ghost">
                      <MoreHorizontal className="size-4" />
                      <span className="sr-only">More</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={busy}
                      onClick={() => void onUpscale(m.assetId)}
                    >
                      Upscale
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={busy}
                      onClick={() => void onExtend(m.assetId)}
                    >
                      Extend
                    </DropdownMenuItem>
                    {m.url ? (
                      <DropdownMenuItem asChild>
                        <a href={m.url} download target="_blank" rel="noreferrer">
                          Download
                        </a>
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      className="text-rose-400"
                      onClick={() => void onDelete(m.assetId, m.chosen)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </article>
          ))}
        </div>
      )}

      {comparePair ? (
        <div className="space-y-2 border border-zinc-800 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-400">Compare</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setCompareIds([])}
            >
              Close
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {comparePair.map((m) => (
              <video
                key={m.assetId}
                src={m.url ?? undefined}
                controls
                className="aspect-video w-full bg-zinc-950"
              />
            ))}
          </div>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm space-y-4 border border-zinc-700 bg-zinc-950 p-4">
            <p className="text-sm text-zinc-200">
              This run costs about {credits} credits. Continue?
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => void runGenerate()}
              >
                Generate
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
