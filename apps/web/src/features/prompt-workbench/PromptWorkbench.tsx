import { api } from "@cinakey/backend";
import {
  COST_CONFIRM_THRESHOLD_CREDITS,
  validateAssetPromptText,
  type AssetSheetType,
} from "@cinakey/shared";
import { useAction, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<AssetSheetType, string> = {
  character: "character",
  creature: "creature",
  environment: "environment",
  product: "product",
};

export function PromptWorkbench({
  projectId,
  entityId,
  entityName,
  assetType,
  onTypeDetected,
}: {
  projectId: string;
  entityId: string;
  entityName: string;
  assetType: AssetSheetType;
  onTypeDetected?: (type: AssetSheetType) => void;
}) {
  const tip = useQuery(api.promptSheets.getTipForEntity, {
    entityId: entityId as never,
  });
  const versions = useQuery(api.promptSheets.listVersionsForEntity, {
    entityId: entityId as never,
  });
  const entityAssets = useQuery(api.entities.listAssetsForEntity, {
    entityId: entityId as never,
  });
  const savePromptText = useAction(api.promptSheets.savePromptText);
  const restoreVersion = useAction(api.promptSheets.restorePromptVersion);
  const approveSheet = useAction(api.promptSheets.approveAssetSheet);
  const lockReference = useAction(api.entities.lockReference);
  const runTurn = useAction(api.copilot.runTurn);

  const [prompt, setPrompt] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [localMessages, setLocalMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const promptSynced = useRef<string | null>(null);

  useEffect(() => {
    if (!tip) return;
    const text = tip.renderedText ?? "";
    if (!dirty && promptSynced.current !== tip._id) {
      setPrompt(text);
      promptSynced.current = tip._id;
    }
    if (tip.type && tip.type !== assetType && isAssetType(tip.type)) {
      onTypeDetected?.(tip.type);
    }
  }, [tip, dirty, assetType, onTypeDetected]);

  const validation = prompt.trim()
    ? validateAssetPromptText(assetType, prompt)
    : { ok: true };

  const imageResults = (entityAssets ?? []).filter((a) => a.type === "image");

  const saveDirect = async (text: string) => {
    const result = await savePromptText({
      projectId: projectId as never,
      entityId: entityId as never,
      type: assetType,
      promptText: text,
      name: entityName,
    });
    setDirty(false);
    promptSynced.current = result.promptSheetId;
    return result;
  };

  const onSend = async () => {
    const content = chatDraft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    setChatDraft("");
    setLocalMessages((m) => [...m, { role: "user", content }]);
    try {
      // Persist any local edits first so the copilot revises from current text.
      if (dirty && prompt.trim()) {
        await saveDirect(prompt);
      }
      await runTurn({
        projectId: projectId as never,
        content: `For asset "${entityName}" (${assetType}): ${content}`,
        view: "assets",
        selectionIds: [entityId],
      });
      setLocalMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "Updated the prompt.",
        },
      ]);
      setDirty(false);
      promptSynced.current = null;
    } catch (err) {
      setChatDraft(content);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onGenerate = async () => {
    if (genBusy) return;
    setGenBusy(true);
    setError(null);
    try {
      let sheetId = tip?._id;
      if (dirty || !sheetId || (prompt.trim() && prompt !== (tip?.renderedText ?? ""))) {
        const saved = await saveDirect(prompt);
        sheetId = saved.promptSheetId;
      }
      if (!sheetId) throw new Error("Save a prompt first");
      const est = 10;
      if (
        est >= COST_CONFIRM_THRESHOLD_CREDITS &&
        !window.confirm(`Generate image for ~${est} credits?`)
      ) {
        return;
      }
      if (
        est < COST_CONFIRM_THRESHOLD_CREDITS &&
        !window.confirm(`Generate (~${est} credits)?`)
      ) {
        return;
      }
      await approveSheet({ promptSheetId: sheetId as never });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenBusy(false);
    }
  };

  const onUndo = async () => {
    const prior = (versions ?? []).find((v) => !v.isTip);
    if (!prior) return;
    setBusy(true);
    try {
      await restoreVersion({ promptSheetId: prior._id as never });
      setDirty(false);
      promptSynced.current = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <div className="flex min-h-0 w-full flex-col border border-zinc-800 lg:w-[22rem]">
        <div className="border-b border-zinc-800 px-3 py-2">
          <p className="text-xs font-medium text-zinc-300">Chat</p>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-2">
          {localMessages.length === 0 ? (
            <p className="text-xs text-zinc-500">Describe what you want.</p>
          ) : (
            localMessages.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                className={cn(
                  "rounded-sm px-2 py-1.5 text-xs",
                  m.role === "user"
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-400",
                )}
              >
                {m.content}
              </div>
            ))
          )}
        </div>
        <div className="border-t border-zinc-800 p-2">
          <Textarea
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            placeholder="Describe changes…"
            className="min-h-14 resize-none text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            className="mt-2 w-full"
            disabled={busy || !chatDraft.trim()}
            onClick={() => void onSend()}
          >
            {busy ? "…" : "Send"}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
            {TYPE_LABEL[assetType]}
          </span>
          {tip?.status === "out_of_date" ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
              style changed
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={busy || !(versions ?? []).some((v) => !v.isTip)}
              onClick={() => void onUndo()}
            >
              Undo
            </Button>
            <div className="relative">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setVersionsOpen((o) => !o)}
              >
                v{tip?.version ?? 1}
              </Button>
              {versionsOpen && versions && versions.length > 0 ? (
                <div className="absolute right-0 z-10 mt-1 max-h-48 w-56 overflow-auto border border-zinc-700 bg-zinc-900 py-1 shadow-lg">
                  {versions.map((v) => (
                    <button
                      key={v._id}
                      type="button"
                      className="block w-full px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800"
                      onClick={() => {
                        setVersionsOpen(false);
                        if (!v.isTip) {
                          void restoreVersion({
                            promptSheetId: v._id as never,
                          }).then(() => {
                            setDirty(false);
                            promptSynced.current = null;
                          });
                        }
                      }}
                    >
                      v{v.version}
                      {v.isTip ? " · current" : ""}
                      <span className="mt-0.5 block truncate text-zinc-600">
                        {v.preview || "(empty)"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              className="h-7"
              disabled={genBusy || !prompt.trim()}
              onClick={() => void onGenerate()}
            >
              {genBusy ? "Generating…" : "Generate · 10"}
            </Button>
          </div>
        </div>

        {validation.warning ? (
          <p className="mb-1 text-[11px] text-amber-400/90">{validation.warning}</p>
        ) : null}
        {error ? (
          <p className="mb-1 text-[11px] text-red-300">{error}</p>
        ) : null}

        <Textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            setDirty(true);
          }}
          onBlur={() => {
            if (dirty && prompt.trim()) {
              void saveDirect(prompt).catch((err) =>
                setError(err instanceof Error ? err.message : String(err)),
              );
            }
          }}
          placeholder="Prompt appears here after you describe the asset…"
          className="min-h-[20rem] flex-1 resize-y font-mono text-sm leading-relaxed"
        />

        {imageResults.length > 0 ? (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-zinc-500">Results — pick a reference</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {imageResults.slice(0, 8).map((asset) => (
                <ResultThumb
                  key={asset._id}
                  assetId={asset._id}
                  name={asset.name}
                  selected={
                    tip?.entityId
                      ? undefined
                      : undefined
                  }
                  onSelect={() => {
                    void lockReference({
                      entityId: entityId as never,
                      assetId: asset._id as never,
                      referenceSheet: true,
                    });
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {tip?.status === "out_of_date" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 self-start"
            disabled={genBusy}
            onClick={() => void onGenerate()}
          >
            Regenerate
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function isAssetType(t: string): t is AssetSheetType {
  return (
    t === "character" ||
    t === "creature" ||
    t === "environment" ||
    t === "product"
  );
}

function ResultThumb({
  assetId,
  name,
  onSelect,
}: {
  assetId: string;
  name: string;
  selected?: boolean;
  onSelect: () => void;
}) {
  const url = useQuery(api.storage.getAssetUrl, {
    assetId: assetId as never,
  });
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group overflow-hidden border border-zinc-800 bg-zinc-900 text-left hover:border-zinc-500"
    >
      <div className="aspect-square bg-zinc-950">
        {url ? (
          <img src={url} alt={name} className="h-full w-full object-cover" />
        ) : null}
      </div>
      <p className="truncate px-1.5 py-1 text-[10px] text-zinc-500 group-hover:text-zinc-300">
        Use as reference
      </p>
    </button>
  );
}
