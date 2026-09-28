import { api } from "@cinakey/backend";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useCopilotContext } from "@/features/copilot/CopilotContext";
import { ShotGenerationPanel } from "@/features/shots/ShotGenerationPanel";
import { TakeCompare } from "@/features/shots/TakeCompare";
import { generateAndUploadProxy } from "@/features/shots/proxyPipeline";

export function ShotDetailPage() {
  const { projectId, shotId } = useParams();
  const { setContext } = useCopilotContext();
  const ctx = useQuery(
    api.shotGeneration.getShotGenerationContext,
    shotId ? { shotId: shotId as never } : "skip",
  );
  const takes = useQuery(
    api.takes.listByShot,
    shotId ? { shotId: shotId as never } : "skip",
  );
  const assemble = useAction(api.shotGeneration.assemblePromptAction);
  const selectTake = useMutation(api.takes.selectTake);
  const rateTake = useMutation(api.takes.rateTake);
  const startUpscale = useAction(api.shotGeneration.startTakeUpscale);
  const startExtend = useAction(api.shotGeneration.startTakeExtend);
  const createUploadUrl = useMutation(api.storage.createUploadUrl);
  const createAsset = useMutation(api.storage.createAssetFromUpload);
  const attachProxy = useMutation(api.takes.attachTakeProxy);

  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (projectId && shotId) {
      setContext({
        view: "video",
        projectId,
        selectionIds: [shotId],
      });
    }
  }, [projectId, shotId, setContext]);

  useEffect(() => {
    if (!ctx?.shot) return;
    if (ctx.shot.generationPromptOverride) {
      setPrompt(ctx.shot.generationPromptOverride);
      return;
    }
    if (ctx.sequence?._id) {
      void assemble({
        sequenceId: ctx.sequence._id,
        shotId: ctx.shot._id,
      }).then((r) => setPrompt(r.prompt));
    }
  }, [ctx?.shot?._id, ctx?.shot?.generationPromptOverride, ctx?.sequence?._id, assemble, ctx?.shot]);

  // Auto-proxy takes missing a proxy
  useEffect(() => {
    if (!takes || !projectId || !shotId) return;
    for (const t of takes) {
      if (t.proxyAssetId || !t.assetUrl) continue;
      void generateAndUploadProxy({
        takeId: t._id,
        projectId,
        shotId,
        sourceUrl: t.assetUrl,
        trimStartSec: t.trimStartSec,
        trimEndSec: t.trimEndSec,
        createUploadUrl: () => createUploadUrl({}),
        createAssetFromUpload: async (args) =>
          createAsset({
            projectId: args.projectId as never,
            storageId: args.storageId as never,
            type: "video",
            name: args.name,
            format: args.format,
            shotId: args.shotId as never,
            tags: args.tags,
            durationSec: args.durationSec,
          }),
        attachTakeProxy: async (args) => {
          await attachProxy({
            takeId: args.takeId as never,
            proxyAssetId: args.proxyAssetId as never,
            clippedAssetId: args.clippedAssetId as never,
          });
        },
      });
    }
  }, [takes, projectId, shotId, createUploadUrl, createAsset, attachProxy]);

  if (!projectId || !shotId) return null;
  if (ctx === undefined) {
    return <p className="text-sm text-zinc-500">Loading shot…</p>;
  }
  if (ctx === null) {
    return <p className="text-sm text-zinc-500">Shot not found.</p>;
  }

  const { shot, characters, location, sequence } = ctx;

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to={`/projects/${projectId}/video`}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            ← Shots
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-100">
            Shot {shot.order + 1}: {shot.shotType}
          </h1>
          <p className="text-xs text-zinc-500">
            {shot.status}
            {sequence ? ` · sequence “${sequence.title}”` : ""}
            {shot.durationSec ? ` · ${shot.durationSec}s` : ""}
            {shot.lensMm ? ` · ${shot.lensMm}mm` : ""}
            {shot.cameraMove ? ` · ${shot.cameraMove}` : ""}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" asChild>
          <Link to={`/projects/${projectId}/blockout/shots/${shotId}`}>
            Open 3D blockout
          </Link>
        </Button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Storyboard / guides
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <div className="aspect-video bg-zinc-900">
              {ctx.keyframeUrl ? (
                <img
                  src={ctx.keyframeUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">
                  No keyframe
                </div>
              )}
            </div>
            <div className="aspect-video bg-zinc-900">
              {ctx.guideKeyframeUrl ? (
                <img
                  src={ctx.guideKeyframeUrl}
                  alt="Blockout keyframe"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">
                  No blockout keyframe
                </div>
              )}
            </div>
            {ctx.guideDepthUrl ? (
              <div className="aspect-video bg-zinc-900">
                <img
                  src={ctx.guideDepthUrl}
                  alt="Depth pass"
                  className="h-full w-full object-cover"
                />
              </div>
            ) : null}
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Linked sheets
          </h2>
          <ul className="space-y-1 text-zinc-300">
            {characters.map((c) =>
              c ? (
                <li key={c._id}>
                  <Link
                    to={`/projects/${projectId}/assets/${c._id}`}
                    className="hover:underline"
                  >
                    {c.kind}: {c.name}
                  </Link>
                </li>
              ) : null,
            )}
            {location ? (
              <li>
                <Link
                  to={`/projects/${projectId}/assets/${location._id}`}
                  className="hover:underline"
                >
                  location: {location.name}
                </Link>
              </li>
            ) : null}
            {characters.length === 0 && !location ? (
              <li className="text-zinc-500">No entities linked</li>
            ) : null}
          </ul>
          {shot.notes ? (
            <p className="mt-3 text-xs text-zinc-400">{shot.notes}</p>
          ) : null}
        </div>
      </section>

      <TakeCompare
        takes={(takes ?? []).map((t) => ({
          ...t,
          playbackUrl: t.playbackUrl,
        }))}
        busy={busy}
        onSelect={async (takeId) => {
          setBusy(true);
          try {
            await selectTake({ takeId: takeId as never });
            setMsg("Take selected");
          } finally {
            setBusy(false);
          }
        }}
        onRate={async (takeId, rating) => {
          await rateTake({ takeId: takeId as never, rating });
        }}
        onUpscale={async (takeId) => {
          setBusy(true);
          setMsg(null);
          try {
            await startUpscale({ takeId: takeId as never });
            setMsg("Upscale queued");
          } catch (err) {
            setMsg(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
        onExtend={async (takeId) => {
          setBusy(true);
          setMsg(null);
          try {
            await startExtend({ takeId: takeId as never });
            setMsg("Extend queued");
          } catch (err) {
            setMsg(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      />

      {msg ? <p className="text-xs text-zinc-400">{msg}</p> : null}

      <ShotGenerationPanel
        projectId={projectId}
        shotId={shotId}
        sequenceId={sequence?._id ?? null}
        initialPrompt={prompt}
        guideKeyframeAssetId={ctx.guideKeyframeAssetId}
        keyframeAssetId={shot.keyframeAssetId ?? null}
        onStarted={() => setMsg("Generation queued")}
      />

      {ctx.jobs.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Recent jobs
          </h2>
          <ul className="space-y-1 text-[11px] text-zinc-400">
            {ctx.jobs.map((j) => (
              <li key={j._id} className="flex justify-between gap-2">
                <span>
                  {j.kind} · {j.status}
                  {j.errorMessage ? ` — ${j.errorMessage}` : ""}
                </span>
                <span className="tabular-nums text-zinc-500">
                  {j.actualCostCredits ?? j.estimatedCostCredits} cr
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
