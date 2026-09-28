import { api } from "@cinakey/backend";
import type { PipelineStage } from "@cinakey/shared";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCopilotContext } from "@/features/copilot/CopilotContext";
import { OnboardingChecklist } from "@/features/onboarding/OnboardingChecklist";
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
  const update = useMutation(api.projects.update);
  const { setContext } = useCopilotContext();

  const [editingRules, setEditingRules] = useState(false);
  const [rulesText, setRulesText] = useState("");
  const [targetSec, setTargetSec] = useState("");
  const [spendCap, setSpendCap] = useState("");

  useEffect(() => {
    if (projectId) {
      setContext({ view: "copilot", projectId, selectionIds: [] });
    }
  }, [projectId, setContext]);

  useEffect(() => {
    if (overview) {
      setRulesText(overview.project.rules.join("\n"));
      setTargetSec(
        overview.project.targetLengthSec !== undefined
          ? String(overview.project.targetLengthSec)
          : "",
      );
      setSpendCap(
        overview.project.spendCapCredits !== undefined
          ? String(overview.project.spendCapCredits)
          : "",
      );
    }
  }, [overview]);

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
      {projectId ? <OnboardingChecklist projectId={projectId} /> : null}

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
          <dt className="text-zinc-500">Target length</dt>
          <dd className="flex items-center gap-2 text-zinc-200">
            <Input
              type="number"
              min={1}
              className="h-8 w-24"
              value={targetSec}
              onChange={(e) => setTargetSec(e.target.value)}
            />
            <span className="text-zinc-500">sec</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (!projectId) return;
                const n = Number(targetSec);
                void update({
                  projectId: projectId as never,
                  targetLengthSec:
                    Number.isFinite(n) && n > 0 ? n : undefined,
                });
              }}
            >
              Save
            </Button>
          </dd>
          <dt className="text-zinc-500">Spend cap</dt>
          <dd className="flex items-center gap-2 text-zinc-200">
            <Input
              type="number"
              min={0}
              className="h-8 w-28"
              placeholder="None"
              value={spendCap}
              onChange={(e) => setSpendCap(e.target.value)}
            />
            <span className="text-zinc-500">credits</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (!projectId) return;
                const n = Number(spendCap);
                void update({
                  projectId: projectId as never,
                  spendCapCredits:
                    spendCap.trim() === "" || !Number.isFinite(n) || n < 0
                      ? null
                      : n,
                });
              }}
            >
              Save
            </Button>
          </dd>
        </dl>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">
            Project rules
          </h2>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditingRules((v) => !v)}
          >
            {editingRules ? "Cancel" : "Edit"}
          </Button>
        </div>
        {editingRules ? (
          <div className="space-y-2">
            <Textarea
              value={rulesText}
              onChange={(e) => setRulesText(e.target.value)}
              placeholder="One rule per line — e.g. the hero never smiles"
              className="min-h-28"
            />
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (!projectId) return;
                void update({
                  projectId: projectId as never,
                  rules: rulesText
                    .split("\n")
                    .map((r) => r.trim())
                    .filter(Boolean),
                }).then(() => setEditingRules(false));
              }}
            >
              Save rules
            </Button>
          </div>
        ) : project.rules.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No rules yet. Add constraints the copilot should follow.
          </p>
        ) : (
          <ul className="list-inside list-disc space-y-1 text-sm text-zinc-300">
            {project.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
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
          <p className="mt-1 text-sm text-zinc-500">{emptyCopy(next)}</p>
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
    case "assets":
      return "Draft asset prompts and reference sheets for your cast and locations.";
    case "blockout":
      return "Build a shot list and block the scene.";
    case "video":
      return "Generate takes for your shots.";
    case "edit":
      return "Assemble a timeline from selected takes.";
    default:
      return "Open this stage to get started.";
  }
}
