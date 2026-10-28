import { I18nText, t, useLocale } from "@cinakey/ui/i18n";
import { useTimelineLease } from "./useTimelineLease";
import {
  useWorkspace,
  useDraftScope,
} from "@/features/workspaces/workspace-context";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/use-confirm";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { ClipInspector } from "@/features/edit/ClipInspector";
import { PlaybackEngine } from "@/features/edit/engine/PlaybackEngine";
import { ExportDialog } from "@/features/edit/ExportDialog";
import { formatTimecode, type MediaUrlMap } from "@/features/edit/mediaUrls";
import {
  createHistory,
  documentHash,
  pushDocument,
  redo,
  replacePresent,
  undo,
  type TimelineHistoryState,
} from "@/features/edit/timelineHistory";
import { TimelineHistoryDialog } from "@/features/edit/TimelineHistoryDialog";
import { TimelineTracks, type TrimMode } from "@/features/edit/TimelineTracks";
import type { StudioInsert } from "@/features/studio/StudioWorkspace";
import { StudioWorkspace } from "@/features/studio/StudioWorkspace";
import { useAction, useQuery } from "@/lib/api/hooks";
import { api, type Id } from "@cinakey/backend";
import {
  addClip,
  assertTimelineDocument,
  createEmptyTimeline,
  deleteClip,
  findClip,
  moveClip,
  newTimelineId,
  recomputeTimelineDuration,
  rippleTrim,
  rollTrim,
  snapTime,
  splitClip,
  updateClip,
  type TimelineClip,
  type TimelineDocument,
} from "@cinakey/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { insertMedia, resolveMediaDuration } from "./insertMedia";
import { EditorMedia } from "./media/EditorMedia";

const AUTOSAVE_MS = 2000;
const SNAP_SEC = 0.15;

export function EditPage() {
  useLocale();
  const { projectId } = useParams();
  return <ProjectEditor key={projectId} />;
}

function ProjectEditor() {
  useLocale();
  const { projectId } = useParams();
  const { canWrite, subscriptionMessage } = useWorkspace();
  const lease = useTimelineLease(projectId, canWrite !== false);
  const canEditNow = lease.canEditNow;
  const project = useQuery(
    api.projects.get,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const tip = useQuery(
    api.timelineVersions.getTip,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const assets = useQuery(
    api.assets.list,
    projectId ? { projectId: projectId as never } : "skip",
  );

  const workspaceState = useQuery(
    api.workspace.list,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const ensureWorkspace = useAction(api.workspace.ensure);
  const getTimelineContent = useAction(api.timelineVersions.getContent);
  const saveTimeline = useAction(api.timelineVersions.save);

  const confirm = useConfirm();
  const { uploadFiles, uploads } = useAssetUpload(projectId);
  const [dropBusy, setDropBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [history, setHistory] = useState<TimelineHistoryState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [pxPerSec, setPxPerSec] = useState(60);
  const [trimMode, setTrimMode] = useState<TrimMode>("ripple");
  const [exportOpen, setExportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);

  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(
    null,
  );
  const pendingSeek = useRef<number | null>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const bindCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    setCanvasElement(canvas);
    engineRef.current?.dispose();
    engineRef.current = null;
    if (!canvas) return;
    setPreviewError(null);
    try {
      const engine = new PlaybackEngine(canvas);
      engineRef.current = engine;
      engine.subscribe((state) => {
        setPlayheadSec(state.currentSec);
        setPlaying(state.playing);
        setPreviewError(state.error ?? null);
        setPreviewLoading(state.loading ?? false);
      });
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : "Preview could not start",
      );
    }
  }, []);
  const tipIdRef = useRef<string | null>(null);
  const [savePaused, setSavePaused] = useState(false);
  const pendingSave = useRef<{
    snapshot: TimelineDocument;
    hash: string;
    requestId: string;
    parentId: Id<"timelineVersions"> | null;
  } | null>(null);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const loaded = useRef(false);
  const [saveCycle, setSaveCycle] = useState(0);
  const lastSavedHash = useRef<string | null>(null);

  const doc = history?.present ?? null;

  const urls: MediaUrlMap = useMemo(() => {
    const map: MediaUrlMap = {};
    for (const asset of assets ?? []) {
      // assets.list may not include urls — resolve below via enrichment
      map[asset._id] = {
        url: "",
        durationSec: asset.durationSec,
        type: asset.type,
        name: asset.name,
      };
    }
    return map;
  }, [assets]);

  // Enrich asset URLs via storage.getAssetUrl is heavy; use a query per asset lazily.
  // Resolve library asset URLs before configuring playback.
  // Patch urls with getAssetUrl through a small helper query list:
  const assetUrls = useQuery(
    api.storage.listProjectAssetUrls,
    projectId ? { projectId: projectId as never } : "skip",
  );

  const mergedUrls: MediaUrlMap = useMemo(() => {
    const map = { ...urls };
    if (assetUrls) {
      for (const row of assetUrls) {
        map[row.assetId] = {
          url: row.url ?? map[row.assetId]?.url ?? "",
          proxyUrl:
            assetUrls.find(
              (proxy) =>
                proxy.assetId ===
                assets?.find((asset) => asset._id === row.assetId)
                  ?.playbackProxyAssetId,
            )?.url ?? map[row.assetId]?.proxyUrl,
          durationSec: row.durationSec ?? map[row.assetId]?.durationSec,
          type: row.type ?? map[row.assetId]?.type,
          name: map[row.assetId]?.name,
        };
      }
    }
    return map;
  }, [urls, assetUrls, assets]);

  const [editorMedia, setEditorMedia] = useState<EditorMedia>();
  const [localProxies, setLocalProxies] = useState<Record<string, string>>({});
  useEffect(() => {
    const session = new EditorMedia(
      (id, url) => {
        setLocalProxies((previous) => ({ ...previous, [id]: url }));
      },
      async (url) => engineRef.current?.cache.findBlob(url),
    );
    // Session objects own decoder resources and are replaced on project changes.
    setEditorMedia(session);
    setLocalProxies({});
    return () => session.dispose();
  }, [projectId]);
  const playbackUrls = useMemo(() => {
    const map = { ...mergedUrls };
    for (const [id, proxyUrl] of Object.entries(localProxies)) {
      if (map[id] && !map[id].proxyUrl) map[id] = { ...map[id], proxyUrl };
    }
    return map;
  }, [mergedUrls, localProxies]);

  const aspectRatio = project?.aspectRatio;
  const projectFps = project?.fps;
  const draftScope = useDraftScope();
  const recoveryKey = `cinakey.timelineRecovery.${draftScope}${projectId}`;
  const workspaceReady = workspaceState?.migrated;
  const workspaceKnown = workspaceState !== undefined;
  const load = useCallback(() => {
    if (
      !projectId ||
      !aspectRatio ||
      !projectFps ||
      loaded.current ||
      !workspaceReady
    )
      return;
    loaded.current = true;
    return getTimelineContent({ projectId: projectId as never })
      .then(async (result) => {
        if (!mounted.current) return;
        setLoadError(null);
        let next =
          result.document ??
          createEmptyTimeline({ id: projectId, aspectRatio, fps: projectFps });
        next = recomputeTimelineDuration(next);
        lastSavedHash.current = documentHash(next);
        tipIdRef.current = result.version?._id ?? null;
        let recovered = false;
        try {
          const raw = localStorage.getItem(recoveryKey);
          if (raw) {
            const draft = JSON.parse(raw) as { document: TimelineDocument };
            const candidate = assertTimelineDocument(draft.document);
            if (
              candidate.project.id === projectId &&
              documentHash(candidate) !== documentHash(next)
            ) {
              const restore = await confirm({
                get title() {
                  return t("Recover unsaved edits?");
                },
                get description() {
                  return t(
                    "This browser has a local draft from an interrupted session.",
                  );
                },
                confirmLabel: t("Recover"),
              });
              if (restore) {
                next = candidate;
                recovered = true;
              } else localStorage.removeItem(recoveryKey);
            }
          }
        } catch {
          /* Server copy remains authoritative if recovery storage is unavailable. */
        }
        if (mounted.current)
          setHistory(replacePresent(createHistory(next), next, recovered));
      })
      .catch((err) => {
        loaded.current = false;
        if (mounted.current)
          setLoadError(err instanceof Error ? err.message : "Failed to load");
      });
  }, [
    getTimelineContent,
    workspaceReady,
    projectId,
    aspectRatio,
    projectFps,
    recoveryKey,
    confirm,
  ]);
  useEffect(() => {
    if (projectId && workspaceKnown && !workspaceReady)
      void ensureWorkspace({ projectId: projectId as never }).catch((error) =>
        setLoadError(
          error instanceof Error
            ? error.message
            : "Could not initialize workspace",
        ),
      );
  }, [projectId, workspaceKnown, workspaceReady, ensureWorkspace]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!history?.dirty || !doc) return;
    try {
      localStorage.setItem(
        recoveryKey,
        JSON.stringify({ document: doc, savedAt: Date.now() }),
      );
    } catch {
      /* Unload warning still protects users if storage is full. */
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [history?.dirty, doc, recoveryKey]);

  // Playback engine
  useEffect(() => {
    const canvas = canvasElement;
    if (!canvas || !doc) return;
    if (!engineRef.current) return;
    engineRef.current.setDocument(doc, playbackUrls);
    if (pendingSeek.current !== null) {
      engineRef.current.seek(pendingSeek.current);
      pendingSeek.current = null;
    }
    return () => {
      /* keep engine across doc updates */
    };
  }, [canvasElement, doc, playbackUrls, previewRetry]);

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const apply = useCallback(
    (fn: (d: TimelineDocument) => TimelineDocument) => {
      if (!canEditNow()) return;
      setHistory((h) => {
        if (!h) return h;
        return pushDocument(h, recomputeTimelineDuration(fn(h.present)));
      });
    },
    [canEditNow],
  );

  // One request at a time. Acknowledging an older snapshot never replaces newer edits.
  useEffect(() => {
    if (
      !lease.canEdit ||
      !history?.dirty ||
      !projectId ||
      !doc ||
      savingRef.current ||
      savePaused
    )
      return;
    const snapshotHash = documentHash(doc);
    if (!pendingSave.current && snapshotHash === lastSavedHash.current) {
      try {
        localStorage.removeItem(recoveryKey);
      } catch {
        /* optional recovery storage */
      }
      setHistory((h) => (h ? { ...h, dirty: false } : h));
      return;
    }
    const timer = window.setTimeout(() => {
      savingRef.current = true;
      setSaving(true);
      const attempt = pendingSave.current ?? {
        snapshot: doc,
        hash: snapshotHash,
        parentId: tipIdRef.current as Id<"timelineVersions"> | null,
        requestId: crypto.randomUUID(),
      };
      pendingSave.current = attempt;
      if (!canEditNow()) {
        savingRef.current = false;
        setSaving(false);
        return;
      }
      void saveTimeline({
        projectId: projectId as never,
        parentId: attempt.parentId,
        document: attempt.snapshot,
        sessionId: lease.sessionId,
        fence: lease.fence!,
        requestId: attempt.requestId,
        get label() {
          return t("Autosave");
        },
      })
        .then(({ versionId }) => {
          tipIdRef.current = versionId;
          lastSavedHash.current = attempt.hash;
          pendingSave.current = null;
          if (!mounted.current) return;
          setLoadError(null);
          setHistory((h) => {
            if (!h || documentHash(h.present) !== attempt.hash) return h;
            try {
              localStorage.removeItem(recoveryKey);
            } catch {
              /* optional */
            }
            return { ...h, dirty: false };
          });
        })
        .catch((err) => {
          if (mounted.current) {
            setSavePaused(true);
            setLoadError(
              err instanceof Error
                ? err.message
                : "Autosave failed; your local draft is preserved.",
            );
          }
        })
        .finally(() => {
          savingRef.current = false;
          if (mounted.current) {
            setSaving(false);
            setSaveCycle((cycle) => cycle + 1);
          }
        });
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [
    lease.canEdit,
    lease.sessionId,
    lease.fence,
    canEditNow,
    history?.dirty,
    doc,
    projectId,
    saveTimeline,
    recoveryKey,
    saveCycle,
    savePaused,
  ]);

  const seek = (sec: number) => {
    const snapped = doc
      ? snapTime(doc, sec, null, SNAP_SEC / Math.max(pxPerSec / 60, 0.5))
      : sec;
    engineRef.current?.seek(snapped);
    setPlayheadSec(snapped);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (canEditNow())
          setHistory((h) => (h ? (e.shiftKey ? redo(h) : undo(h)) : h));
        return;
      }

      switch (e.key.toLowerCase()) {
        case " ":
          e.preventDefault();
          engineRef.current?.toggle();
          break;
        case "j":
          engineRef.current?.setRate(-1);
          break;
        case "k":
          engineRef.current?.pause();
          break;
        case "l":
          engineRef.current?.setRate(1);
          break;
        case "i":
          setMarkIn(playheadSec);
          break;
        case "o":
          setMarkOut(playheadSec);
          if (markIn !== null && selectedClipId) {
            const a = Math.min(markIn, playheadSec);
            const b = Math.max(markIn, playheadSec);
            apply((d) => {
              const found = findClip(d, selectedClipId);
              if (!found) return d;
              const localIn = a - found.clip.startSec;
              const localOut = b - found.clip.startSec;
              if (localOut <= localIn) return d;
              const span = found.clip.outSec - found.clip.inSec;
              const ratioIn = Math.max(0, localIn) / found.clip.durationSec;
              const ratioOut = Math.min(1, localOut / found.clip.durationSec);
              return updateClip(d, selectedClipId, {
                startSec: found.clip.startSec + Math.max(0, localIn),
                durationSec: Math.max(0.05, localOut - Math.max(0, localIn)),
                inSec: found.clip.inSec + span * ratioIn,
                outSec: found.clip.inSec + span * ratioOut,
              });
            });
          }
          break;
        case "s":
          if (selectedClipId) {
            apply((d) => splitClip(d, selectedClipId, playheadSec));
          }
          break;
        case "r":
          setTrimMode((m) => (m === "ripple" ? "roll" : "ripple"));
          break;
        case "delete":
        case "backspace":
          if (selectedClipId) {
            apply((d) => deleteClip(d, selectedClipId));
            setSelectedClipId(null);
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply, canEditNow, markIn, playheadSec, selectedClipId]);

  const restoreVersion = async (versionId: string) => {
    if (!projectId || !canEditNow()) return;
    const result = await getTimelineContent({
      projectId: projectId as never,
      versionId: versionId as never,
    });
    if (!result.document || !canEditNow()) return;
    setHistory(
      replacePresent(createHistory(result.document), result.document, true),
    );
  };

  const selectedClip: TimelineClip | null =
    doc && selectedClipId
      ? (findClip(doc, selectedClipId)?.clip ?? null)
      : null;

  if (!projectId) return null;
  if (history === null && loadError)
    return (
      <div>
        <p role="alert">{t(loadError ?? "")}</p>
        <Button onClick={() => void load()}>
          <I18nText text="Retry loading" />
        </Button>
      </div>
    );
  function insert(media: StudioInsert) {
    if (!doc) return false;
    if (!canEditNow()) {
      setEditError("Request editing access before changing this timeline.");
      return false;
    }
    try {
      // Compute once so undo/redo retains stable clip identifiers.
      const result = insertMedia(doc, media, playheadSec);
      apply(() => result.doc);
      setSelectedClipId(result.id);
      setPlayheadSec(result.startSec);
      pendingSeek.current = result.startSec;
      setEditError(null);
      return true;
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Could not insert media",
      );
      return false;
    }
  }
  async function dropMedia(
    assetId: string | null,
    files: File[],
    time: number,
    trackId: string,
  ) {
    if (dropBusy || !doc) return;
    if (!canEditNow()) {
      setEditError(
        "Request editing access before dropping media into this timeline.",
      );
      return;
    }
    setDropBusy(true);
    setEditError(null);
    try {
      const pending: StudioInsert[] = [];
      if (files.length) {
        await uploadFiles(files, {
          onCreated: (asset) =>
            pending.push({
              ...asset,
              durationSec:
                asset.durationSec ??
                (asset.type === "image" || asset.type === "logo" ? 3 : 0),
              inSec: 0,
              outSec:
                asset.durationSec ??
                (asset.type === "image" || asset.type === "logo" ? 3 : 0),
            }),
        });
      } else {
        const asset = assets?.find((asset) => asset._id === assetId);
        if (
          !asset ||
          !["video", "image", "audio", "music"].includes(asset.type)
        )
          throw new Error(
            "Choose a video, image, or audio asset from this project.",
          );
        const duration =
          asset.durationSec ??
          (asset.type === "image"
            ? 3
            : await resolveMediaDuration(
                mergedUrls[asset._id]?.url ?? "",
                asset.type,
              ));
        pending.push({
          assetId: asset._id,
          type: asset.type,
          durationSec: duration,
          inSec: 0,
          outSec: duration,
        });
      }
      if (!pending.length)
        throw new Error(
          "No supported media was uploaded. Check the upload messages.",
        );
      if (
        pending.some(
          (media) =>
            !Number.isFinite(media.durationSec) || media.durationSec <= 0,
        )
      )
        throw new Error(
          "Files were imported, but their duration could not be read. Preview them in the library before adding them.",
        );
      if (!canEditNow())
        throw new Error(
          "Editing access was lost. Imported files are kept in the library.",
        );
      const clipIds = pending.map(() => newTimelineId("clip"));
      // Apply against the latest document: uploads must never replace intervening edits.
      apply((current) => {
        let next = current;
        let startSec = time;
        for (const [index, media] of pending.entries()) {
          const result = insertMedia(
            next,
            { ...media, startSec, trackId },
            time,
            clipIds[index],
          );
          next = result.doc;
          startSec += media.durationSec;
        }
        return next;
      });
      setSelectedClipId(clipIds[0] ?? null);
      setPlayheadSec(time);
      pendingSeek.current = time;
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Could not drop media",
      );
    } finally {
      setDropBusy(false);
    }
  }
  if (project === undefined || history === null) {
    return loadError ? (
      <div role="alert">
        {t(loadError ?? "")}
        <Button
          onClick={() => {
            setLoadError(null);
            if (projectId)
              void ensureWorkspace({ projectId: projectId as never })
                .then(() => load())
                .catch((error) =>
                  setLoadError(
                    error instanceof Error
                      ? error.message
                      : "Could not initialize workspace",
                  ),
                );
          }}
        >
          <I18nText text="Retry loading project" />
        </Button>
      </div>
    ) : (
      <p className="text-sm text-zinc-500">
        <I18nText text="Loading editor…" />
      </p>
    );
  }
  if (project === null) {
    return (
      <p className="text-sm text-zinc-500">
        <I18nText text="Project not found or access denied." />
      </p>
    );
  }

  return (
    <div className="studio-editor flex min-h-0 flex-1 flex-col">
      {!lease.canEdit && (
        <div
          role="status"
          className="flex items-center gap-2 bg-amber-950 p-2 text-sm"
        >
          <span>
            {(canWrite === false ? subscriptionMessage : null) ??
              lease.error ??
              (lease.editor
                ? t(
                    "{0} is editing this timeline. This session is read-only.",
                    { 0: lease.editor },
                  )
                : "Read-only while editing access is acquired.")}{" "}
            <I18nText text="Local drafts are preserved." />
          </span>
          <Button disabled={canWrite === false} onClick={() => lease.request()}>
            <I18nText text="Request editing access" />
          </Button>
          {canWrite !== false && lease.canTakeover && (
            <Button
              onClick={() => {
                void confirm({
                  get title() {
                    return t("Take over timeline editing?");
                  },
                  get description() {
                    return t(
                      "The other editor will become read-only. Their local draft will be preserved.",
                    );
                  },
                  confirmLabel: t("Take over"),
                }).then((ok) => {
                  if (ok) lease.request(true);
                });
              }}
            >
              <I18nText text="Take over editing" />
            </Button>
          )}
        </div>
      )}
      {savePaused && (
        <div
          role="alert"
          className="flex items-center gap-2 bg-amber-950 p-2 text-sm"
        >
          <span>{t(loadError ?? "")}</span>
          <Button
            disabled={!lease.canEdit}
            onClick={() => setSavePaused(false)}
          >
            <I18nText text="Retry save" />
          </Button>
          <Button
            disabled={!lease.canEdit}
            onClick={() => {
              void confirm({
                get title() {
                  return t("Save local draft as a new version?");
                },
                get description() {
                  return t(
                    "Keeps the other saved version in history and appends your local edit.",
                  );
                },
                confirmLabel: t("Save local draft"),
              }).then((ok) => {
                if (ok && canEditNow()) {
                  tipIdRef.current = tip?._id ?? null;
                  pendingSave.current = null;
                  setSavePaused(false);
                }
              });
            }}
          >
            <I18nText text="Keep local as new version" />
          </Button>
        </div>
      )}
      {loadError && !savePaused && (
        <p role="alert" className="studio-error">
          {t(loadError ?? "")}
        </p>
      )}
      {editError && (
        <p role="alert" className="studio-error">
          {t(editError ?? "")}
        </p>
      )}
      {dropBusy && (
        <p role="status" className="studio-notice">
          <I18nText text="Preparing dropped media… You can continue editing." />
        </p>
      )}
      {uploads
        .filter((upload) => upload.status !== "done")
        .map((upload) => (
          <p
            key={upload.id}
            role={upload.status === "error" ? "alert" : "status"}
          >
            {upload.name}: {upload.error ?? `${upload.progress}%`}
          </p>
        ))}
      <StudioWorkspace
        readOnly={!lease.canEdit}
        selectedClip={selectedClip}
        hasTimelineClips={Boolean(
          doc?.tracks.some((track) => track.clips.length),
        )}
        onPreview={() => engineRef.current?.pause()}
        onInsert={insert}
        onInsertMany={(media) => {
          if (!canEditNow()) {
            setEditError(
              "Request editing access before changing this timeline.",
            );
            return false;
          }
          const ids = media.map(() => newTimelineId("clip"));
          apply((current) => {
            let next = current;
            let cursor = playheadSec;
            for (const [index, item] of media.entries()) {
              const inserted = insertMedia(
                next,
                { ...item, startSec: cursor },
                playheadSec,
                ids[index],
              );
              next = inserted.doc;
              cursor += item.durationSec;
            }
            return next;
          });
          setSelectedClipId(ids[0] ?? null);
          pendingSeek.current = playheadSec;
          return true;
        }}
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-zinc-100">
                <I18nText text="Edit" />
              </h2>
              <span className="font-mono text-xs text-zinc-400">
                {formatTimecode(playheadSec, project.fps)}
                {doc
                  ? ` / ${formatTimecode(doc.durationSec, project.fps)}`
                  : ""}
              </span>
              {saving && (
                <span className="text-[11px] text-zinc-500">
                  <I18nText text="Saving…" />
                </span>
              )}
              {history.dirty && !saving && (
                <span className="text-[11px] text-amber-500/80">
                  <I18nText text="Unsaved" />
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!doc || doc.durationSec <= 0}
                onClick={() => engineRef.current?.toggle()}
              >
                {playing ? "Pause" : "Play"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!lease.canEdit}
                onClick={() => {
                  if (canEditNow()) setHistory((h) => (h ? undo(h) : h));
                }}
              >
                <I18nText text="Undo" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!lease.canEdit}
                onClick={() => {
                  if (canEditNow()) setHistory((h) => (h ? redo(h) : h));
                }}
              >
                <I18nText text="Redo" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!lease.canEdit || !selectedClipId}
                onClick={() => {
                  if (selectedClipId)
                    apply((d) => splitClip(d, selectedClipId, playheadSec));
                }}
              >
                <I18nText text="Split" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  !lease.canEdit ||
                  !selectedClip ||
                  selectedClip.source.type === "text"
                }
                onClick={() => {
                  if (!selectedClip || selectedClip.source.type === "text")
                    return;
                  apply((d) => {
                    let audio = d.tracks.find(
                      (t) => t.name === "Original audio",
                    );
                    if (!audio) {
                      audio = {
                        id: newTimelineId("track"),
                        kind: "sfx",
                        name: "Original audio",
                        clips: [],
                      };
                      d = { ...d, tracks: [...d.tracks, audio] };
                    }
                    return updateClip(
                      addClip(d, audio.id, {
                        ...selectedClip,
                        id: newTimelineId("clip"),
                        volume: selectedClip.volume ?? 1,
                      }),
                      selectedClip.id,
                      { volume: 0 },
                    );
                  });
                }}
              >
                <I18nText text="Detach audio" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!lease.canEdit}
                onClick={() => {
                  if (!doc) return;
                  const titles = doc.tracks.find((t) => t.kind === "titles");
                  if (titles)
                    apply((d) =>
                      addClip(d, titles.id, {
                        id: newTimelineId("clip"),
                        startSec: playheadSec,
                        durationSec: 3,
                        inSec: 0,
                        outSec: 3,
                        speed: 1,
                        source: {
                          type: "text",
                          text: "Title",
                          styleId: "centered",
                        },
                      }),
                    );
                }}
              >
                <I18nText text="Add title" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setHistoryOpen(true)}
              >
                <I18nText text="History" />
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setExportOpen(true)}
              >
                <I18nText text="Export MP4" />
              </Button>
            </div>
          </div>
        }
        previewTransport={
          <>
            <Button
              variant="ghost"
              size="sm"
              aria-label={playing ? "Pause preview" : "Play preview"}
              disabled={!doc || doc.durationSec <= 0}
              onClick={() => engineRef.current?.toggle()}
            >
              {playing ? "Pause" : "Play"}
            </Button>
            <span className="font-mono text-xs text-zinc-400">
              {formatTimecode(playheadSec, project.fps)} /{" "}
              {formatTimecode(doc?.durationSec ?? 0, project.fps)}
            </span>
            <input
              aria-label={t("Preview playhead")}
              type="range"
              min={0}
              max={doc?.durationSec || 0}
              step={1 / project.fps}
              value={playheadSec}
              disabled={!doc?.durationSec}
              onChange={(event) => seek(Number(event.target.value))}
            />
          </>
        }
        viewer={
          <>
            <canvas ref={bindCanvas} aria-label={t("Timeline video preview")} />
            {(() => {
              const hasClips = doc?.tracks.some((track) => track.clips.length);
              const visible = doc?.tracks.some(
                (track) =>
                  !track.muted &&
                  ["video", "titles"].includes(track.kind) &&
                  track.clips.some(
                    (clip) =>
                      playheadSec >= clip.startSec &&
                      playheadSec < clip.startSec + clip.durationSec,
                  ),
              );
              const message = previewError
                ? t("Preview unavailable: {0}", { 0: previewError })
                : previewLoading
                  ? "Loading preview…"
                  : !hasClips
                    ? "Drag videos here onto the timeline to start editing. No scene needed."
                    : !visible
                      ? playheadSec >= (doc?.durationSec ?? 0)
                        ? "End of edit"
                        : "No picture at this position — audio and gaps display black."
                      : null;
              return (
                message && (
                  <div
                    className="studio-viewer-message"
                    data-state={message === "End of edit" ? "end" : "message"}
                    role={previewError ? "alert" : "status"}
                  >
                    <p>{t(message ?? "")}</p>
                    {previewError && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setPreviewError(null);
                          if (engineRef.current)
                            engineRef.current.seek(playheadSec);
                          else {
                            bindCanvas(canvasElement);
                            setPreviewRetry((value) => value + 1);
                          }
                        }}
                      >
                        <I18nText text="Retry preview" />
                      </Button>
                    )}
                  </div>
                )
              );
            })()}
          </>
        }
        timeline={
          doc ? (
            <TimelineTracks
              doc={doc}
              onDropMedia={(...args) => void dropMedia(...args)}
              media={editorMedia}
              urls={mergedUrls}
              playheadSec={playheadSec}
              pxPerSec={pxPerSec}
              selectedClipId={selectedClipId}
              trimMode={trimMode}
              onSelectClip={(id) => {
                setSelectedClipId(id);
                if (!id) return;
                const selected = findClip(doc, id)?.clip;
                if (
                  selected &&
                  (playheadSec < selected.startSec ||
                    playheadSec >= selected.startSec + selected.durationSec)
                )
                  seek(selected.startSec);
              }}
              onToggleMute={(trackId) =>
                apply((d) => ({
                  ...d,
                  tracks: d.tracks.map((t) =>
                    t.id === trackId ? { ...t, audioMuted: !t.audioMuted } : t,
                  ),
                }))
              }
              onSeek={seek}
              onZoom={setPxPerSec}
              onMoveClip={(clipId, start, trackId) => {
                const snapped = snapTime(doc, start, playheadSec, SNAP_SEC);
                apply((d) => moveClip(d, clipId, snapped, trackId));
              }}
              onTrim={(clipId, edge, sec) => {
                const snapped = snapTime(doc, sec, playheadSec, SNAP_SEC);
                if (trimMode === "ripple") {
                  apply((d) => rippleTrim(d, clipId, edge, snapped));
                } else if (edge === "out") {
                  apply((d) => rollTrim(d, clipId, snapped));
                } else {
                  apply((d) => rippleTrim(d, clipId, edge, snapped));
                }
              }}
              onRoll={(leftId, cut) => {
                const snapped = snapTime(doc, cut, playheadSec, SNAP_SEC);
                apply((d) => rollTrim(d, leftId, snapped));
              }}
            />
          ) : null
        }
        inspector={
          <fieldset disabled={!lease.canEdit} className="contents">
            <ClipInspector
              projectId={projectId}
              clip={selectedClip}
              onChange={(patch) => {
                if (!selectedClipId) return;
                apply((d) => updateClip(d, selectedClipId, patch));
              }}
              onDelete={() => {
                if (!selectedClipId) return;
                apply((d) => deleteClip(d, selectedClipId));
                setSelectedClipId(null);
              }}
            />
          </fieldset>
        }
      />

      {doc && (
        <>
          <ExportDialog
            open={exportOpen}
            onOpenChange={setExportOpen}
            doc={doc}
            urls={mergedUrls}
            projectTitle={project.title}
            projectId={projectId as Id<"projects">}
          />
          <TimelineHistoryDialog
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            projectId={projectId}
            tipId={tip?._id ?? null}
            canRestore={lease.canEdit}
            onRestore={(id) => void restoreVersion(id)}
          />
        </>
      )}

      {/* keyboard mark-out retained for I/O trim */}
      <span className="sr-only">{markOut ?? ""}</span>
    </div>
  );
}
