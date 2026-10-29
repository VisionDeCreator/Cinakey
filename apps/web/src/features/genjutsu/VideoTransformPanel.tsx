import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatUsd } from "@dirrio/ui/i18n";
import { useDraftScope } from "@/features/workspaces/workspace-context";
import { useEffect, useRef, useState, type Ref } from "react";
import { api } from "@dirrio/backend";
import {
  TRANSFORM_TARGETS,
  compileVideoTransform,
  transformAnalysisUsdMicros,
  transformDuration,
  type TransformAnalysis,
  type TransformTarget,
  type VideoTransform,
  resolveTransformPrompt,
  type ReferenceBinding,
} from "@dirrio/shared";
import { useAction, useMutation, useQuery } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import {
  ReferencePromptEditor,
  type ReferencePromptHandle,
} from "./ReferencePromptEditor";
import { sampleVideoFrames } from "./sampleVideoFrames";

type Media = { _id: string; name: string; type: string; durationSec?: number };
export function VideoTransformPanel({
  projectId,
  assets,
  sourceId,
  sourceUrl,
  running,
  remaining,
  onStarted,
  uploading = false,
  onBusyChange,
  assetUrls = [],
  referenceEditorRef,
}: {
  projectId: string;
  assets: Media[];
  sourceId: string | null;
  sourceUrl: string | null;
  running: boolean;
  remaining?: number;
  onStarted: (message: string) => void;
  uploading?: boolean;
  onBusyChange?: (busy: boolean) => void;
  assetUrls?: { assetId: string; url: string | null }[];
  referenceEditorRef?: Ref<ReferencePromptHandle>;
}) {
  useLocale();
  const analyze = useAction(api.transforms.analyze);
  const generate = useAction(api.transforms.generate);
  const [targets, setTargets] = useState<TransformTarget[]>([]);
  const draftScope = useDraftScope();
  const draftKey = `dirrio.genjutsuPrompt.${draftScope}${projectId}`;
  const [instruction, setInstruction] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  });
  function editInstruction(value: string) {
    setInstruction(value);
    try {
      localStorage.setItem(draftKey, value);
    } catch {
      /* Browser recovery is optional. */
    }
  }
  const bindings =
    useQuery(api.references.list, { projectId: projectId as never }) ?? [];
  const bind = useMutation(api.references.bind);
  const [bindingBusy, setBindingBusy] = useState(false);
  async function bindImage(
    alias: string,
    assetId: string,
    expectedAssetId?: string,
  ) {
    setBindingBusy(true);
    try {
      await bind({
        projectId: projectId as never,
        alias,
        assetId: assetId as never,
        expectedAssetId: expectedAssetId as never,
      });
    } finally {
      setBindingBusy(false);
    }
  }
  const resolvedReferences = resolveTransformPrompt(
    instruction,
    bindings as ReferenceBinding[],
    assets.map((asset) => ({
      assetId: asset._id,
      name: asset.name,
      type: asset.type,
    })),
    sourceId,
  );
  const references = resolvedReferences.imageIds;

  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [preserveCamera, setPreserveCamera] = useState(true);
  const [preserveMotion, setPreserveMotion] = useState(true);
  const [review, setReview] = useState<{
    key: string;
    analysis: TransformAnalysis;
    usdMicros: number;
    settlementPending?: boolean;
    sampledFrameTimes: number[];
  } | null>(null);
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "sampling" | "analyzing" | "submitting" | null
  >(null);
  const busy = phase !== null;
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const request = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const source = assets.find(
    (asset) => asset._id === sourceId && asset.type === "video",
  );
  let duration = 0;
  try {
    duration = transformDuration(source?.durationSec ?? NaN);
  } catch {
    /* Metadata is required. */
  }
  const estimate = useQuery(api.generation.estimateCost, {
    adapterId: "sume-remix-lite",
    kind: "text-to-video",
    input: {
      durationSec: duration || 5,
      resolution,
      prompt: "Transform video",
    },
  });
  const cost = estimate?.usdMicros ?? 0;
  const analysisCost = transformAnalysisUsdMicros(8, references.length);
  const analysisKey = JSON.stringify([
    sourceId,
    instruction.trim(),
    references,
  ]);
  const currentReview = review?.key === analysisKey ? review : null;
  const referenceIssues = [
    ...resolvedReferences.unresolved.map((alias) =>
      t("Link missing image @{0}.", { 0: alias }),
    ),
    ...resolvedReferences.ambiguous.map((alias) =>
      t("Choose which image @{0} refers to.", { 0: alias }),
    ),
    ...(references.length === 0
      ? ["Add at least one image reference for Remix."]
      : []),
    ...(references.length > 8
      ? ["Use up to eight distinct image references."]
      : []),
  ];
  const invalidReferences = bindingBusy || referenceIssues.length > 0;
  const ready = Boolean(
    source &&
    sourceUrl &&
    duration &&
    instruction.trim() &&
    !invalidReferences &&
    !uploading,
  );
  const plan: VideoTransform | null = currentReview
    ? {
        version: 1,
        targets,
        instruction: instruction.trim(),
        preserveCamera,
        preserveMotion,
        analysis: currentReview.analysis,
        analysisModel: "deepseek-flash",
        sampledFrameTimes: currentReview.sampledFrameTimes,
      }
    : null;
  // The key deliberately excludes model output so a retry keeps the same identity.
  const renderKey = JSON.stringify([
    analysisKey,
    targets,
    preserveCamera,
    preserveMotion,
    resolution,
  ]);
  const totalCost = cost + (currentReview ? 0 : analysisCost);
  async function renderTransform() {
    if (
      !ready ||
      !sourceId ||
      !sourceUrl ||
      inFlight.current ||
      running ||
      !cost ||
      submittedKey === renderKey ||
      (remaining != null && totalCost > remaining)
    )
      return;
    inFlight.current = true;
    onBusyChange?.(true);
    setError(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      let analyzed = currentReview;
      if (!analyzed) {
        setPhase("sampling");
        const frames = await sampleVideoFrames(sourceUrl, abort.signal);
        abort.signal.throwIfAborted();
        setPhase("analyzing");
        const result = await analyze({
          maxCostUsdMicros: analysisCost,
          projectId: projectId as never,
          sourceAssetId: sourceId as never,
          referenceAssetIds: references as never[],
          instruction: instruction.trim(),
          frames,
        });
        abort.signal.throwIfAborted();
        analyzed = {
          ...result,
          key: analysisKey,
          sampledFrameTimes: frames.map((frame) => frame.timeSec),
        };
        setReview(analyzed);
      }
      abort.signal.throwIfAborted();
      const generationPlan: VideoTransform = {
        version: 1,
        targets,
        instruction: instruction.trim(),
        preserveCamera,
        preserveMotion,
        analysis: analyzed.analysis,
        analysisModel: "deepseek-flash",
        sampledFrameTimes: analyzed.sampledFrameTimes,
      };
      setPhase("submitting");
      if (request.current?.key !== renderKey)
        request.current = { key: renderKey, id: crypto.randomUUID() };
      await generate({
        maxCostUsdMicros: cost,
        projectId: projectId as never,
        sourceAssetId: sourceId as never,
        referenceAssetIds: references as never[],
        plan: generationPlan,
        resolution,
        requestId: request.current.id,
      });
      if (!abort.signal.aborted) {
        setSubmittedKey(renderKey);
        onStarted(
          "Transformation started. The new version will appear in this session.",
        );
      }
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Could not start transformation",
        );
    } finally {
      inFlight.current = false;
      onBusyChange?.(false);
      if (!abort.signal.aborted) setPhase(null);
    }
  }
  return (
    <section
      className="transform-generation-settings"
      aria-label={t("Transform video")}
    >
      <h2>
        <I18nText text="Transform video" />
      </h2>
      <p className="transform-muted">
        <I18nText text="Upload or select a source video on the left. Transform uses the whole video." />
      </p>
      <label>
        <I18nText text="Source" />
        <span>{source?.name ?? t("Select a video")}</span>
      </label>
      {!duration && (
        <p className="transform-muted">
          <I18nText text="Source needs saved duration metadata and must be 4–15 seconds." />
        </p>
      )}
      <fieldset disabled={busy || uploading} className="transform-fields">
        <ReferencePromptEditor
          ref={referenceEditorRef}
          projectId={projectId}
          sourceAssetId={sourceId}
          value={instruction}
          onChange={editInstruction}
          assets={assets}
          urls={assetUrls}
          bindings={bindings as ReferenceBinding[]}
          disabled={busy || uploading || bindingBusy}
          onBind={bindImage}
        />
        {referenceIssues.map((issue) => (
          <p key={issue} role="alert" className="transform-error">
            {issue}
          </p>
        ))}
        <div
          role="group"
          aria-label={t("What to change (optional)")}
          className="transform-targets"
        >
          <p>
            <I18nText text="What to change" />{" "}
            <span>
              <I18nText text="(optional)" />
            </span>
          </p>
          <p className="transform-muted">
            <I18nText text="Your prompt determines what changes. Select any combination below for extra guidance, or leave all unchecked." />
          </p>
          <div className="transform-target-options">
            {TRANSFORM_TARGETS.map((target) => (
              <label key={target.id} className="transform-target-option">
                <input
                  type="checkbox"
                  checked={targets.includes(target.id)}
                  onChange={(event) =>
                    setTargets((old) =>
                      event.target.checked
                        ? [...old, target.id]
                        : old.filter((id) => id !== target.id),
                    )
                  }
                />
                <span>{t(target.label)}</span>
              </label>
            ))}
          </div>
        </div>
        <label className="transform-check">
          <input
            type="checkbox"
            checked={preserveCamera}
            onChange={(e) => setPreserveCamera(e.target.checked)}
          />
          <I18nText text="Follow source camera" />
        </label>
        <label className="transform-check">
          <input
            type="checkbox"
            checked={preserveMotion}
            onChange={(e) => setPreserveMotion(e.target.checked)}
          />
          <I18nText text="Follow source motion and timing" />
        </label>
        <label>
          <I18nText text="Resolution" />
          <Select
            value={resolution}
            onValueChange={(value) => setResolution(value as "720p" | "1080p")}
            disabled={running || uploading}
          >
            <SelectTrigger aria-label={t("Resolution")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="720p">720p</SelectItem>
              <SelectItem value="1080p">1080p</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </fieldset>
      {currentReview && (
        <details className="transform-review">
          <summary>
            <I18nText text="Video analysis and generation details" />
          </summary>
          <h3>
            <I18nText text="Source analysis ·" />{" "}
            {currentReview.settlementPending
              ? t("Usage pending review; funds remain reserved")
              : formatUsd(currentReview.usdMicros)}
          </h3>
          {(["subjects", "action", "camera", "setting"] as const).map(
            (field) => (
              <p key={field}>
                <strong>{t(field)}: </strong>
                {currentReview.analysis[field]}
              </p>
            ),
          )}
          {currentReview.analysis.uncertainties.map((text, index) => (
            <p className="transform-muted" key={index}>
              {text}
            </p>
          ))}
          <details>
            <summary>
              <I18nText text="Review generation instructions" />
            </summary>
            <pre>
              {ready &&
                plan &&
                compileVideoTransform(
                  { ...plan, instruction: resolvedReferences.prompt },
                  references.map(
                    (id) =>
                      assets.find((asset) => asset._id === id)?.name ?? id,
                  ),
                )}
            </pre>
          </details>
        </details>
      )}
      <p className="transform-muted">
        <I18nText text="Remix uses the original video and selected images. Preservation is a generation instruction, not a pixel lock. Output requests" />{" "}
        {duration || "—"}{" "}
        <I18nText text="seconds for billing, rounded up. Remix follows the source duration and aspect ratio." />
      </p>
      <Button
        disabled={
          submittedKey === renderKey ||
          !ready ||
          busy ||
          running ||
          !cost ||
          (remaining != null && totalCost > remaining)
        }
        onClick={() => void renderTransform()}
      >
        {phase === "sampling"
          ? t("Preparing video…")
          : phase === "analyzing"
            ? t("Analyzing video…")
            : phase === "submitting"
              ? t("Starting generation…")
              : submittedKey === renderKey
                ? t("Transformation queued")
                : t("Generate · {0}", {
                    0: duration
                      ? `${currentReview ? "" : "up to "}${formatUsd(totalCost)}`
                      : "—",
                  })}
      </Button>
      <p className="transform-muted" role={busy ? "status" : undefined}>
        {busy
          ? phase === "sampling"
            ? t("Preparing frames for automatic analysis.")
            : phase === "analyzing"
              ? t(
                  "Analyzing the video automatically. Generation will start next.",
                )
              : t("Submitting your remix.")
          : currentReview
            ? t("Video analysis is ready and will be reused for these inputs.")
            : t(
                "Includes automatic video analysis and rendering. Unused reserved analysis funds are returned.",
              )}
      </p>
      {submittedKey === renderKey && !running && (
        <Button
          variant="outline"
          onClick={() => {
            request.current = null;
            setSubmittedKey(null);
          }}
        >
          <I18nText text="Prepare another version" />
        </Button>
      )}
      {remaining != null && totalCost > remaining && (
        <p className="transform-muted">
          <I18nText text="Session spend cap reached." />
        </p>
      )}
      {error && (
        <p role="alert" className="transform-error">
          {t(error ?? "")}
        </p>
      )}
    </section>
  );
}
