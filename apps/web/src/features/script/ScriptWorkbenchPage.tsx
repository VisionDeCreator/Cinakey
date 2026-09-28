import { api } from "@cinakey/backend";
import { useAction, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PromptWorkbench } from "@/features/prompt-workbench/PromptWorkbench";
import { cn } from "@/lib/utils";

export function ScriptWorkbenchPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const parts = useQuery(
    api.promptSheets.listScriptParts,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const project = useQuery(
    api.projects.get,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const saveScript = useAction(api.promptSheets.saveScriptPromptText);

  const [activeSequenceId, setActiveSequenceId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!parts || parts.length === 0) return;
    if (
      !activeSequenceId ||
      !parts.some((p) => p.sequenceId === activeSequenceId)
    ) {
      setActiveSequenceId(parts[0]!.sequenceId);
    }
  }, [parts, activeSequenceId]);

  if (!projectId) return null;

  const active =
    parts?.find((p) => p.sequenceId === activeSequenceId) ?? parts?.[0];

  const ensurePart = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const skeleton = [
        "REFERENCES",
        "@image_1 = style. Use it for the project art style.",
        "",
        "ART STYLE — LOCKED TO THE REFERENCE IMAGES:",
        "Use the exact art style already defined in @image_1 for the entire video.",
        "",
        "IMAGE QUALITY — ALWAYS SHARP AND CLEAN:",
        "Every frame sharp, crisp and clean.",
        "",
        "LOCATION — @image_1: Describe the location.",
        "",
        "SHOTS (5 seconds total, multi-shot, 16:9):",
        "Shot 1 (0.0s–5.0s) — Wide shot: opening beat.",
        "",
        "CONSISTENCY:",
        "Keep characters and style identical.",
        "",
        "MOTION AND PHYSICS:",
        "Natural motion.",
        "",
        "LIGHTING:",
        "Natural light.",
        "",
        "TECHNICAL:",
        "16:9, 24fps.",
        "",
        "MUSIC:",
        "Score TBD.",
        "",
        "AUDIO (native sound, synced to picture, no dialogue):",
        "0.0s ambient.",
      ].join("\n");
      const result = await saveScript({
        projectId: projectId as never,
        promptText: skeleton,
        title: `Part ${(parts?.length ?? 0) + 1}`,
        applyShots: true,
      });
      setActiveSequenceId(result.sequenceId);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-sm font-medium text-zinc-200">Script</h1>
        {(parts?.length ?? 0) > 1 ? (
          <div className="flex gap-1">
            {parts!.map((p, i) => (
              <button
                key={p.sequenceId}
                type="button"
                onClick={() => setActiveSequenceId(p.sequenceId)}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  p.sequenceId === active?.sequenceId
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {p.label || `Part ${i + 1}`}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!parts ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : !active ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-3">
          <p className="text-sm text-zinc-400">
            Describe your video with the copilot. One part is up to 30 seconds.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={creating}
            onClick={() => void ensurePart()}
          >
            {creating ? "…" : "Start script"}
          </Button>
        </div>
      ) : (
        <PromptWorkbench
          mode="script"
          projectId={projectId}
          sequenceId={active.sequenceId}
          partLabel={active.label}
          referenceMap={active.referenceMap}
          styleReferenceAssetId={project?.styleReferenceAssetId ?? null}
        />
      )}
    </div>
  );
}
