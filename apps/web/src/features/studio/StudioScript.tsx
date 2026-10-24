import { api } from "@cinakey/backend";
import {
  referenceAlias,
  resolveReferences,
  scriptMentions,
} from "@cinakey/shared";
import { useAction, useMutation, useQuery } from "@/lib/api/hooks";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Button } from "@/components/ui/button";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { Check, Link2, Upload, X } from "lucide-react";

export function StudioScript({
  projectId,
  sequenceId,
  title,
  onDirty,
  onValidityChange,
  saveRef,
}: {
  projectId: string;
  sequenceId: string;
  title: string;
  onDirty: (dirty: boolean) => void;
  onValidityChange?: (valid: boolean) => void;
  saveRef: MutableRefObject<(() => Promise<boolean>) | null>;
}) {
  const tip = useQuery(api.promptSheets.getTipForSequence, {
    sequenceId: sequenceId as never,
  });
  const assets = useQuery(api.assets.list, { projectId: projectId as never });
  const entities = useQuery(api.entities.listForProject, {
    projectId: projectId as never,
  });
  const bindings = useQuery(api.references.list, {
    projectId: projectId as never,
  });
  const save = useAction(api.promptSheets.saveScriptPromptText);
  const loadContent = useAction(api.promptSheets.getWithContent);
  const bind = useMutation(api.references.bind);
  const { uploadFiles, uploads } = useAssetUpload(projectId);
  const [text, setText] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Loading script…");
  const [error, setError] = useState<string | null>(null);
  const [bindingBusy, setBindingBusy] = useState(false);
  const [picker, setPicker] = useState<string | null>(null);
  const [insertMention, setInsertMention] = useState(false);
  const [search, setSearch] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const draft = useRef("");
  const saved = useRef("");
  const initialized = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const alive = useRef(true);
  const key = `cinakey.scriptDraft.${projectId}.${sequenceId}`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (tip === undefined || initialized.current) return;
    let cancelled = false;
    const load = async () => {
      try {
        const content = tip?.renderedFileId
          ? (await loadContent({ promptSheetId: tip._id })).renderedText
          : (tip?.renderedText ?? "");
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
  }, [tip === undefined, loadContent, key, onDirty, loadAttempt]);

  const saveLatest = useCallback(async (): Promise<boolean> => {
    if (saving.current) return saving.current;
    if (!initialized.current || draft.current === saved.current) return true;
    const run = async () => {
      while (draft.current !== saved.current) {
        const snapshot = draft.current;
        if (!snapshot.trim()) {
          if (alive.current)
            setError(
              "A script cannot be empty. Restore its text before saving.",
            );
          return false;
        }
        if (alive.current) {
          setStatus("Saving…");
          setError(null);
        }
        try {
          await save({
            projectId: projectId as never,
            sequenceId: sequenceId as never,
            title,
            promptText: snapshot,
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
  }, [save, projectId, sequenceId, title, key, onDirty]);
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
  const legacy = (tip?.referenceMap ?? []).flatMap((r) => {
    const id = entities?.find((e) => e._id === r.entityId)
      ?.lockedReferenceAssetIds[0];
    return id ? [{ alias: `image_${r.imageN}`, assetId: id }] : [];
  });
  const links = [
    ...(bindings ?? []),
    ...legacy.filter((r) => !bindings?.some((b) => b.alias === r.alias)),
  ];
  const namedCandidates = candidates.map((a) => ({
    assetId: a._id as string,
    name: a.name,
    type: a.type as string,
  }));
  for (const entity of entities ?? [])
    if (entity.lockedReferenceAssetIds[0])
      namedCandidates.push({
        assetId: entity.lockedReferenceAssetIds[0],
        name: entity.name,
        type: "image",
      });
  const resolved = resolveReferences(text, links, namedCandidates);
  const mentions = scriptMentions(text);
  const validReferences =
    ready &&
    !bindingBusy &&
    !resolved.unresolved.length &&
    !resolved.ambiguous.length;
  useEffect(() => {
    onValidityChange?.(validReferences);
  }, [validReferences, onValidityChange]);
  async function assign(assetId: string) {
    const asset = candidates.find((a) => a._id === assetId);
    if (!asset || bindingBusy) return;
    setBindingBusy(true);
    setStatus("Linking reference…");
    const alias = referenceAlias(
      insertMention && !/^(image|video)_\d+$/.test(picker ?? "")
        ? asset.name
        : picker || asset.name,
    );
    try {
      await bind({
        projectId: projectId as never,
        alias,
        assetId: assetId as never,
      });
      if (insertMention || !mentions.includes(alias)) {
        const node = textarea.current;
        const caret = node?.selectionStart ?? draft.current.length;
        const before = draft.current.slice(0, caret);
        const partial = /@[\p{L}\p{N}_-]*$/u.exec(before);
        const start = partial ? caret - partial[0].length : caret;
        edit(
          draft.current.slice(0, start) +
            `@${alias} ` +
            draft.current.slice(caret),
        );
      }
      setPicker(null);
      setSearch("");
      setError(null);
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
  return (
    <section className="studio-script" aria-label="Scene script and references">
      <div className="studio-section-heading">
        <h2>Script & references</h2>
        <span className="studio-save">
          <Check size={13} />
          {status}
        </span>
      </div>
      <label className="sr-only" htmlFor={`script-${sequenceId}`}>
        Scene script
      </label>
      <textarea
        id={`script-${sequenceId}`}
        ref={textarea}
        value={text}
        disabled={!ready}
        spellCheck={false}
        placeholder="Write your scene. Type @ to link an image or video reference."
        onChange={(e) => {
          edit(e.target.value);
          const before = e.target.value.slice(0, e.target.selectionStart);
          const match = /@([\p{L}\p{N}_-]*)$/u.exec(before);
          if (match) {
            setInsertMention(true);
            setPicker(match[1] || "");
            setSearch(match[1] || "");
          }
        }}
        onBlur={() => void saveLatest()}
      />
      <div className="studio-reference-list">
        {mentions.map((alias) => {
          const ref = resolved.resolved.find((r) => r.alias === alias);
          const asset = candidates.find((a) => a._id === ref?.assetId);
          return (
            <button
              key={alias}
              type="button"
              className={`studio-reference ${ref ? "" : "unresolved"}`}
              onClick={() => {
                setInsertMention(false);
                setPicker(alias);
                setSearch("");
              }}
            >
              <Link2 size={13} />
              <span>@{alias}</span>
              <small>
                {asset?.name ??
                  (resolved.ambiguous.includes(alias)
                    ? "Choose matching asset"
                    : "Link asset")}
              </small>
              <span className="studio-mention-count">
                {
                  [...text.matchAll(/@([\p{L}\p{N}_-]+)/gu)].filter(
                    (m) => m[1]?.toLowerCase() === alias,
                  ).length
                }{" "}
                mentions
              </span>
            </button>
          );
        })}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setInsertMention(true);
          setPicker("");
          setSearch("");
        }}
      >
        <Link2 />
        Add reference
      </Button>
      {picker !== null && (
        <div className="studio-reference-picker" aria-label="Reference picker">
          <div className="studio-section-heading">
            <strong>
              {picker ? `Link @${picker}` : "Link image or video"}
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
          <input
            aria-label="Search references"
            value={search}
            placeholder="Search asset names…"
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="studio-picker-results">
            {candidates
              .filter(
                (a) => !/^video_\d+$/.test(picker ?? "") || a.type === "video",
              )
              .filter(
                (a) => !/^image_\d+$/.test(picker ?? "") || a.type === "image",
              )
              .filter(
                (a) =>
                  !search ||
                  a.name.toLowerCase().includes(search.toLowerCase()) ||
                  referenceAlias(a.name).includes(referenceAlias(search)) ||
                  /^image_\d+$|^video_\d+$/.test(search),
              )
              .map((a) => (
                <button
                  key={a._id}
                  aria-label={`Link ${a.name} (${a.type})`}
                  disabled={bindingBusy}
                  type="button"
                  onClick={() => void assign(a._id)}
                >
                  <span>{a.name}</span>
                  <small>{a.type}</small>
                </button>
              ))}
          </div>
          <label className="studio-upload-label">
            <Upload size={14} />
            Upload & link
            <input
              type="file"
              accept={
                /^video_\d+$/.test(picker ?? "")
                  ? "video/*"
                  : /^image_\d+$/.test(picker ?? "")
                    ? "image/*"
                    : "image/*,video/*"
              }
              disabled={bindingBusy}
              onChange={async (e) => {
                if (!e.target.files || bindingBusy) return;
                setBindingBusy(true);
                setStatus("Uploading reference…");
                try {
                  const file = e.target.files[0];
                  const ids = await uploadFiles(e.target.files);
                  if (ids[0]) {
                    const alias = referenceAlias(
                      picker ||
                        file?.name.replace(/\.[^.]+$/, "") ||
                        "reference",
                    );
                    await bind({
                      projectId: projectId as never,
                      alias,
                      assetId: ids[0] as never,
                    });
                    if (!mentions.includes(alias))
                      edit(`${draft.current}\n@${alias}`);
                    setPicker(null);
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Upload failed");
                } finally {
                  setBindingBusy(false);
                  setStatus(
                    draft.current === saved.current
                      ? "All changes saved"
                      : "Unsaved changes",
                  );
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
