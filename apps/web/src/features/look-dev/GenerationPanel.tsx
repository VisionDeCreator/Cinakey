import { api } from "@cinakey/backend";
import {
  assembleLookDevPrompt,
  type SheetDocument,
} from "@cinakey/shared";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MaskEditor } from "@/features/look-dev/MaskEditor";

type Props = {
  projectId: string;
  entityId: string;
  entityName: string;
  entityDescription?: string;
  sheet: SheetDocument;
  styleSheet: SheetDocument | null;
  projectRules: string[];
  editTarget: { assetId: string; url: string } | null;
  onClearEditTarget: () => void;
  onJobStarted: () => void;
  onDraftSaved: (draftPrompt: string) => void;
};

export function GenerationPanel({
  projectId,
  entityId,
  entityName,
  entityDescription,
  sheet,
  styleSheet,
  projectRules,
  editTarget,
  onClearEditTarget,
  onJobStarted,
  onDraftSaved,
}: Props) {
  const assembled = useMemo(
    () =>
      assembleLookDevPrompt({
        styleSheet,
        entitySheet: sheet,
        entityName,
        entityDescription,
        rules: projectRules,
        userPrompt: sheet.draftPrompt ?? "",
      }),
    [styleSheet, sheet, entityName, entityDescription, projectRules],
  );

  const [prompt, setPrompt] = useState(assembled);
  const [variations, setVariations] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);
  const [maskMode, setMaskMode] = useState(false);
  const [grantMsg, setGrantMsg] = useState<string | null>(null);
  const refIds: string[] = [];

  const startGeneration = useAction(api.generation.startGeneration);
  const startIdentitySet = useAction(api.generation.startIdentitySet);
  const createUploadUrl = useMutation(api.storage.createUploadUrl);
  const createAsset = useMutation(api.storage.createAssetFromUpload);
  const grantDev = useMutation(api.credits.grantDev);

  const estimate = useQuery(api.generation.estimateCost, {
    adapterId: "gpt-image-2",
    kind: editTarget && maskMode ? "image-edit" : "text-to-image",
    input: { imageCount: variations, prompt },
  });

  const jobs = useQuery(api.entities.listJobsForEntity, {
    entityId: entityId as never,
  });

  useEffect(() => {
    setPrompt(assembled);
  }, [assembled]);

  useEffect(() => {
    if (editTarget) {
      setMaskMode(true);
    }
  }, [editTarget]);

  const lockedRefs = sheet.entityKind === "character"
    ? Object.values(sheet.identitySlots ?? {}).filter(Boolean)
    : sheet.entityKind === "style"
      ? (sheet.moodReferenceAssetIds ?? [])
      : (sheet.heroAssetIds ?? []);

  async function runGenerate() {
    setBusy(true);
    setError(null);
    try {
      const refs = [
        ...new Set([...refIds, ...lockedRefs.filter((id): id is string => !!id)]),
      ];
      const result = await startGeneration({
        projectId: projectId as never,
        adapterId: "gpt-image-2",
        kind: "text-to-image",
        prompt,
        entityId: entityId as never,
        imageCount: variations,
        referenceAssetIds: refs.length > 0 ? (refs as never) : undefined,
      });
      setActiveJobIds((prev) => [...prev, result.jobId]);
      onDraftSaved(prompt);
      onJobStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function runIdentitySet() {
    setBusy(true);
    setError(null);
    try {
      const result = await startIdentitySet({
        projectId: projectId as never,
        entityId: entityId as never,
        basePrompt: prompt,
        referenceAssetIds:
          lockedRefs.length > 0 ? (lockedRefs as never) : undefined,
      });
      setActiveJobIds((prev) => [...prev, ...result.jobIds]);
      onJobStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Identity set failed");
    } finally {
      setBusy(false);
    }
  }

  async function runInpaint(maskBlob: Blob) {
    if (!editTarget) return;
    setBusy(true);
    setError(null);
    try {
      const uploadUrl = await createUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: maskBlob,
      });
      if (!res.ok) throw new Error("Mask upload failed");
      const { storageId } = (await res.json()) as { storageId: string };
      const maskAssetId = await createAsset({
        projectId: projectId as never,
        storageId: storageId as never,
        type: "image",
        name: `mask-${Date.now()}.png`,
        format: "image/png",
        entityId: entityId as never,
        tags: ["mask"],
      });

      const result = await startGeneration({
        projectId: projectId as never,
        adapterId: "gpt-image-2",
        kind: "image-edit",
        prompt,
        entityId: entityId as never,
        parentAssetIds: [editTarget.assetId as never],
        maskAssetId: maskAssetId as never,
        referenceAssetIds: refIds.length > 0 ? (refIds as never) : undefined,
      });
      setActiveJobIds((prev) => [...prev, result.jobId]);
      setMaskMode(false);
      onClearEditTarget();
      onJobStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inpaint failed");
    } finally {
      setBusy(false);
    }
  }

  const recentJobs = (jobs ?? []).slice(0, 5);

  return (
    <div className="space-y-4 border border-zinc-800 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-200">Generate</h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setGrantMsg(null);
            void grantDev({ amount: 100 })
              .then(() => setGrantMsg("Granted 100 credits"))
              .catch((err) =>
                setGrantMsg(
                  err instanceof Error ? err.message : "Grant failed",
                ),
              );
          }}
        >
          Grant 100 credits (dev)
        </Button>
      </div>
      {grantMsg ? (
        <p
          className={`text-xs ${
            grantMsg.startsWith("Granted")
              ? "text-emerald-400"
              : "text-amber-400"
          }`}
        >
          {grantMsg}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="gen-prompt">Prompt</Label>
        <Textarea
          id="gen-prompt"
          rows={6}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="font-mono text-xs"
        />
        <p className="text-xs text-zinc-500">
          Prefills from style sheet + entity fields + project rules. Edit before
          running.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          Variations
          <input
            type="number"
            min={1}
            max={4}
            value={variations}
            onChange={(e) =>
              setVariations(Math.min(4, Math.max(1, Number(e.target.value) || 1)))
            }
            className="h-8 w-14 rounded border border-zinc-700 bg-zinc-950 px-2 text-sm"
          />
        </label>
        <p className="text-sm text-zinc-300">
          Est.{" "}
          <span className="font-medium text-zinc-100">
            {estimate?.credits ?? "…"} credits
          </span>
          {variations > 1 && estimate
            ? ` (${variations} × image)`
            : null}
        </p>
      </div>

      {lockedRefs.length > 0 || refIds.length > 0 ? (
        <p className="text-xs text-zinc-500">
          Using {(refIds.length || 0) + lockedRefs.length} reference image(s)
          (locked + selected).
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || !prompt.trim()}
          onClick={() => void runGenerate()}
        >
          {busy ? "Queuing…" : "Generate"}
        </Button>
        {sheet.entityKind === "character" ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !prompt.trim()}
            onClick={() => void runIdentitySet()}
          >
            Generate identity set (4)
          </Button>
        ) : null}
        {editTarget ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => setMaskMode(true)}
          >
            Edit with mask
          </Button>
        ) : null}
      </div>

      {maskMode && editTarget ? (
        <MaskEditor
          imageUrl={editTarget.url}
          onCancel={() => {
            setMaskMode(false);
            onClearEditTarget();
          }}
          onApply={(blob) => void runInpaint(blob)}
        />
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {recentJobs.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Recent jobs
          </p>
          <ul className="space-y-2 text-xs text-zinc-400">
            {recentJobs.map((job) => {
              const terminal =
                job.status === "succeeded" ||
                job.status === "failed" ||
                job.status === "refunded";
              const showLive =
                activeJobIds.includes(job._id) && !terminal;
              return (
                <li key={job._id} className="space-y-0.5">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{job.kind}</span>
                    <span
                      className={
                        job.status === "succeeded"
                          ? "shrink-0 text-emerald-400"
                          : job.status === "failed" ||
                              job.status === "refunded"
                            ? "shrink-0 text-red-400"
                            : "shrink-0 text-amber-400"
                      }
                    >
                      {job.status}
                      {showLive ? " · live" : ""}
                    </span>
                  </div>
                  {job.errorMessage ? (
                    <p className="break-words text-[11px] leading-snug text-red-400/90">
                      {job.errorMessage}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
