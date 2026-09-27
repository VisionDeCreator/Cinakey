import { api } from "@cinakey/backend";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { KeyframeSketch } from "@/features/blockout/KeyframeSketch";

type Props = {
  projectId: string;
  sceneId: string;
  shotId: string;
  keyframeUrl: string | null;
};

export function KeyframePanel({
  projectId,
  sceneId,
  shotId,
  keyframeUrl,
}: Props) {
  const jobs = useQuery(api.shots.listJobsForShot, {
    shotId: shotId as never,
  });
  const loadContext = useAction(api.shots.getKeyframePromptContext);
  const startGeneration = useAction(api.generation.startGeneration);
  const setKeyframe = useMutation(api.shots.setKeyframe);
  const clearKeyframe = useMutation(api.shots.clearKeyframe);
  const { uploadFiles } = useAssetUpload(projectId);

  const [prompt, setPrompt] = useState("");
  const [referenceAssetIds, setReferenceAssetIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sketchOpen, setSketchOpen] = useState(false);

  const estimate = useQuery(api.generation.estimateCost, {
    adapterId: "gpt-image-2",
    kind: "text-to-image",
    input: { prompt, imageCount: 1 },
  });

  useEffect(() => {
    let cancelled = false;
    void loadContext({ shotId: shotId as never })
      .then((ctx) => {
        if (cancelled || !ctx) return;
        setPrompt(ctx.assembledPrompt);
        setReferenceAssetIds(ctx.referenceAssetIds as string[]);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [shotId, loadContext]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await startGeneration({
        projectId: projectId as never,
        adapterId: "gpt-image-2",
        kind: "text-to-image",
        prompt,
        shotId: shotId as never,
        referenceAssetIds: referenceAssetIds as never,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const ids = await uploadFiles(files, {
        sceneId,
        shotId,
      });
      if (ids[0]) {
        await setKeyframe({
          shotId: shotId as never,
          keyframeAssetId: ids[0] as never,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSketch(blob: Blob) {
    setBusy(true);
    setError(null);
    setSketchOpen(false);
    try {
      const file = new File([blob], `keyframe-sketch-${Date.now()}.png`, {
        type: "image/png",
      });
      const ids = await uploadFiles([file], { sceneId, shotId });
      if (ids[0]) {
        await setKeyframe({
          shotId: shotId as never,
          keyframeAssetId: ids[0] as never,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sketch upload failed");
    } finally {
      setBusy(false);
    }
  }

  const latestJob = jobs?.[0];

  return (
    <div className="space-y-3">
      <div className="aspect-video overflow-hidden border border-zinc-800 bg-zinc-950">
        {keyframeUrl ? (
          <img
            src={keyframeUrl}
            alt="Keyframe"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No keyframe yet
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-zinc-400">Keyframe prompt</Label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-28 font-mono text-[11px]"
        />
        {estimate?.credits !== undefined ? (
          <p className="text-[10px] text-zinc-500">
            Est. {estimate.credits} credits
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          disabled={busy || !prompt.trim()}
          onClick={() => void generate()}
        >
          Generate
        </Button>
        <label className="inline-flex cursor-pointer">
          <span className="inline-flex h-8 items-center rounded-md border border-zinc-700 bg-transparent px-3 text-xs text-zinc-200 hover:bg-zinc-800">
            Upload
          </span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => void onUpload(e.target.files)}
          />
        </label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setSketchOpen((v) => !v)}
        >
          Draw
        </Button>
        {keyframeUrl ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void clearKeyframe({ shotId: shotId as never })}
          >
            Clear
          </Button>
        ) : null}
      </div>

      {sketchOpen ? (
        <KeyframeSketch
          onCancel={() => setSketchOpen(false)}
          onSave={(blob) => void onSketch(blob)}
        />
      ) : null}

      {latestJob ? (
        <p className="text-[10px] text-zinc-500">
          Latest job: {latestJob.status}
          {latestJob.errorMessage ? ` — ${latestJob.errorMessage}` : ""}
        </p>
      ) : null}
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}
