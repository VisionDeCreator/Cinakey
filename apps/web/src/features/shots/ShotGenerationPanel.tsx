import { api } from "@cinakey/backend";
import { COST_CONFIRM_THRESHOLD_CREDITS } from "@cinakey/shared";
import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Caps = {
  id: string;
  operations: string[];
  inputs: string[];
  durations?: number[];
  resolutions?: string[];
  aspectRatios?: string[];
  features: string[];
  maxDurationSec?: number;
};

type Props = {
  projectId: string;
  shotId: string;
  sequenceId: string | null;
  initialPrompt: string;
  guideKeyframeAssetId: string | null;
  keyframeAssetId: string | null;
  onStarted: () => void;
};

export function ShotGenerationPanel({
  projectId,
  shotId,
  sequenceId,
  initialPrompt,
  guideKeyframeAssetId,
  keyframeAssetId,
  onStarted,
}: Props) {
  const capsList = useQuery(api.generation.listCapabilities);
  const spend = useQuery(api.shotGeneration.getProjectSpend, {
    projectId: projectId as never,
  });
  const assemble = useAction(api.shotGeneration.assemblePromptAction);
  const startShot = useAction(api.shotGeneration.startShotGeneration);
  const startSequence = useAction(api.shotGeneration.startSequenceGeneration);

  const seedance = useMemo(
    () =>
      (capsList ?? []).find((c) => c.id === "seedance-2.5") as Caps | undefined,
    [capsList],
  );

  const [mode, setMode] = useState<"shot" | "sequence">("shot");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [resolution, setResolution] = useState("720p");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [durationSec, setDurationSec] = useState(5);
  const [cameraPreset, setCameraPreset] = useState("");
  const [useStartFrame, setUseStartFrame] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setPrompt(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    if (!seedance) return;
    if (seedance.resolutions?.[0]) setResolution(seedance.resolutions[0]);
    if (seedance.aspectRatios?.[0]) setAspectRatio(seedance.aspectRatios[0]);
    if (seedance.durations?.[0]) setDurationSec(seedance.durations[0]);
  }, [seedance]);

  useEffect(() => {
    if (!sequenceId || initialPrompt) return;
    void assemble({
      sequenceId: sequenceId as never,
      shotId: shotId as never,
    }).then((r) => {
      setPrompt(r.prompt);
      setDurationSec(Math.round(r.durationSec));
      setAspectRatio(r.aspectRatio);
    });
  }, [sequenceId, shotId, assemble, initialPrompt]);

  const estimate = useQuery(api.generation.estimateCost, {
    adapterId: "seedance-2.5",
    kind:
      mode === "sequence"
        ? "text-to-video"
        : useStartFrame && (guideKeyframeAssetId || keyframeAssetId)
          ? "image-to-video"
          : "text-to-video",
    input: {
      durationSec:
        mode === "sequence"
          ? (seedance?.maxDurationSec ?? 30)
          : durationSec,
      prompt,
    },
  });

  const credits = estimate?.credits ?? 0;
  const overCap =
    spend?.spendCapCredits !== null &&
    spend?.spendCapCredits !== undefined &&
    spend.remaining !== null &&
    credits > (spend.remaining ?? 0);

  async function run() {
    if (!sequenceId) {
      setError("Shot must belong to a sequence with an approved script prompt.");
      return;
    }
    setBusy(true);
    setError(null);
    setConfirmOpen(false);
    try {
      if (mode === "sequence") {
        await startSequence({
          sequenceId: sequenceId as never,
          promptOverride: prompt,
          resolution,
          aspectRatio,
          cameraPreset: cameraPreset || undefined,
        });
      } else {
        const startFrame =
          useStartFrame && seedance?.inputs.includes("startFrame")
            ? ((guideKeyframeAssetId ?? keyframeAssetId) as never)
            : undefined;
        await startShot({
          shotId: shotId as never,
          promptOverride: prompt,
          startFrameAssetId: startFrame,
          resolution,
          aspectRatio,
          durationSec,
          cameraPreset: cameraPreset || undefined,
        });
      }
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onGenerateClick() {
    if (overCap) {
      setError(
        `Spend cap reached (${spend?.spentCredits}/${spend?.spendCapCredits} credits).`,
      );
      return;
    }
    if (credits > COST_CONFIRM_THRESHOLD_CREDITS) {
      setConfirmOpen(true);
      return;
    }
    void run();
  }

  if (!seedance) {
    return (
      <p className="text-xs text-zinc-500">Loading Seedance capabilities…</p>
    );
  }

  const showStartFrame = seedance.inputs.includes("startFrame");
  const showEndFrame = seedance.inputs.includes("endFrame");
  const showCamera = seedance.features.includes("cameraControl");
  const showRefs = seedance.inputs.includes("referenceImages");

  return (
    <div className="space-y-4 border border-zinc-800 bg-zinc-950/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-100">Generate</h3>
        <div className="flex gap-1 text-[11px]">
          <button
            type="button"
            className={`px-2 py-1 ${
              mode === "shot"
                ? "bg-zinc-200 text-zinc-900"
                : "bg-zinc-800 text-zinc-400"
            }`}
            onClick={() => setMode("shot")}
          >
            This shot
          </button>
          <button
            type="button"
            className={`px-2 py-1 ${
              mode === "sequence"
                ? "bg-zinc-200 text-zinc-900"
                : "bg-zinc-800 text-zinc-400"
            }`}
            disabled={!sequenceId}
            onClick={() => setMode("sequence")}
          >
            Full sequence
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-zinc-400">Prompt</Label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={12}
          className="font-mono text-[11px] leading-relaxed"
        />
      </div>

      {showRefs ? (
        <p className="text-[11px] text-zinc-500">
          Reference images come from the script prompt @image_N map (locked
          identity sets).
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {seedance.resolutions ? (
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">Resolution</Label>
            <select
              className="h-8 w-full border border-zinc-700 bg-zinc-900 px-2 text-xs"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            >
              {seedance.resolutions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {seedance.aspectRatios ? (
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">Aspect ratio</Label>
            <select
              className="h-8 w-full border border-zinc-700 bg-zinc-900 px-2 text-xs"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
            >
              {seedance.aspectRatios.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {mode === "shot" && seedance.durations ? (
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">Duration</Label>
            <select
              className="h-8 w-full border border-zinc-700 bg-zinc-900 px-2 text-xs"
              value={durationSec}
              onChange={(e) => setDurationSec(Number(e.target.value))}
            >
              {seedance.durations.map((d) => (
                <option key={d} value={d}>
                  {d}s
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {showCamera ? (
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">Camera preset</Label>
            <select
              className="h-8 w-full border border-zinc-700 bg-zinc-900 px-2 text-xs"
              value={cameraPreset}
              onChange={(e) => setCameraPreset(e.target.value)}
            >
              <option value="">Default</option>
              <option value="static">Static</option>
              <option value="pan_left">Pan left</option>
              <option value="pan_right">Pan right</option>
              <option value="dolly_in">Dolly in</option>
              <option value="dolly_out">Dolly out</option>
              <option value="orbit">Orbit</option>
            </select>
          </div>
        ) : null}
      </div>

      {mode === "shot" && showStartFrame ? (
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={useStartFrame}
            onChange={(e) => setUseStartFrame(e.target.checked)}
          />
          Use blockout keyframe / storyboard as start frame
          {!guideKeyframeAssetId && !keyframeAssetId ? (
            <span className="text-zinc-600">(none available)</span>
          ) : null}
        </label>
      ) : null}

      {/* endFrame supported by manifest but no UI picker for custom end yet —
          only shown when we have a dedicated control; hide for now since we
          don't have an end-frame asset picker beyond guides. */}
      {showEndFrame ? null : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-zinc-400">
          Est.{" "}
          <span className="tabular-nums text-zinc-200">{credits}</span> credits
          {spend?.spendCapCredits != null ? (
            <span className="ml-2 text-zinc-500">
              · cap {spend.spentCredits}/{spend.spendCapCredits}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          disabled={busy || !sequenceId || overCap}
          onClick={onGenerateClick}
        >
          {busy ? "Queuing…" : "Generate"}
        </Button>
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm space-y-4 border border-zinc-700 bg-zinc-950 p-4">
            <h4 className="text-sm font-medium text-zinc-100">Confirm cost</h4>
            <p className="text-xs text-zinc-400">
              This run is estimated at{" "}
              <strong className="text-zinc-200">{credits} credits</strong>{" "}
              (above the {COST_CONFIRM_THRESHOLD_CREDITS}-credit confirmation
              threshold). Continue?
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button type="button" disabled={busy} onClick={() => void run()}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
