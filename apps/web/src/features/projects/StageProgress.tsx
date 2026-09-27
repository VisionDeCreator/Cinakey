import type { PipelineProgress, PipelineStage } from "@cinakey/shared";
import { cn } from "@/lib/utils";

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: "script", label: "Script" },
  { key: "lookDev", label: "Look" },
  { key: "blockout", label: "Block" },
  { key: "shots", label: "Shots" },
  { key: "edit", label: "Edit" },
  { key: "assets", label: "Assets" },
];

export function StageProgressBar({
  progress,
  className,
  size = "md",
}: {
  progress: PipelineProgress;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("flex items-center gap-1", className)} title="Pipeline progress">
      {STAGES.map((stage) => {
        const started = progress[stage.key] === "started";
        return (
          <div
            key={stage.key}
            className={cn(
              "flex-1 rounded-sm",
              size === "sm" ? "h-1" : "h-1.5",
              started ? "bg-zinc-100" : "bg-zinc-800",
            )}
            title={`${stage.label}: ${started ? "started" : "empty"}`}
          />
        );
      })}
    </div>
  );
}

export function firstEmptyStage(
  progress: PipelineProgress,
): PipelineStage | null {
  for (const stage of STAGES) {
    if (progress[stage.key] === "empty") return stage.key;
  }
  return null;
}

export function stagePath(stage: PipelineStage): string {
  switch (stage) {
    case "lookDev":
      return "look-dev";
    default:
      return stage;
  }
}

export function stageLabel(stage: PipelineStage): string {
  return STAGES.find((s) => s.key === stage)?.label ?? stage;
}
