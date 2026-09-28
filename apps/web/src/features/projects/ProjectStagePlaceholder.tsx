import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  useCopilotContext,
  type CopilotView,
} from "@/features/copilot/CopilotContext";

const STAGE_EMPTY: Record<
  string,
  { title: string; body: string; nextLabel?: string; nextPath?: string }
> = {
  "look-dev": {
    title: "Look development",
    body: "Character and location entities are created from the script. Full sheets and image generation land next.",
    nextLabel: "Open Script",
    nextPath: "script",
  },
  blockout: {
    title: "Blockout",
    body: "Shot lists and 3D blockouts arrive later. Upload reference assets anytime.",
    nextLabel: "Open Assets",
    nextPath: "assets",
  },
  shots: {
    title: "Shot generation",
    body: "Generate takes once shots exist. You can still upload media in Assets.",
    nextLabel: "Open Assets",
    nextPath: "assets",
  },
  edit: {
    title: "Editor",
    body: "The timeline editor ships later. Collect clips in Assets for now.",
    nextLabel: "Open Assets",
    nextPath: "assets",
  },
};

export function ProjectStagePlaceholder({ stage }: { stage: string }) {
  const { projectId } = useParams();
  const { setContext } = useCopilotContext();
  const copy = STAGE_EMPTY[stage] ?? {
    title: stage,
    body: "Coming soon.",
  };
  const href =
    projectId && copy.nextPath !== undefined
      ? `/projects/${projectId}/${copy.nextPath}`
      : null;

  useEffect(() => {
    if (!projectId) return;
    const view = (
      stage === "look-dev"
        ? "assets"
        : stage === "shots"
          ? "video"
          : stage
    ) as CopilotView;
    setContext({ view, projectId, selectionIds: [] });
  }, [projectId, stage, setContext]);

  return (
    <div className="border border-dashed border-zinc-700 px-6 py-12 text-center">
      <h2 className="text-base font-medium text-zinc-200">{copy.title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">{copy.body}</p>
      {href && copy.nextLabel ? (
        <Button asChild variant="secondary" size="sm" className="mt-4">
          <Link to={href}>{copy.nextLabel}</Link>
        </Button>
      ) : null}
    </div>
  );
}
