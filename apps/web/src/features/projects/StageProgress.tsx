import { t, useLocale } from "@cinakey/ui/i18n";
import { cn } from "@/lib/utils";
import type { PipelineProgress, PipelineStage } from "@cinakey/shared";

const STAGES: { key: PipelineStage; label: string }[] = [
  {
    key: "assets",
    get label() {
      return t("References");
    },
  },
  {
    key: "script",
    get label() {
      return t("Script");
    },
  },
  {
    key: "blockout",
    get label() {
      return t("Staging");
    },
  },
  {
    key: "video",
    get label() {
      return t("Video");
    },
  },
  {
    key: "edit",
    get label() {
      return t("Edit");
    },
  },
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
  useLocale();
  return (
    <div
      className={cn("flex items-center gap-1", className)}
      title={t("Pipeline progress")}
    >
      {STAGES.map((stage) => {
        const started = progress[stage.key] === "started";
        return (
          <div
            key={stage.key}
            className={cn(
              "flex-1 rounded-sm",
              size === "sm" ? "h-1" : "h-1.5",
              started ? "bg-[var(--color-studio-accent)]" : "bg-zinc-800",
            )}
            title={`${stage.label}: ${t(started ? "started" : "empty")}`}
          />
        );
      })}
    </div>
  );
}
