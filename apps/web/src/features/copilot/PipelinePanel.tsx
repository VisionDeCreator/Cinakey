import { api } from "@cinakey/backend";
import { useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  projectId: string;
  onOpenSheet: (promptSheetId: string) => void;
};

const STATUS_COLOR: Record<string, string> = {
  draft: "text-zinc-400",
  approved: "text-sky-400",
  generating: "text-amber-400",
  done: "text-emerald-400",
  out_of_date: "text-orange-400",
};

export function PipelinePanel({ projectId, onOpenSheet }: Props) {
  const summary = useQuery(api.promptSheets.pipelineSummary, {
    projectId: projectId as never,
  });

  if (summary === undefined) {
    return (
      <div className="p-4 text-sm text-zinc-500">Loading pipeline…</div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto border-l border-zinc-800 bg-zinc-950/40">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h3 className="text-sm font-semibold tracking-tight">Pipeline</h3>
        <p className="text-xs text-zinc-500">
          Story → assets → script → blockout
        </p>
        {summary.estimatedAssetCredits > 0 ? (
          <p className="mt-1 text-xs text-amber-400/90">
            Est. {summary.estimatedAssetCredits} credits for pending asset
            sheets
          </p>
        ) : null}
      </div>

      <Stage title="1 · Story">
        {summary.story.logline ? (
          <p className="text-xs leading-relaxed text-zinc-300">
            {summary.story.logline}
          </p>
        ) : (
          <p className="text-xs text-zinc-600">
            No treatment yet — chat with the copilot to shape the story.
          </p>
        )}
      </Stage>

      <Stage title="2 · Asset sheets">
        {summary.assetSheets.length === 0 ? (
          <p className="text-xs text-zinc-600">No asset sheets yet.</p>
        ) : (
          <ul className="space-y-1">
            {summary.assetSheets.map((s) => (
              <SheetRow
                key={s._id}
                label={`${s.type} · v${s.version}`}
                status={s.status}
                custom={s.isCustom}
                onOpen={() => onOpenSheet(s._id)}
              />
            ))}
          </ul>
        )}
      </Stage>

      <Stage title="3 · Script prompts">
        {summary.scriptSheets.length === 0 ? (
          <p className="text-xs text-zinc-600">No script prompts yet.</p>
        ) : (
          <ul className="space-y-1">
            {summary.scriptSheets.map((s) => (
              <SheetRow
                key={s._id}
                label={`script · v${s.version}`}
                status={s.status}
                custom={s.isCustom}
                onOpen={() => onOpenSheet(s._id)}
              />
            ))}
          </ul>
        )}
        {summary.sequences.length > 0 ? (
          <ul className="mt-2 space-y-0.5 border-t border-zinc-800/80 pt-2">
            {summary.sequences.map((seq) => (
              <li key={seq._id} className="text-[11px] text-zinc-500">
                {seq.title} · {seq.durationSec}s · {seq.shotIds.length} shots
              </li>
            ))}
          </ul>
        ) : null}
      </Stage>

      <Stage title="4 · Blockout sheets">
        {summary.blockoutSheets.length === 0 ? (
          <p className="text-xs text-zinc-600">No blockout sheets yet.</p>
        ) : (
          <ul className="space-y-1">
            {summary.blockoutSheets.map((s) => (
              <SheetRow
                key={s._id}
                label={`blockout · v${s.version}`}
                status={s.status}
                custom={s.isCustom}
                onOpen={() => onOpenSheet(s._id)}
              />
            ))}
          </ul>
        )}
      </Stage>
    </div>
  );
}

function Stage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-zinc-800 px-4 py-3">
      <h4 className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
        {title}
      </h4>
      {children}
    </section>
  );
}

function SheetRow({
  label,
  status,
  custom,
  onOpen,
}: {
  label: string;
  status: string;
  custom: boolean;
  onOpen: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 truncate text-left text-xs text-zinc-300 hover:text-zinc-50"
      >
        {label}
        {custom ? " · custom" : ""}
      </button>
      <span
        className={cn(
          "shrink-0 text-[10px] uppercase",
          STATUS_COLOR[status] ?? "text-zinc-500",
        )}
      >
        {status.replace("_", " ")}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 shrink-0 px-1.5 text-[10px]"
        onClick={onOpen}
      >
        Open
      </Button>
    </li>
  );
}
