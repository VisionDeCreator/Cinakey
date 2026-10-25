import { cn } from "@/lib/utils";
import type { PipelineProgress, PipelineStage } from "@cinakey/shared";

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: "assets", label: "References" },
  { key: "script", label: "Script" },
  { key: "blockout", label: "Staging" },
  { key: "video", label: "Video" },
  { key: "edit", label: "Edit" },
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
    <div
      className={cn("flex items-center gap-1", className)}
      title="Pipeline progress"
    >
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
