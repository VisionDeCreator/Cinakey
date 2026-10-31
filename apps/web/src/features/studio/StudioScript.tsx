import { getLocale } from "@dirrio/ui/i18n";
import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import {
  useWorkspace,
  useDraftScope,
} from "@/features/workspaces/workspace-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { useAction, useMutation, useQuery } from "@/lib/api/hooks";
import { api } from "@dirrio/backend";
import {
  referenceAlias,
  mentionAtCaret,
  resolveReferences,
  scriptMentions,
  scriptMentionRanges,
  replacementReferenceAlias,
} from "@dirrio/shared";
import { Check, Link2, Upload, X, History, ChevronDown } from "lucide-react";
import {
  useCallback,
  useLayoutEffect,
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
  segmentId,
  versionRef,
  recoverLegacyDraft,
  onDirty,
  onValidityChange,
  saveRef,
  stagingReferenceId,
}: {
  stagingReferenceId?: string;
  projectId: string;
  segmentId?: string;
  recoverLegacyDraft?: boolean;
  versionRef?: MutableRefObject<string | undefined>;
  onDirty: (dirty: boolean) => void;
  onValidityChange?: (valid: boolean) => void;
  saveRef: MutableRefObject<(() => Promise<boolean>) | null>;
}) {
  useLocale();
  const { canWrite, canPrepareVideo } = useWorkspace();
  const writeAllowed = (canPrepareVideo ?? canWrite) !== false;
  const writeAllowedRef = useRef(writeAllowed);
  useLayoutEffect(() => {
    writeAllowedRef.current = writeAllowed;
  }, [writeAllowed]);
  const project = useQuery(api.projects.get, { projectId: projectId as never });
  const workspace = useQuery(api.workspace.list, {
    projectId: projectId as never,
    segmentId: segmentId as never,
  });
  const currentId = useRef<
    import("@dirrio/backend").Id<"workspaceScripts"> | undefined
  >(undefined);
  const assets = useQuery(api.assets.list, { projectId: projectId as never });
  const sharedResources = useQuery(api.resources.referenceCandidates, {
    projectId: projectId as never,
  });
  const adoptResource = useMutation(api.resources.useInProject);
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
  useEffect(() => {
    if (versionRef) versionRef.current = currentId.current;
  });
  const draft = useRef("");
  const saved = useRef("");
  const initialized = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const alive = useRef(true);
  const draftScope = useDraftScope();
  const key = `dirrio.scriptDraft.${draftScope}${projectId}${segmentId ? `.${segmentId}` : ""}.plain`;
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
        const loaded = await loadContent({
          projectId: projectId as never,
          segmentId: segmentId as never,
        });
        const content = loaded.text;
        if (cancelled) return;
        currentId.current = loaded.id;
        if (versionRef) versionRef.current = loaded.id;
        initialized.current = true;
        let value = content;
        try {
          const legacyKey = `dirrio.scriptDraft.${draftScope}${projectId}.plain`;
          const legacy = recoverLegacyDraft
            ? localStorage.getItem(legacyKey)
            : null;
          value = localStorage.getItem(key) ?? legacy ?? content;
          if (legacy !== null && key !== legacyKey) {
            localStorage.setItem(key, value);
            localStorage.removeItem(legacyKey);
          }
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
    if (!writeAllowedRef.current) return draft.current === saved.current;
    if (saving.current) return saving.current;
    if (!initialized.current) return false;
    if (draft.current === saved.current) {
      if (versionRef) versionRef.current = currentId.current;
      return true;
    }
    const run = async () => {
      while (draft.current !== saved.current) {
        if (!writeAllowedRef.current) return false;
        const snapshot = draft.current;
        if (alive.current) {
          setStatus("Saving…");
          setError(null);
        }
        try {
          currentId.current = await save({
            projectId: projectId as never,
            segmentId: segmentId as never,
            expectedId: currentId.current,
            text: snapshot,
          });
          if (versionRef) versionRef.current = currentId.current;
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
  }, [save, projectId, segmentId, versionRef, key, onDirty, setError]);
  useEffect(() => {
    saveRef.current = saveLatest;
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, saveLatest]);
  useEffect(() => {
    if (!writeAllowed || !initialized.current || text === saved.current) return;
    const timer = window.setTimeout(() => void saveLatest(), 1000);
    return () => window.clearTimeout(timer);
  }, [text, saveLatest, writeAllowed]);
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
    if (!writeAllowedRef.current) return;
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
  const candidates = [
    ...(sharedResources ?? []),
    ...(assets ?? []).filter(
      (asset) =>
        !(sharedResources ?? []).some((shared) => shared._id === asset._id),
    ),
  ].filter((a) => a.type === "image" || a.type === "video");
  for (const resource of sharedResources ?? [])
    if (resource.url) urls.set(resource._id, resource.url);
  const links = bindings ?? [];
  const namedCandidates = (assets ?? []).map((a) => ({
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
    writeAllowed &&
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
    if (!writeAllowedRef.current || !asset || bindingBusy) return;
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
      const shared = sharedResources?.find((row) => row._id === assetId);
      if (shared)
        await adoptResource({
          projectId: projectId as never,
          versionId: shared.versionId,
        });
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
          t("Replaced @{0} with @{1} everywhere, linked to {2}.", {
            0: alias,
            1: result.alias,
            2: asset.name,
          }),
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
        t("@{0} linked to {1}. All occurrences use this asset.", {
          0: alias,
          1: asset.name,
        }),
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
    if (!writeAllowedRef.current || !picker || bindingBusy) return;
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
        t("Renamed @{0} to @{1} everywhere.", {
          0: picker,
          1: referenceAlias(renameText),
        }),
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
    if (
      !writeAllowedRef.current ||
      !node ||
      detail.phase !== "drop" ||
      bindingBusy ||
      !ready
    )
      return;
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
    <section className="studio-script" aria-label={t("Script and references")}>
      <div className="studio-section-heading">
        <h2>
          <I18nText text="Script & references" />
        </h2>
        <span className="studio-save">
          <Check size={13} />
          {t(status ?? "")}
        </span>
      </div>
      <label className="sr-only" htmlFor={`script-${projectId}`}>
        <I18nText text="Script" />
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
        readOnly={!writeAllowed || bindingBusy || uploading}
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
      <details className="studio-script-history">
        <summary>
          <History size={15} />
          <span>
            <I18nText text="Script history" />
          </span>
          <span className="studio-history-count">
            {workspace?.scripts.length ?? 0}
          </span>
          <ChevronDown size={14} className="studio-history-chevron" />
        </summary>
        <div className="studio-history-content">
          <label>
            <span>
              <I18nText text="Saved version" />
            </span>
            <Select
              defaultValue=""
              onValueChange={async (id) => {
                if (!id) return;
                try {
                  const old = await loadContent({
                    projectId: projectId as never,
                    id: id as never,
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
              <SelectTrigger aria-label={t("Script history")}>
                <SelectValue placeholder={t("Preview a saved version")} />
              </SelectTrigger>
              <SelectContent>
                {workspace?.scripts.map((version) => (
                  <SelectItem key={version._id} value={version._id}>
                    {t("Version")} {version.version} · {version.label} ·{" "}
                    {new Date(version.createdAt).toLocaleString(getLocale())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {historyText !== null && (
            <>
              <textarea
                readOnly
                aria-label={t("Script history preview")}
                value={historyText}
              />
              <div className="studio-history-footer">
                <span>
                  <I18nText text="Preview only" />
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!writeAllowed}
                  onClick={async () => {
                    if (!(await saveLatest())) return;
                    edit(historyText);
                    setHistoryText(null);
                  }}
                >
                  <I18nText text="Use this version as draft" />
                </Button>
              </div>
            </>
          )}
        </div>
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
                  name: t("@{0} · missing reference", { 0: alias }),
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
                  <I18nText text="mentions" />
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
        <I18nText text="Add reference" />
      </Button>
      {undoConversion && (
        <Button
          size="sm"
          variant="outline"
          disabled={!writeAllowed || bindingBusy}
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
          <I18nText text="Undo reference conversion" />
        </Button>
      )}
      {notice && (
        <p role="status" className="studio-muted">
          {t(notice ?? "")}{" "}
          {undoBinding && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!writeAllowed || bindingBusy}
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
              <I18nText text="Undo replacement" />
            </Button>
          )}
        </p>
      )}
      <details className="generation-reference-summary">
        <summary>
          <I18nText text="Generation references ·" />{" "}
          {generationImageIds.length} <I18nText text="images ·" />{" "}
          {generationVideoIds.length} <I18nText text="videos" />
        </summary>
        <p className="studio-muted">
          <I18nText text="Repeated mentions use the same asset. Previously generated videos and timeline clips stay unchanged." />
        </p>
        {resolved.unresolved.length > 0 && (
          <p role="status">
            <I18nText text="Link missing references:" />{" "}
            {resolved.unresolved.map((a) => `@${a}`).join(", ")}
          </p>
        )}
        {resolved.ambiguous.length > 0 && (
          <p role="status">
            <I18nText text="Choose an asset for duplicate names:" />{" "}
            {resolved.ambiguous.map((a) => `@${a}`).join(", ")}
          </p>
        )}
        {stagingReferenceId && resolved.videoIds.length > 0 && (
          <p role="alert">
            <I18nText text="Choose either the script video reference or staging as the generation video reference." />
          </p>
        )}
        {resolved.videoIds.length > 1 && (
          <p role="alert">
            <I18nText text="This generation model supports one distinct reference video. Use one video reference before generating." />
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
          aria-label={t("Reference picker")}
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
                ? t("Replace @{0} everywhere", { 0: picker })
                : t("Choose image or video")}
            </strong>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("Close reference picker")}
              onClick={() => setPicker(null)}
            >
              <X />
            </Button>
          </div>
          {!insertMention && (
            <p className="studio-muted">
              <I18nText text="Every @" />
              {picker} <I18nText text="will point to the selected asset." />
            </p>
          )}
          <input
            aria-label={t("Search references")}
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
            placeholder={t("Search names or @aliases…")}
            onChange={(e) => {
              setSearch(e.target.value.replace(/^@/, ""));
              setActiveIndex(0);
            }}
          />
          <div
            className="studio-picker-results"
            id="script-reference-suggestions"
            role="listbox"
            aria-label={t("Project image and video references")}
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
                  aria-label={t("Link {0} ({1})", {
                    0: asset.name,
                    1: asset.type,
                  })}
                  disabled={!writeAllowed || bindingBusy}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void assign(asset._id)}
                >
                  <MediaThumbnail asset={asset} url={urls.get(asset._id)} />
                  <span>
                    {asset.name}
                    <small>
                      {t(asset.type ?? "")}
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
                            <I18nText text="Updates all mentions to @" />
                            {replacementReferenceAlias(picker, asset.type, [
                              ...mentions,
                              ...links.map((l) => l.alias),
                            ])}
                          </small>
                        )}
                      {asset.createdAt
                        ? new Date(asset.createdAt).toLocaleString(getLocale())
                        : t("Project media")}
                    </small>
                    {links.some(
                      (l) =>
                        l.alias === referenceAlias(asset.name) &&
                        l.assetId !== asset._id,
                    ) && (
                      <small>
                        <I18nText text="Selecting replaces @" />
                        {referenceAlias(asset.name)}{" "}
                        <I18nText text="everywhere" />
                      </small>
                    )}
                  </span>
                </button>
              </ReferenceMedia>
            ))}
            {!results.length && (
              <p>
                <I18nText text="No matching media. Upload an image or video below." />
              </p>
            )}
          </div>
          {!insertMention && (
            <div className="reference-actions">
              <Button
                size="sm"
                variant="outline"
                onClick={() => findMention(picker)}
              >
                <I18nText text="Find next mention" />
              </Button>
              <label>
                <I18nText text="Reference name" />
                <input
                  aria-label={t("Reference name")}
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
                <I18nText text="Rename everywhere" />
              </Button>
            </div>
          )}
          <label className="studio-upload-label">
            <Upload size={14} />{" "}
            {uploading ? t("Uploading…") : t("Upload & link")}
            <input
              type="file"
              accept={
                insertMention && /^video_\d+$/.test(picker)
                  ? "video/*"
                  : insertMention && /^image_\d+$/.test(picker)
                    ? "image/*"
                    : "image/*,video/*"
              }
              disabled={!writeAllowed || bindingBusy || uploading}
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
          {t(error ?? "")}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!ready) setLoadAttempt((n) => n + 1);
              else void saveLatest();
            }}
          >
            <I18nText text="Retry save" />
          </Button>
        </div>
      )}
    </section>
  );
}
