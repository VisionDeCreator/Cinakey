import { api } from "@cinakey/backend";
import type { ScriptDiffOp } from "@cinakey/shared";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type ScriptHistorySheetProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: () => void;
};

export function ScriptHistorySheet({
  projectId,
  open,
  onOpenChange,
  onRestored,
}: ScriptHistorySheetProps) {
  const versions = useQuery(api.scriptVersions.listForProject, {
    projectId: projectId as never,
  });
  const diffVersions = useAction(api.scriptVersions.diffVersions);
  const restore = useAction(api.scriptVersions.restore);

  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [diff, setDiff] = useState<{
    ops: ScriptDiffOp[];
    leftText: string;
    rightText: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDiff = async () => {
    if (!leftId || !rightId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await diffVersions({
        projectId: projectId as never,
        leftVersionId: leftId as never,
        rightVersionId: rightId as never,
      });
      setDiff({
        ops: result.ops,
        leftText: result.leftText,
        rightText: result.rightText,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Diff failed");
    } finally {
      setBusy(false);
    }
  };

  const runRestore = async (versionId: string) => {
    setBusy(true);
    setError(null);
    try {
      await restore({
        projectId: projectId as never,
        versionId: versionId as never,
      });
      onRestored();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Script history</SheetTitle>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : null}

          {!versions ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-zinc-500">No versions yet.</p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v, i) => (
                <li
                  key={v._id}
                  className="flex items-start justify-between gap-2 border border-zinc-800 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-200">
                      {v.label ?? (i === 0 ? "Current tip" : `Version`)}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {new Date(v.createdAt).toLocaleString()} · {v.format}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className={cn(
                          "text-xs underline-offset-2 hover:underline",
                          leftId === v._id
                            ? "text-zinc-100"
                            : "text-zinc-500",
                        )}
                        onClick={() => setLeftId(v._id)}
                      >
                        Left
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "text-xs underline-offset-2 hover:underline",
                          rightId === v._id
                            ? "text-zinc-100"
                            : "text-zinc-500",
                        )}
                        onClick={() => setRightId(v._id)}
                      >
                        Right
                      </button>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || i === 0}
                    onClick={() => void runRestore(v._id)}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2 border-t border-zinc-800 pt-4">
            <Button
              type="button"
              size="sm"
              disabled={!leftId || !rightId || busy}
              onClick={() => void runDiff()}
            >
              Compare
            </Button>
            <p className="text-xs text-zinc-500">
              Select Left and Right, then compare.
            </p>
          </div>

          {diff ? (
            <div className="space-y-3 border border-zinc-800 p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                Diff ({diff.ops.length} ops)
              </p>
              {diff.ops.length === 0 ? (
                <p className="text-sm text-zinc-400">No differences.</p>
              ) : (
                <ul className="max-h-40 space-y-2 overflow-auto text-xs">
                  {diff.ops.map((op, i) => (
                    <li key={i} className="font-mono text-zinc-400">
                      <span
                        className={cn(
                          op.op === "add" && "text-emerald-400",
                          op.op === "remove" && "text-red-400",
                          op.op === "change" && "text-amber-400",
                        )}
                      >
                        {op.op}
                      </span>{" "}
                      {op.path}
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-sm bg-zinc-950 p-2 text-[11px] text-zinc-400">
                  {diff.leftText || "(empty)"}
                </pre>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-sm bg-zinc-950 p-2 text-[11px] text-zinc-400">
                  {diff.rightText || "(empty)"}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
