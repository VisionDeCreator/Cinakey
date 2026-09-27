import { api } from "@cinakey/backend";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  promptSheetId: string;
  onClose: () => void;
};

export function PromptSheetReview({ promptSheetId, onClose }: Props) {
  const load = useAction(api.promptSheets.getWithContent);
  const setCustom = useAction(api.promptSheets.setCustomRenderedText);
  const reset = useAction(api.promptSheets.resetToStructured);
  const approve = useAction(api.promptSheets.approveAssetSheet);
  const applyScript = useAction(api.sequences.applyScriptPrompt);
  const applyBlockout = useAction(api.sequences.applyBlockoutSheet);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState("");
  const [editing, setEditing] = useState(false);
  const [meta, setMeta] = useState<{
    type: string;
    status: string;
    isCustom: boolean;
    version: number;
    projectId: string;
  } | null>(null);

  useEffect(() => {
    void load({ promptSheetId: promptSheetId as never })
      .then((result) => {
        setRendered(result.renderedText);
        setMeta({
          type: result.sheet.type,
          status: result.sheet.status,
          isCustom: result.sheet.isCustom,
          version: result.sheet.version,
          projectId: result.sheet.projectId,
        });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load");
      });
  }, [promptSheetId, load]);

  const onSaveCustom = async () => {
    setBusy(true);
    setError(null);
    try {
      await setCustom({
        promptSheetId: promptSheetId as never,
        renderedText: rendered,
      });
      setEditing(false);
      setMeta((m) => (m ? { ...m, isCustom: true } : m));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await reset({ promptSheetId: promptSheetId as never });
      const result = await load({ promptSheetId: id as never });
      setRendered(result.renderedText);
      setMeta({
        type: result.sheet.type,
        status: result.sheet.status,
        isCustom: result.sheet.isCustom,
        version: result.sheet.version,
        projectId: result.sheet.projectId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  const onApproveAsset = async () => {
    setBusy(true);
    setError(null);
    try {
      await approve({ promptSheetId: promptSheetId as never });
      setMeta((m) => (m ? { ...m, status: "generating" } : m));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  };

  const onApplyScript = async () => {
    if (!meta) return;
    setBusy(true);
    setError(null);
    try {
      await applyScript({
        projectId: meta.projectId as never,
        promptSheetId: promptSheetId as never,
      });
      setMeta((m) => (m ? { ...m, status: "approved" } : m));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  };

  const onApplyBlockout = async () => {
    if (!meta) return;
    setBusy(true);
    setError(null);
    try {
      await applyBlockout({
        projectId: meta.projectId as never,
        promptSheetId: promptSheetId as never,
      });
      setMeta((m) => (m ? { ...m, status: "done" } : m));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  };

  const isAsset =
    meta &&
    ["character", "creature", "environment", "product"].includes(meta.type);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50">
      <button
        type="button"
        className="flex-1 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="flex h-full w-full max-w-xl flex-col border-l border-zinc-800 bg-zinc-950 shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">
              {meta ? `${meta.type} sheet v${meta.version}` : "Sheet"}
            </h3>
            {meta ? (
              <p className="text-xs text-zinc-500">
                {meta.status}
                {meta.isCustom ? " · custom text" : ""}
              </p>
            ) : null}
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {editing ? (
            <Textarea
              value={rendered}
              onChange={(e) => setRendered(e.target.value)}
              className="min-h-[60vh] font-mono text-xs"
            />
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-300">
              {rendered || "Loading…"}
            </pre>
          )}
        </div>

        {error ? (
          <p className="px-4 text-xs text-red-400">{error}</p>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-zinc-800 p-3">
          {editing ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void onSaveCustom()}
            >
              Save as custom
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setEditing(true)}
            >
              Edit text
            </Button>
          )}
          {meta?.isCustom ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void onReset()}
            >
              Reset to structured
            </Button>
          ) : null}
          {isAsset ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void onApproveAsset()}
            >
              Approve & generate
            </Button>
          ) : null}
          {meta?.type === "script" ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void onApplyScript()}
            >
              Apply → shots
            </Button>
          ) : null}
          {meta?.type === "blockout" ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void onApplyBlockout()}
            >
              Apply → 3D blockouts
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
