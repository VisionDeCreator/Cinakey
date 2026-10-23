import { useState } from "react";
import { api } from "@cinakey/backend";
import { useAction, useMutation, useQuery } from "@/lib/api/hooks";
import { useConfirm } from "@/components/ConfirmProvider";
import { Button } from "@/components/ui/button";

export function ShotProduction({
  projectId,
  sequenceId,
  generationBusy,
}: {
  projectId: string;
  sequenceId: string | null;
  generationBusy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shots = useQuery(
    api.shots.listByProject,
    open ? { projectId: projectId as never } : "skip",
  );
  return (
    <details
      className="border border-zinc-800 p-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm">
        Individual shots and takes
      </summary>
      <p className="my-2 text-xs text-zinc-500">
        Choose shots for the next assembly. Existing edits keep their current
        footage; replace clips explicitly in the inspector.
      </p>
      {open &&
        shots
          ?.filter((shot) => shot.sequenceId === sequenceId)
          .map((shot) => (
            <ShotRow
              key={shot._id}
              shotId={shot._id}
              generationBusy={generationBusy}
              label={`Shot ${shot.order + 1}`}
              duration={Math.max(4, Math.min(30, Math.ceil(shot.durationSec)))}
            />
          ))}
    </details>
  );
}
function ShotRow({
  shotId,
  label,
  duration,
  generationBusy,
}: {
  shotId: string;
  label: string;
  duration: number;
  generationBusy: boolean;
}) {
  const takes = useQuery(api.takes.listByShot, { shotId: shotId as never });
  const generate = useAction(api.shotGeneration.startShotGeneration);
  const select = useMutation(api.takes.selectTake);
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (busy || generationBusy) return;
    if (
      !(await confirm({
        title: `Generate ${label.toLowerCase()}?`,
        description: `${duration} seconds, approximately ${duration * 2} credits.`,
        confirmLabel: "Generate",
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await generate({ shotId: shotId as never, durationSec: duration });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start generation",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="my-2 border-t border-zinc-800 py-2">
      <div className="flex items-center gap-3">
        <span>{label}</span>
        <Button
          size="sm"
          disabled={busy || generationBusy}
          onClick={() => void run()}
        >
          Generate · {duration * 2} cr
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {takes?.map((take) => (
          <div key={take._id} className="w-44">
            {take.playbackUrl && (
              <video
                controls
                preload="metadata"
                src={take.playbackUrl}
                className="w-full"
              />
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={take.selected}
              onClick={() => {
                void select({ takeId: take._id }).catch((err) =>
                  setError(String(err)),
                );
              }}
            >
              {take.selected ? "Chosen" : "Choose take"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
