import { api } from "@cinakey/backend";
import type { PipelineStage } from "@cinakey/shared";
import { useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  firstEmptyStage,
  StageProgressBar,
  stageLabel,
  stagePath,
} from "@/features/projects/StageProgress";

export function ProjectOverviewPage() {
  const { projectId } = useParams();
  const overview = useQuery(
    api.projects.getOverview,
    projectId ? { projectId: projectId as never } : "skip",
  );

  if (overview === undefined) {
    return <p className="text-sm text-zinc-500">Loading overview…</p>;
  }

  const { project, progress, counts } = overview;
  const next = firstEmptyStage(progress);
  const nextHref =
    next && projectId
      ? `/projects/${projectId}/${stagePath(next)}`
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-100">Brief</h2>
        {project.brief ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-[7rem_1fr]">
            <dt className="text-zinc-500">Logline</dt>
            <dd className="text-zinc-200">{project.brief.logline}</dd>
            {project.brief.audience ? (
              <>
                <dt className="text-zinc-500">Audience</dt>
                <dd className="text-zinc-200">{project.brief.audience}</dd>
              </>
            ) : null}
            {project.brief.tone ? (
              <>
                <dt className="text-zinc-500">Tone</dt>
                <dd className="text-zinc-200">{project.brief.tone}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p className="text-sm text-zinc-500">No brief yet.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-100">Format</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-[7rem_1fr]">
          <dt className="text-zinc-500">Aspect ratio</dt>
          <dd className="text-zinc-200">{project.aspectRatio}</dd>
          <dt className="text-zinc-500">FPS</dt>
          <dd className="text-zinc-200">{project.fps}</dd>
          {project.targetLengthSec !== undefined ? (
            <>
              <dt className="text-zinc-500">Target length</dt>
              <dd className="text-zinc-200">{project.targetLengthSec}s</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-100">Progress</h2>
        <StageProgressBar progress={progress} className="max-w-md" />
        <p className="text-xs text-zinc-500">
          {counts.scenes} scenes · {counts.shots} shots · {counts.assets} assets
          · {counts.entities} entities
        </p>
      </section>

      {nextHref && next ? (
        <div className="border border-dashed border-zinc-700 px-5 py-6">
          <p className="text-sm text-zinc-300">
            Next up: {stageLabel(next as PipelineStage)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {emptyCopy(next)}
          </p>
          <Button asChild className="mt-4" size="sm">
            <Link to={nextHref}>Go to {stageLabel(next)}</Link>
          </Button>
        </div>
      ) : (
        <p className="text-sm text-zinc-400">
          Every stage has content. Dive into any tab to keep refining.
        </p>
      )}
    </div>
  );
}

function emptyCopy(stage: PipelineStage): string {
  switch (stage) {
    case "script":
      return "Write your first scene and lock the story spine.";
    case "lookDev":
      return "Create character, location, and style sheets.";
    case "blockout":
      return "Build a shot list and block the scene.";
    case "shots":
      return "Generate takes for your shots.";
    case "edit":
      return "Assemble a timeline from selected takes.";
    case "assets":
      return "Upload footage, photos, or audio into the library.";
  }
}
