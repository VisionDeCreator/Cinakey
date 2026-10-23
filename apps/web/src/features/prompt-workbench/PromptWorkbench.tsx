import { api } from "@cinakey/backend";
import {
  COST_CONFIRM_THRESHOLD_CREDITS,
  validateAssetPromptText,
  validateScriptPromptText,
  type AssetSheetType,
} from "@cinakey/shared";
import { useAction, useQuery } from "@/lib/api/hooks";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ConfirmProvider";
import {
  assignScriptReferenceImage,
  listScriptImageNs,
} from "@/features/prompt-workbench/scriptReferenceAssign";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<AssetSheetType, string> = {
  character: "character",
  creature: "creature",
  environment: "environment",
  product: "product",
};

type AssetProps = {
  mode?: "asset";
  projectId: string;
  entityId: string;
  entityName: string;
  assetType: AssetSheetType;
  onTypeDetected?: (type: AssetSheetType) => void;
};

type ScriptProps = {
  mode: "script";
  projectId: string;
  sequenceId: string;
  partLabel: string;
  referenceMap?: { imageN: number; entityId: string }[];
  styleReferenceAssetId?: string | null;
};

export type PromptWorkbenchProps = AssetProps | ScriptProps;

export function PromptWorkbench(props: PromptWorkbenchProps) {
  const isScript = props.mode === "script";

  const tipAsset = useQuery(
    api.promptSheets.getTipForEntity,
    !isScript ? { entityId: props.entityId as never } : "skip",
  );
  const tipScript = useQuery(
    api.promptSheets.getTipForSequence,
    isScript ? { sequenceId: props.sequenceId as never } : "skip",
  );
  const tip = isScript ? tipScript : tipAsset;

  const versionsAsset = useQuery(
    api.promptSheets.listVersionsForEntity,
    !isScript ? { entityId: props.entityId as never } : "skip",
  );
  const versionsScript = useQuery(
    api.promptSheets.listVersionsForSequence,
    isScript ? { sequenceId: props.sequenceId as never } : "skip",
  );
  const versions = isScript ? versionsScript : versionsAsset;

  const entityAssets = useQuery(
    api.entities.listAssetsForEntity,
    !isScript ? { entityId: props.entityId as never } : "skip",
  );
  const projectAssets = useQuery(
    api.storage.listProjectAssets,
    !isScript ? { projectId: props.projectId as never } : "skip",
  );

  const savePromptText = useAction(api.promptSheets.savePromptText);
  const saveScriptPromptText = useAction(api.promptSheets.saveScriptPromptText);
  const restoreVersion = useAction(api.promptSheets.restorePromptVersion);
  const approveSheet = useAction(api.promptSheets.approveAssetSheet);
  const lockReference = useAction(api.entities.lockReference);
  const runTurn = useAction(api.copilot.runTurn);
  const confirm = useConfirm();
  const { uploadFiles } = useAssetUpload(
    !isScript ? props.projectId : undefined,
  );
  const uploadRef = useRef<HTMLInputElement>(null);

  const project = useQuery(
    api.projects.get,
    !isScript ? { projectId: props.projectId as never } : "skip",
  );

  const [prompt, setPrompt] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [localMessages, setLocalMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const promptSynced = useRef<string | null>(null);

  useEffect(() => {
    if (!tip) {
      if (isScript && !dirty && promptSynced.current !== "empty") {
        setPrompt("");
        promptSynced.current = "empty";
      }
      return;
    }
    const text = tip.renderedText ?? "";
    // New tip versions get a new _id (e.g. sidebar Copilot rewrite).
    if (!dirty && promptSynced.current !== tip._id) {
      setPrompt(text);
      promptSynced.current = tip._id;
    }
    if (
      !isScript &&
      tip.type &&
      tip.type !== props.assetType &&
      isAssetType(tip.type)
    ) {
      props.onTypeDetected?.(tip.type);
    }
  }, [tip, dirty, isScript, props]);

  const hasStyleReference = Boolean(project?.styleReferenceAssetId);

  const validation = prompt.trim()
    ? isScript
      ? validateScriptPromptText(prompt)
      : validateAssetPromptText(props.assetType, prompt, {
          hasStyleReference,
        })
    : { ok: true };

  const imageResults = (entityAssets ?? []).filter((a) => a.type === "image");
  const libraryImages = (projectAssets ?? [])
    .filter((a) => a.type === "image")
    .slice(0, 24);

  const saveDirect = async (text: string) => {
    if (isScript) {
      const result = await saveScriptPromptText({
        projectId: props.projectId as never,
        sequenceId: props.sequenceId as never,
        promptText: text,
        title: props.partLabel,
      });
      setDirty(false);
      promptSynced.current = result.promptSheetId;
      return result;
    }
    const result = await savePromptText({
      projectId: props.projectId as never,
      entityId: props.entityId as never,
      type: props.assetType,
      promptText: text,
      name: props.entityName,
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
      if (dirty && prompt.trim()) {
        await saveDirect(prompt);
      }
      if (isScript) {
        await runTurn({
          projectId: props.projectId as never,
          content: `For script ${props.partLabel}: ${content}`,
          view: "script",
          selectionIds: [props.sequenceId],
        });
      } else {
        await runTurn({
          projectId: props.projectId as never,
          content: `For asset "${props.entityName}" (${props.assetType}): ${content}`,
          view: "assets",
          selectionIds: [props.entityId],
        });
      }
      setLocalMessages((m) => [
        ...m,
        { role: "assistant", content: "Updated the prompt." },
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

  const onFillFromScript = async () => {
    if (isScript || busy || !validation.warning) return;
    const instruction = [
      `For asset "${props.entityName}" (${props.assetType}):`,
      `Call write_or_revise_asset_prompt to revise this asset's prompt.`,
      `Add the missing recommended sections (${validation.warning.replace(/^Missing recommended sections:\s*/i, "")})`,
      `using details from the project script (cast / LOCATION / SHOTS / ART STYLE as relevant).`,
      `Keep existing prompt text; only add or flesh out the missing sections.`,
      hasStyleReference
        ? "The project has a style reference image — start with 'Use the attached image as the art style reference: ' if missing, and do not add an ART STYLE section. Close with MOOD AND COLOR."
        : "Include ART STYLE if missing. Close with MOOD AND COLOR (not COLOR PALETTE).",
      props.assetType === "creature"
        ? "Creature mid-sections should include BODY, HEAD, and MARKINGS."
        : props.assetType === "environment"
          ? "Environment prompts must never include people, animals, or creatures — keep that in the opening. Outdoors: THE LAND + SKY AND LIGHT. Interiors: THE {PLACE} + LIGHT (optional extras allowed)."
          : null,
    ]
      .filter(Boolean)
      .join(" ");

    setBusy(true);
    setError(null);
    setLocalMessages((m) => [
      ...m,
      { role: "user", content: "Fill missing sections from the script." },
    ]);
    try {
      if (dirty && prompt.trim()) {
        await saveDirect(prompt);
      }
      await runTurn({
        projectId: props.projectId as never,
        content: instruction,
        view: "assets",
        selectionIds: [props.entityId],
      });
      setLocalMessages((m) => [
        ...m,
        { role: "assistant", content: "Updated the prompt." },
      ]);
      setDirty(false);
      promptSynced.current = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onGenerate = async () => {
    if (isScript || genBusy) return;
    setGenBusy(true);
    setError(null);
    try {
      let sheetId = tip?._id;
      if (
        dirty ||
        !sheetId ||
        (prompt.trim() && prompt !== (tip?.renderedText ?? ""))
      ) {
        const saved = await saveDirect(prompt);
        sheetId = "promptSheetId" in saved ? saved.promptSheetId : sheetId;
      }
      if (!sheetId) throw new Error("Save a prompt first");
      const est = 10;
      const ok = await confirm({
        title: "Generate image",
        description:
          est >= COST_CONFIRM_THRESHOLD_CREDITS
            ? `Generate image for ~${est} credits?`
            : `Generate (~${est} credits)?`,
        confirmLabel: "Generate",
      });
      if (!ok) return;
      await approveSheet({ promptSheetId: sheetId as never });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenBusy(false);
    }
  };

  const onUploadImage = async (files: FileList | null) => {
    if (isScript || !files?.length) return;
    setUploadBusy(true);
    setError(null);
    try {
      const ids = await uploadFiles(files, {
        entityId: props.entityId,
        type: "image",
      });
      const assetId = ids[0];
      if (assetId) {
        await lockReference({
          entityId: props.entityId as never,
          assetId: assetId as never,
          referenceSheet: true,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadBusy(false);
    }
  };

  const onPickLibrary = async (assetId: string) => {
    if (isScript) return;
    setLibraryOpen(false);
    setError(null);
    try {
      await lockReference({
        entityId: props.entityId as never,
        assetId: assetId as never,
        referenceSheet: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

  const onAssignScriptRef = async (imageN: number, entityName: string) => {
    if (!isScript) return;
    const next = assignScriptReferenceImage(prompt, imageN, entityName);
    setPrompt(next);
    setDirty(true);
    setError(null);
    try {
      await saveDirect(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const refMap = isScript
    ? (props.referenceMap ?? tip?.referenceMap ?? [])
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <div className="flex min-h-0 w-full flex-col border border-zinc-800 lg:w-[22rem]">
        <div className="border-b border-zinc-800 px-3 py-2">
          <p className="text-xs font-medium text-zinc-300">Chat</p>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-2">
          {localMessages.length === 0 ? (
            <p className="text-xs text-zinc-500">
              {isScript ? "Describe the video." : "Describe the asset."}
            </p>
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
            {isScript ? "script" : TYPE_LABEL[props.assetType]}
          </span>
          {!isScript && tip?.status === "out_of_date" ? (
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
            {!isScript ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={uploadBusy}
                  onClick={() => uploadRef.current?.click()}
                >
                  {uploadBusy ? "…" : "Upload"}
                </Button>
                <input
                  ref={uploadRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void onUploadImage(e.target.files);
                    e.target.value = "";
                  }}
                />
                <div className="relative">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => setLibraryOpen((o) => !o)}
                  >
                    Library
                  </Button>
                  {libraryOpen ? (
                    <div className="absolute right-0 z-20 mt-1 max-h-64 w-64 overflow-auto border border-zinc-700 bg-zinc-900 p-2 shadow-lg">
                      {libraryImages.length === 0 ? (
                        <p className="px-1 py-2 text-[11px] text-zinc-500">
                          No project images yet.
                        </p>
                      ) : (
                        <div className="grid grid-cols-3 gap-1.5">
                          {libraryImages.map((asset) => (
                            <LibraryThumb
                              key={asset._id}
                              assetId={asset._id}
                              name={asset.name}
                              onSelect={() => void onPickLibrary(asset._id)}
                            />
                          ))}
                        </div>
                      )}
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
              </>
            ) : null}
          </div>
        </div>

        {isScript ? (
          <ReferenceStrip
            projectId={props.projectId}
            promptText={prompt}
            referenceMap={refMap}
            styleReferenceAssetId={props.styleReferenceAssetId}
            onAssign={(imageN, entityName) =>
              void onAssignScriptRef(imageN, entityName)
            }
          />
        ) : null}

        {validation.warning ? (
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className="text-[11px] text-amber-400/90">{validation.warning}</p>
            {!isScript ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px]"
                disabled={busy}
                onClick={() => void onFillFromScript()}
              >
                {busy ? "…" : "Fill from script"}
              </Button>
            ) : null}
          </div>
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
          placeholder={
            isScript
              ? "Script prompt appears here after you describe the video…"
              : "Prompt appears here after you describe the asset…"
          }
          className="min-h-[20rem] flex-1 resize-y font-mono text-sm leading-relaxed"
        />

        {!isScript ? (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-zinc-500">
              {imageResults.length > 0
                ? "Results — pick a reference"
                : "Upload, pick from Library, or Generate a reference"}
            </p>
            {imageResults.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 pb-3 sm:grid-cols-4">
                {imageResults.slice(0, 8).map((asset) => (
                  <ResultThumb
                    key={asset._id}
                    assetId={asset._id}
                    name={asset.name}
                    onSelect={() => {
                      void lockReference({
                        entityId: props.entityId as never,
                        assetId: asset._id as never,
                        referenceSheet: true,
                      });
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {!isScript && tip?.status === "out_of_date" ? (
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

function ReferenceStrip({
  projectId,
  promptText,
  referenceMap,
  styleReferenceAssetId,
  onAssign,
}: {
  projectId: string;
  promptText: string;
  referenceMap: { imageN: number; entityId: string }[];
  styleReferenceAssetId?: string | null;
  onAssign: (imageN: number, entityName: string) => void;
}) {
  const entities = useQuery(api.entities.listForProject, {
    projectId: projectId as never,
  });
  const [openImageN, setOpenImageN] = useState<number | null>(null);

  const mapByN = new Map(referenceMap.map((r) => [r.imageN, r.entityId]));
  const imageNs = listScriptImageNs(promptText);
  const slotNs =
    imageNs.length > 0
      ? imageNs
      : [...mapByN.keys()].sort((a, b) => a - b);

  const lockedEntities = (entities ?? []).filter(
    (e) =>
      e.kind !== "style" &&
      Array.isArray(e.lockedReferenceAssetIds) &&
      e.lockedReferenceAssetIds.length > 0,
  );

  const items: {
    key: string;
    label: string;
    assetId?: string;
    imageN?: number;
    selectable: boolean;
  }[] = [];

  for (const imageN of slotNs) {
    const entityId = mapByN.get(imageN);
    const ent = entityId
      ? entities?.find((e) => e._id === entityId)
      : undefined;
    const assetId = ent?.lockedReferenceAssetIds?.[0];
    items.push({
      key: `img-${imageN}`,
      label: `@image_${imageN}`,
      assetId,
      imageN,
      selectable: true,
    });
  }
  if (styleReferenceAssetId) {
    items.push({
      key: "style",
      label: "style",
      assetId: styleReferenceAssetId,
      selectable: false,
    });
  }

  if (items.length === 0) {
    return (
      <p className="mb-2 text-[11px] text-zinc-600">
        Add @image_N lines in REFERENCES, then pick locked asset images here.
      </p>
    );
  }

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {items.map((item) =>
        item.selectable && item.imageN !== undefined ? (
          <div key={item.key} className="relative">
            <button
              type="button"
              className="w-14 shrink-0 text-left hover:opacity-90"
              onClick={() =>
                setOpenImageN((cur) =>
                  cur === item.imageN ? null : (item.imageN ?? null),
                )
              }
              title="Pick asset image"
            >
              <RefThumb
                label={item.label}
                assetId={item.assetId}
                emptyHint="Pick"
              />
            </button>
            {openImageN === item.imageN ? (
              <div className="absolute left-0 z-20 mt-1 w-56 border border-zinc-700 bg-zinc-900 py-1 shadow-lg">
                <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
                  Locked assets
                </p>
                {lockedEntities.length === 0 ? (
                  <p className="px-2 py-2 text-[11px] text-zinc-500">
                    Choose a reference on the Assets page first.
                  </p>
                ) : (
                  lockedEntities.map((ent) => (
                    <button
                      key={ent._id}
                      type="button"
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-zinc-800"
                      onClick={() => {
                        setOpenImageN(null);
                        onAssign(item.imageN!, ent.name);
                      }}
                    >
                      <MiniThumb assetId={ent.lockedReferenceAssetIds[0]} />
                      <span className="truncate text-[11px] text-zinc-200">
                        {ent.name}
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <RefThumb key={item.key} label={item.label} assetId={item.assetId} />
        ),
      )}
    </div>
  );
}

function RefThumb({
  label,
  assetId,
  emptyHint,
}: {
  label: string;
  assetId?: string;
  emptyHint?: string;
}) {
  const url = useQuery(
    api.storage.getAssetUrl,
    assetId ? { assetId: assetId as never } : "skip",
  );
  return (
    <div className="w-14 shrink-0">
      <div className="aspect-square overflow-hidden border border-zinc-800 bg-zinc-950">
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[9px] text-zinc-600">
            {emptyHint ?? ""}
          </div>
        )}
      </div>
      <p className="mt-0.5 truncate text-center text-[9px] text-zinc-500">
        {label}
      </p>
    </div>
  );
}

function MiniThumb({ assetId }: { assetId?: string }) {
  const url = useQuery(
    api.storage.getAssetUrl,
    assetId ? { assetId: assetId as never } : "skip",
  );
  return (
    <div className="size-8 shrink-0 overflow-hidden border border-zinc-800 bg-zinc-950">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : null}
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
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <div className="overflow-hidden border border-zinc-800 bg-zinc-900">
      <button
        type="button"
        onClick={() => url && setPreviewOpen(true)}
        disabled={!url}
        className="aspect-square w-full bg-zinc-950 disabled:cursor-default"
        title="View larger"
      >
        {url ? (
          <img src={url} alt={name} className="h-full w-full object-cover" />
        ) : null}
      </button>
      <div className="px-1.5 pb-2 pt-1.5">
        <button
          type="button"
          onClick={onSelect}
          className="w-full truncate text-left text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          Use as reference
        </button>
      </div>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[90vh] max-w-[min(56rem,94vw)] overflow-auto p-3 sm:p-4">
          <DialogTitle className="sr-only">{name}</DialogTitle>
          {url ? (
            <img
              src={url}
              alt={name}
              className="mx-auto max-h-[80vh] w-auto max-w-full object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LibraryThumb({
  assetId,
  name,
  onSelect,
}: {
  assetId: string;
  name: string;
  onSelect: () => void;
}) {
  const url = useQuery(api.storage.getAssetUrl, {
    assetId: assetId as never,
  });
  return (
    <button
      type="button"
      onClick={onSelect}
      title={name}
      className="aspect-square overflow-hidden border border-zinc-800 bg-zinc-950 hover:border-zinc-500"
    >
      {url ? (
        <img src={url} alt={name} className="h-full w-full object-cover" />
      ) : null}
    </button>
  );
}
