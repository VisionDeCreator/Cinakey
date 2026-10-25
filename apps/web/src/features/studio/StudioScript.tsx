import { Button } from "@/components/ui/button";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { useAction, useMutation, useQuery } from "@/lib/api/hooks";
import { api } from "@cinakey/backend";
import {
  referenceAlias,
  mentionAtCaret,
  resolveReferences,
  scriptMentions,
  scriptMentionRanges,
  replacementReferenceAlias,
} from "@cinakey/shared";
import { Check, Link2, Upload, X } from "lucide-react";
import {
  useCallback,
  useEffectEvent,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { MediaThumbnail, ReferenceMedia } from "./ReferenceMedia";
import { PlainScriptEditor } from "./PlainScriptEditor";
import { caretPosition, referencePickerPosition } from "./referenceEditing";
import {
  MEDIA_POINTER_EVENT,
  type MediaPointerDetail,
} from "@/features/edit/mediaDrag";

export function StudioScript({
  projectId,
  onDirty,
  onValidityChange,
  saveRef,
  stagingReferenceId,
}: {
  stagingReferenceId?: string;
  projectId: string;
  onDirty: (dirty: boolean) => void;
  onValidityChange?: (valid: boolean) => void;
  saveRef: MutableRefObject<(() => Promise<boolean>) | null>;
}) {
  const project = useQuery(api.projects.get, { projectId: projectId as never });
  const workspace = useQuery(api.workspace.list, {
    projectId: projectId as never,
  });
  const currentId = useRef<
    import("@cinakey/backend").Id<"workspaceScripts"> | undefined
  >(undefined);
  const assets = useQuery(api.assets.list, { projectId: projectId as never });
  const bindings = useQuery(api.references.list, {
    projectId: projectId as never,
  });
  const save = useMutation(api.workspace.saveScript);
  const loadContent = useAction(api.workspace.script);
  const bind = useMutation(api.references.bind);
  const renameReference = useMutation(api.references.rename);
  const replaceReference = useMutation(api.references.replace);
  const undoReferenceReplacement = useMutation(api.references.undoReplacement);
  const assetUrls = useQuery(api.storage.listProjectAssetUrls, {
    projectId: projectId as never,
  });
  const urls = new Map(
    (assetUrls ?? []).map((a) => [a.assetId as string, a.url]),
  );
  const { uploadFiles, uploads } = useAssetUpload(projectId);
  const [text, setText] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [historyText, setHistoryText] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading script…");
  const [error, setError] = useState<string | null>(null);
  const [bindingBusy, setBindingBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState<string | null>(null);
  const [insertMention, setInsertMention] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [renameText, setRenameText] = useState("");
  const [notice, setNotice] = useState("");
  const [undoBinding, setUndoBinding] = useState<{
    alias: string;
    assetId: string;
    currentAssetId: string;
  } | null>(null);
  const [undoConversion, setUndoConversion] = useState<{
    alias: string;
    originalAlias: string;
    assetId: string;
    previousAssetId: string | null;
    previousVersionId: string;
    versionId: string;
  } | null>(null);
  const insertion = useRef({ start: 0, end: 0 });
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pickerElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !pickerElement.current?.contains(target) &&
        !(target as Element).closest?.(".reference-hover-preview") &&
        target !== textarea.current
      )
        setPicker(null);
    };
    const resize = () => setPicker(null);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", resize);
    };
  }, []);
  const draft = useRef("");
  const saved = useRef("");
  const initialized = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const alive = useRef(true);
  const key = `cinakey.scriptDraft.${projectId}.plain`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!workspace?.migrated || initialized.current) return;
    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await loadContent({ projectId: projectId as never });
        const content = loaded.text;
        currentId.current = loaded.id;
        if (cancelled) return;
        initialized.current = true;
        let value = content;
        try {
          value = localStorage.getItem(key) ?? content;
        } catch {
          /* optional recovery */
        }
        saved.current = content;
        draft.current = value;
        setText(value);
        setReady(true);
        onDirty(value !== content);
        setStatus(
          value !== content
            ? "Recovered draft · waiting to save"
            : "All changes saved",
        );
      } catch (e) {
        if (!cancelled) {
          initialized.current = false;
          setError(e instanceof Error ? e.message : "Could not load script");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // A version refresh must not cancel the initial file-backed read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.migrated, loadContent, key, onDirty, loadAttempt]);

  const saveLatest = useCallback(async (): Promise<boolean> => {
    if (saving.current) return saving.current;
    if (!initialized.current || draft.current === saved.current) return true;
    const run = async () => {
      while (draft.current !== saved.current) {
        const snapshot = draft.current;
        if (alive.current) {
          setStatus("Saving…");
          setError(null);
        }
        try {
          currentId.current = await save({
            projectId: projectId as never,
            expectedId: currentId.current,
            text: snapshot,
          });
          saved.current = snapshot;
          if (draft.current === snapshot) {
            try {
              localStorage.removeItem(key);
            } catch {
              /* optional recovery */
            }
            if (alive.current) {
              setStatus("All changes saved");
              onDirty(false);
            }
          }
        } catch (e) {
          if (alive.current) {
            setStatus("Draft saved in this browser");
            setError(e instanceof Error ? e.message : "Script save failed");
          }
          return false;
        }
      }
      return true;
    };
    const request = run();
    saving.current = request;
    try {
      return await request;
    } finally {
      saving.current = null;
    }
  }, [save, projectId, key, onDirty, setError]);
  useEffect(() => {
    saveRef.current = saveLatest;
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, saveLatest]);
  useEffect(() => {
    if (!initialized.current || text === saved.current) return;
    const timer = window.setTimeout(() => void saveLatest(), 1000);
    return () => window.clearTimeout(timer);
  }, [text, saveLatest]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (draft.current !== saved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const edit = (value: string) => {
    draft.current = value;
    setText(value);
    onDirty(value !== saved.current);
    setStatus("Unsaved changes");
    try {
      localStorage.setItem(key, value);
    } catch {
      /* unload warning still protects draft */
    }
  };
  const candidates = (assets ?? []).filter(
    (a) => a.type === "image" || a.type === "video",
  );
  const links = bindings ?? [];
  const namedCandidates = candidates.map((a) => ({
    assetId: a._id as string,
    name: a.name,
    type: a.type as string,
  }));
  const resolved = resolveReferences(text, links, namedCandidates);
  const mentions = scriptMentions(text);
  const generationImageIds = [
    ...new Set([
      ...resolved.imageIds,
      ...(project?.styleReferenceAssetId
        ? [project.styleReferenceAssetId]
        : []),
    ]),
  ];
  const generationVideoIds = [
    ...new Set([
      ...resolved.videoIds,
      ...(stagingReferenceId ? [stagingReferenceId] : []),
    ]),
  ];
  const validReferences =
    ready &&
    !bindingBusy &&
    !uploading &&
    !resolved.unresolved.length &&
    !resolved.ambiguous.length &&
    resolved.videoIds.length <= 1 &&
    !(stagingReferenceId && resolved.videoIds.length);
  useEffect(() => {
    onValidityChange?.(validReferences);
  }, [validReferences, onValidityChange]);
  function openAt(
    node: HTMLTextAreaElement,
    value = node.value,
    caret = node.selectionStart,
  ) {
    const match = mentionAtCaret(value, caret);
    insertion.current = match
      ? { start: match.start, end: match.end }
      : { start: caret, end: node.selectionEnd };
    if (!match) {
      setPicker(null);
      return;
    }
    setInsertMention(true);
    setPicker(match.query);
    setSearch(match.query);
    setActiveIndex(0);
    setPosition(caretPosition(node, caret));
  }
  function openAlias(alias: string, anchor?: { left: number; top: number }) {
    setInsertMention(false);
    setPicker(alias);
    setSearch("");
    setRenameText(alias);
    setPosition(
      anchor ? referencePickerPosition(anchor.left, anchor.top) : null,
    );
    setActiveIndex(0);
  }
  const results = candidates
    .filter(
      (asset) =>
        (!insertMention ||
          !/^video_\d+$/.test(picker ?? "") ||
          asset.type === "video") &&
        (!insertMention ||
          !/^image_\d+$/.test(picker ?? "") ||
          asset.type === "image") &&
        (!search ||
          /^(image|video)_\d+$/.test(search) ||
          referenceAlias(asset.name).includes(referenceAlias(search)) ||
          links.some(
            (link) =>
              link.assetId === asset._id &&
              link.alias.includes(referenceAlias(search)),
          )),
    )
    .sort((a, b) => {
      const rank = (id: string, name: string) =>
        links.some((l) => l.assetId === id && l.alias === search.toLowerCase())
          ? 0
          : referenceAlias(name) === referenceAlias(search)
            ? 1
            : links.some((l) => l.assetId === id)
              ? 2
              : 3;
      return (
        rank(a._id, a.name) - rank(b._id, b.name) ||
        a.name.localeCompare(b.name) ||
        a._id.localeCompare(b._id)
      );
    });
  const focusRange = (start: number, end = start) =>
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(start, end);
    });
  async function assign(
    assetId: string,
    uploaded?: { name: string; type: string },
    forceInsert = false,
  ) {
    const asset = candidates.find((a) => a._id === assetId) ?? uploaded;
    if (!asset || bindingBusy) return;
    const range = { ...insertion.current };
    const inserting = insertMention || forceInsert;
    const activePicker = forceInsert ? "" : picker;
    const alias = referenceAlias(
      inserting
        ? /^(image|video)_\d+$/.test(activePicker ?? "")
          ? activePicker!
          : (links.find(
              (l) =>
                l.assetId === assetId &&
                l.alias === activePicker?.toLowerCase(),
            )?.alias ??
            links.find((l) => l.assetId === assetId)?.alias ??
            asset.name)
        : picker || asset.name,
    );
    const previous = resolved.resolved.find((r) => r.alias === alias);
    setBindingBusy(true);
    setError(null);
    setStatus("Linking reference…");
    try {
      if (
        !inserting &&
        replacementReferenceAlias(alias, asset.type, []) !== alias
      ) {
        if (!(await saveLatest()) || !currentId.current) return;
        const result = await replaceReference({
          projectId: projectId as never,
          alias,
          assetId: assetId as never,
          expectedId: currentId.current,
          expectedAssetId: (previous?.assetId ?? null) as never,
        });
        currentId.current = result.id;
        saved.current = result.text;
        edit(result.text);
        localStorage.removeItem(key);
        onDirty(false);
        setUndoBinding(null);
        setUndoConversion({
          alias: result.alias,
          originalAlias: alias,
          assetId,
          previousAssetId: result.previousAssetId,
          previousVersionId: result.previousVersionId,
          versionId: result.id,
        });
        setNotice(
          `Replaced @${alias} with @${result.alias} everywhere, linked to ${asset.name}.`,
        );
        setPicker(null);
        setPosition(null);
        setSearch("");
        return;
      }
      await bind({
        projectId: projectId as never,
        alias,
        assetId: assetId as never,
      });
      if (inserting) {
        const value = draft.current;
        const prefix =
          range.start > 0 && !/\s/.test(value[range.start - 1] ?? "")
            ? " "
            : "";
        const suffix = value.slice(range.end);
        const trailing = suffix && /^[\s.,!?;:)\]}]/.test(suffix) ? "" : " ";
        const replacement = `${prefix}@${alias}${trailing}`;
        edit(
          value.slice(0, range.start) + replacement + value.slice(range.end),
        );
        focusRange(range.start + replacement.length);
      }
      setUndoConversion(null);
      setUndoBinding(
        previous && previous.assetId !== assetId
          ? { alias, assetId: previous.assetId, currentAssetId: assetId }
          : null,
      );
      setNotice(
        `@${alias} linked to ${asset.name}. All occurrences use this asset.`,
      );
      setPicker(null);
      setPosition(null);
      setSearch("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link reference");
    } finally {
      setBindingBusy(false);
      setStatus(
        draft.current === saved.current
          ? "All changes saved"
          : "Unsaved changes",
      );
    }
  }
  async function renameAlias() {
    if (!picker || bindingBusy) return;
    setBindingBusy(true);
    setError(null);
    try {
      if (!(await saveLatest()) || !currentId.current) return;
      const result = await renameReference({
        projectId: projectId as never,
        alias: picker,
        newAlias: renameText,
        expectedId: currentId.current,
      });
      currentId.current = result.id;
      saved.current = result.text;
      edit(result.text);
      localStorage.removeItem(key);
      onDirty(false);
      setStatus("All changes saved");
      setNotice(
        `Renamed @${picker} to @${referenceAlias(renameText)} everywhere.`,
      );
      setPicker(null);
      setUndoBinding(null);
      setUndoConversion(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename reference");
    } finally {
      setBindingBusy(false);
    }
  }
  function findMention(alias: string) {
    const node = textarea.current;
    const matches = scriptMentionRanges(draft.current).filter(
      (m) => m.alias === alias,
    );
    const next =
      matches.find((m) => m.start >= (node?.selectionEnd ?? 0)) ?? matches[0];
    if (next) {
      focusRange(next.start, next.end);
      setPicker(null);
    }
  }
  const pointerDrop = useEffectEvent((detail: MediaPointerDetail) => {
    const node = textarea.current;
    if (!node || detail.phase !== "drop" || bindingBusy || !ready) return;
    const box = node.getBoundingClientRect();
    if (
      detail.x < box.left ||
      detail.x > box.right ||
      detail.y < box.top ||
      detail.y > box.bottom
    )
      return;
    if (!candidates.some((a) => a._id === detail.assetId)) return;
    insertion.current = { start: node.selectionStart, end: node.selectionEnd };
    void assign(detail.assetId, undefined, true);
  });
  useEffect(() => {
    const handler = (e: Event) =>
      pointerDrop((e as CustomEvent<MediaPointerDetail>).detail);
    window.addEventListener(MEDIA_POINTER_EVENT, handler);
    return () => window.removeEventListener(MEDIA_POINTER_EVENT, handler);
  }, []);
  return (
    <section className="studio-script" aria-label="Script and references">
      <div className="studio-section-heading">
        <h2>Script & references</h2>
        <span className="studio-save">
          <Check size={13} />
          {status}
        </span>
      </div>
      <label className="sr-only" htmlFor={`script-${projectId}`}>
        Script
      </label>
      <PlainScriptEditor
        expanded={picker !== null && insertMention}
        activeOption={
          picker !== null && results[activeIndex]
            ? `reference-option-${activeIndex}`
            : undefined
        }
        projectId={projectId}
        ref={textarea}
        value={text}
        disabled={!ready}
        readOnly={bindingBusy || uploading}
        references={mentions.map((alias) => {
          const ref = resolved.resolved.find((r) => r.alias === alias);
          const asset = candidates.find((a) => a._id === ref?.assetId);
          return { alias, asset, url: asset ? urls.get(asset._id) : null };
        })}
        onChange={(value, caret) => {
          edit(value);
          if (textarea.current) openAt(textarea.current, value, caret);
        }}
        onCaret={(node) => {
          if (picker !== null && insertMention) openAt(node);
          else
            insertion.current = {
              start: node.selectionStart,
              end: node.selectionEnd,
            };
        }}
        onBlur={() => {
          if (!bindingBusy) void saveLatest();
        }}
        onMention={openAlias}
        onDropAsset={(id) => {
          void assign(id, undefined, true);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            setPicker(null);
            return;
          }
          if (picker === null || !insertMention) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((i) => {
              const next =
                (i +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  Math.max(1, results.length)) %
                Math.max(1, results.length);
              requestAnimationFrame(() =>
                document
                  .getElementById(`reference-option-${next}`)
                  ?.scrollIntoView({ block: "nearest" }),
              );
              return next;
            });
          }
          if (
            (event.key === "Enter" || event.key === "Tab") &&
            results[activeIndex]
          ) {
            event.preventDefault();
            void assign(results[activeIndex]!._id);
          }
        }}
      />
      <details>
        <summary>Script history ({workspace?.scripts.length ?? 0})</summary>
        <select
          aria-label="Script history"
          defaultValue=""
          onChange={async (event) => {
            if (!event.target.value) return;
            try {
              const old = await loadContent({
                projectId: projectId as never,
                id: event.target.value as never,
              });
              setHistoryText(old.text);
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not load history",
              );
            }
          }}
        >
          <option value="">Preview a saved version</option>
          {workspace?.scripts.map((version) => (
            <option key={version._id} value={version._id}>
              {version.label} · {new Date(version.createdAt).toLocaleString()}
            </option>
          ))}
        </select>
        {historyText !== null && (
          <>
            <textarea
              readOnly
              aria-label="Script history preview"
              value={historyText}
            />
            <Button
              variant="outline"
              onClick={async () => {
                if (!(await saveLatest())) return;
                edit(historyText);
                setHistoryText(null);
              }}
            >
              Use this version as draft
            </Button>
          </>
        )}
      </details>
      <div className="studio-reference-list">
        {mentions.map((alias) => {
          const ref = resolved.resolved.find((r) => r.alias === alias);
          const asset = candidates.find((a) => a._id === ref?.assetId);
          return (
            <ReferenceMedia
              key={alias}
              asset={
                asset ?? {
                  name: `@${alias} · missing reference`,
                  type: "image",
                }
              }
              url={asset ? urls.get(asset._id) : null}
            >
              <button
                type="button"
                className={`studio-reference ${ref ? "" : "unresolved"}`}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  openAlias(alias, { left: rect.left, top: rect.bottom });
                }}
              >
                {asset ? (
                  <MediaThumbnail asset={asset} url={urls.get(asset._id)} />
                ) : (
                  <Link2 size={13} />
                )}
                <span>@{alias}</span>
                <small>
                  {asset?.name ??
                    (resolved.ambiguous.includes(alias)
                      ? "Choose matching asset"
                      : "Link asset")}
                </small>
                <span className="studio-mention-count">
                  {
                    scriptMentionRanges(text).filter((m) => m.alias === alias)
                      .length
                  }{" "}
                  mentions
                </span>
              </button>
            </ReferenceMedia>
          );
        })}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setInsertMention(true);
          insertion.current = {
            start: textarea.current?.selectionStart ?? text.length,
            end: textarea.current?.selectionEnd ?? text.length,
          };
          setPicker("");
          setPosition(null);
          setSearch("");
        }}
      >
        <Link2 />
        Add reference
      </Button>
      {undoConversion && (
        <Button
          size="sm"
          variant="outline"
          disabled={bindingBusy}
          onClick={async () => {
            setBindingBusy(true);
            setError(null);
            try {
              if (
                draft.current !== saved.current ||
                currentId.current !== undoConversion.versionId
              )
                throw new Error(
                  "The script has changed. Use script history to restore an earlier version.",
                );
              const result = await undoReferenceReplacement({
                projectId: projectId as never,
                expectedId: undoConversion.versionId as never,
                previousVersionId: undoConversion.previousVersionId as never,
                alias: undoConversion.alias,
                originalAlias: undoConversion.originalAlias,
                assetId: undoConversion.assetId as never,
                previousAssetId: undoConversion.previousAssetId as never,
              });
              currentId.current = result.id;
              saved.current = result.text;
              edit(result.text);
              localStorage.removeItem(key);
              onDirty(false);
              setStatus("All changes saved");
              setUndoConversion(null);
              setNotice(
                "Restored the original reference and script formatting.",
              );
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Could not undo reference replacement",
              );
            } finally {
              setBindingBusy(false);
            }
          }}
        >
          Undo reference conversion
        </Button>
      )}
      {notice && (
        <p role="status" className="studio-muted">
          {notice}{" "}
          {undoBinding && (
            <Button
              size="sm"
              variant="ghost"
              disabled={bindingBusy}
              onClick={async () => {
                setBindingBusy(true);
                try {
                  await bind({
                    projectId: projectId as never,
                    alias: undoBinding.alias,
                    assetId: undoBinding.assetId as never,
                    expectedAssetId: undoBinding.currentAssetId as never,
                  });
                  setUndoBinding(null);
                  setNotice("Previous reference restored for all mentions.");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not undo");
                } finally {
                  setBindingBusy(false);
                }
              }}
            >
              Undo replacement
            </Button>
          )}
        </p>
      )}
      <details className="generation-reference-summary">
        <summary>
          Generation references · {generationImageIds.length} images ·{" "}
          {generationVideoIds.length} videos
        </summary>
        <p className="studio-muted">
          Repeated mentions use the same asset. Previously generated videos and
          timeline clips stay unchanged.
        </p>
        {resolved.unresolved.length > 0 && (
          <p role="status">
            Link missing references:{" "}
            {resolved.unresolved.map((a) => `@${a}`).join(", ")}
          </p>
        )}
        {resolved.ambiguous.length > 0 && (
          <p role="status">
            Choose an asset for duplicate names:{" "}
            {resolved.ambiguous.map((a) => `@${a}`).join(", ")}
          </p>
        )}
        {stagingReferenceId && resolved.videoIds.length > 0 && (
          <p role="alert">
            Choose either the script video reference or staging as the
            generation video reference.
          </p>
        )}
        {resolved.videoIds.length > 1 && (
          <p role="alert">
            This generation model supports one distinct reference video. Use one
            video reference before generating.
          </p>
        )}
        {[...new Set([...generationImageIds, ...generationVideoIds])].map(
          (id) => {
            const asset = candidates.find((a) => a._id === id);
            return (
              asset && (
                <ReferenceMedia key={id} asset={asset} url={urls.get(id)}>
                  <span tabIndex={0}>
                    <MediaThumbnail asset={asset} url={urls.get(id)} />
                    {asset.name}
                  </span>
                </ReferenceMedia>
              )
            );
          },
        )}
      </details>
      {picker !== null && (
        <div
          ref={pickerElement}
          className={`studio-reference-picker ${position ? "at-caret" : ""}`}
          style={position ? { ...position, position: "fixed" } : undefined}
          aria-label="Reference picker"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setPicker(null);
              textarea.current?.focus();
            }
          }}
        >
          <div className="studio-section-heading">
            <strong>
              {!insertMention
                ? `Replace @${picker} everywhere`
                : "Choose image or video"}
            </strong>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Close reference picker"
              onClick={() => setPicker(null)}
            >
              <X />
            </Button>
          </div>
          {!insertMention && (
            <p className="studio-muted">
              Every @{picker} will point to the selected asset.
            </p>
          )}
          <input
            aria-label="Search references"
            aria-controls="script-reference-suggestions"
            aria-activedescendant={
              results[activeIndex]
                ? `reference-option-${activeIndex}`
                : undefined
            }
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex(
                  (i) =>
                    (i +
                      (e.key === "ArrowDown" ? 1 : -1) +
                      Math.max(1, results.length)) %
                    Math.max(1, results.length),
                );
              }
              if (
                (e.key === "Enter" || e.key === "Tab") &&
                results[activeIndex]
              ) {
                e.preventDefault();
                void assign(results[activeIndex]!._id);
              }
            }}
            value={search}
            placeholder="Search names or @aliases…"
            onChange={(e) => {
              setSearch(e.target.value.replace(/^@/, ""));
              setActiveIndex(0);
            }}
          />
          <div
            className="studio-picker-results"
            id="script-reference-suggestions"
            role="listbox"
            aria-label="Project image and video references"
          >
            {results.map((asset, index) => (
              <ReferenceMedia
                key={asset._id}
                asset={asset}
                url={urls.get(asset._id)}
              >
                <button
                  id={`reference-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  aria-label={`Link ${asset.name} (${asset.type})`}
                  disabled={bindingBusy}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void assign(asset._id)}
                >
                  <MediaThumbnail asset={asset} url={urls.get(asset._id)} />
                  <span>
                    {asset.name}
                    <small>
                      {asset.type}
                      {asset.durationSec
                        ? ` · ${asset.durationSec.toFixed(1)}s`
                        : ""}{" "}
                      · @
                      {links.find((l) => l.assetId === asset._id)?.alias ??
                        referenceAlias(asset.name)}
                    </small>
                    <small>
                      {!insertMention &&
                        picker &&
                        replacementReferenceAlias(picker, asset.type, []) !==
                          picker && (
                          <small>
                            Updates all mentions to @
                            {replacementReferenceAlias(picker, asset.type, [
                              ...mentions,
                              ...links.map((l) => l.alias),
                            ])}
                          </small>
                        )}
                      {asset.createdAt
                        ? new Date(asset.createdAt).toLocaleString()
                        : "Project media"}
                    </small>
                    {links.some(
                      (l) =>
                        l.alias === referenceAlias(asset.name) &&
                        l.assetId !== asset._id,
                    ) && (
                      <small>
                        Selecting replaces @{referenceAlias(asset.name)}{" "}
                        everywhere
                      </small>
                    )}
                  </span>
                </button>
              </ReferenceMedia>
            ))}
            {!results.length && (
              <p>No matching media. Upload an image or video below.</p>
            )}
          </div>
          {!insertMention && (
            <div className="reference-actions">
              <Button
                size="sm"
                variant="outline"
                onClick={() => findMention(picker)}
              >
                Find next mention
              </Button>
              <label>
                Reference name
                <input
                  aria-label="Reference name"
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  bindingBusy ||
                  !resolved.resolved.some((r) => r.alias === picker)
                }
                onClick={() => void renameAlias()}
              >
                Rename everywhere
              </Button>
            </div>
          )}
          <label className="studio-upload-label">
            <Upload size={14} /> {uploading ? "Uploading…" : "Upload & link"}
            <input
              type="file"
              accept={
                insertMention && /^video_\d+$/.test(picker)
                  ? "video/*"
                  : insertMention && /^image_\d+$/.test(picker)
                    ? "image/*"
                    : "image/*,video/*"
              }
              disabled={bindingBusy || uploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || uploading || bindingBusy) return;
                const uploadRange = { ...insertion.current };
                setUploading(true);
                try {
                  const ids = await uploadFiles([file]);
                  insertion.current = uploadRange;
                  if (ids[0])
                    await assign(ids[0], {
                      name: picker || file.name.replace(/\.[^.]+$/, ""),
                      type: file.type.startsWith("video/") ? "video" : "image",
                    });
                } catch (error) {
                  setError(
                    error instanceof Error ? error.message : "Upload failed",
                  );
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
          {uploads
            .filter((u) => u.status === "error")
            .map((u) => (
              <p role="alert" key={u.id}>
                {u.error}
              </p>
            ))}
        </div>
      )}
      {error && (
        <div role="alert" className="studio-error">
          {error}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!ready) setLoadAttempt((n) => n + 1);
              else void saveLatest();
            }}
          >
            Retry save
          </Button>
        </div>
      )}
    </section>
  );
}
