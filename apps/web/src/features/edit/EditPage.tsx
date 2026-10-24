import { EditorMedia } from "./media/EditorMedia";
import { api, type Id } from "@cinakey/backend";
import {
  addClip,
  newTimelineId,
  assertTimelineDocument,
  assembleFromShotList,
  createEmptyTimeline,
  deleteClip,
  findClip,
  moveClip,
  recomputeTimelineDuration,
  rippleTrim,
  rollTrim,
  snapTime,
  splitClip,
  swapTakeOnClip,
  updateClip,
  type AssembleDialogueLine,
  type TimelineClip,
  type TimelineDocument,
} from "@cinakey/shared";
import { useAction, useQuery } from "@/lib/api/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmProvider";
import { ClipInspector } from "@/features/edit/ClipInspector";
import { ExportDialog } from "@/features/edit/ExportDialog";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { insertMedia, resolveMediaDuration } from "./insertMedia";
import type { StudioInsert } from "@/features/studio/StudioWorkspace";
import { StudioWorkspace } from "@/features/studio/StudioWorkspace";
import { PlaybackEngine } from "@/features/edit/engine/PlaybackEngine";
import { formatTimecode, type MediaUrlMap } from "@/features/edit/mediaUrls";
import { TimelineTracks, type TrimMode } from "@/features/edit/TimelineTracks";
import { TimelineHistoryDialog } from "@/features/edit/TimelineHistoryDialog";
import {
  createHistory,
  documentHash,
  pushDocument,
  redo,
  replacePresent,
  undo,
  type TimelineHistoryState,
} from "@/features/edit/timelineHistory";

const AUTOSAVE_MS = 2000;
const SNAP_SEC = 0.15;

export function EditPage() {
  const { projectId } = useParams();
  return <ProjectEditor key={projectId} />;
}

function ProjectEditor() {
  const { projectId } = useParams();
  const project = useQuery(
    api.projects.get,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const tip = useQuery(
    api.timelineVersions.getTip,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const assembleRows = useQuery(
    api.takes.listSelectedForAssemble,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const assets = useQuery(
    api.assets.list,
    projectId ? { projectId: projectId as never } : "skip",
  );

  const getTimelineContent = useAction(api.timelineVersions.getContent);
  const getScriptContent = useAction(api.scriptVersions.getContent);
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
  const engineCanvas = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
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
    for (const row of assembleRows ?? []) {
      map[row.take.assetId] = {
        url: row.take.assetUrl ?? "",
        proxyUrl: row.take.proxyUrl ?? undefined,
        durationSec: row.take.mediaDurationSec,
        type: "video",
      };
      if (row.take.proxyAssetId && row.take.proxyUrl) {
        map[row.take.proxyAssetId] = {
          url: row.take.proxyUrl,
          type: "video",
        };
      }
    }
    return map;
  }, [assets, assembleRows]);

  // Enrich asset URLs via storage.getAssetUrl is heavy; use a query per asset lazily.
  // For MVP, MediaBin adds assets — we fetch URLs when engine needs them via ensure.
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
          proxyUrl: map[row.assetId]?.proxyUrl,
          durationSec: row.durationSec ?? map[row.assetId]?.durationSec,
          type: row.type ?? map[row.assetId]?.type,
          name: map[row.assetId]?.name,
        };
      }
    }
    return map;
  }, [urls, assetUrls]);

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
  const recoveryKey = `cinakey.timelineRecovery.${projectId}`;
  const load = useCallback(async () => {
    if (!projectId || !aspectRatio || !projectFps || loaded.current) return;
    loaded.current = true;
    setLoadError(null);
    try {
      const result = await getTimelineContent({
        projectId: projectId as never,
      });
      if (!mounted.current) return;
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
              title: "Recover unsaved edits?",
              description:
                "This browser has a local draft from an interrupted session.",
              confirmLabel: "Recover",
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
    } catch (err) {
      loaded.current = false;
      if (mounted.current)
        setLoadError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [
    getTimelineContent,
    projectId,
    aspectRatio,
    projectFps,
    recoveryKey,
    confirm,
  ]);
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
    if (!engineRef.current || engineCanvas.current !== canvas) {
      engineRef.current?.dispose();
      engineRef.current = null;
      engineCanvas.current = canvas;
      try {
        engineRef.current = new PlaybackEngine(canvas);
      } catch (error) {
        setPreviewError(
          error instanceof Error ? error.message : "Preview could not start",
        );
        return;
      }
      engineRef.current.subscribe((s) => {
        setPlayheadSec(s.currentSec);
        setPlaying(s.playing);
        setPreviewError(s.error ?? null);
        setPreviewLoading(s.loading ?? false);
      });
    }
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
      engineCanvas.current = null;
    };
  }, []);

  const apply = useCallback((fn: (d: TimelineDocument) => TimelineDocument) => {
    setHistory((h) => {
      if (!h) return h;
      return pushDocument(h, recomputeTimelineDuration(fn(h.present)));
    });
  }, []);

  // One request at a time. Acknowledging an older snapshot never replaces newer edits.
  useEffect(() => {
    if (
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
      void saveTimeline({
        projectId: projectId as never,
        parentId: attempt.parentId,
        document: attempt.snapshot,
        requestId: attempt.requestId,
        label: "Autosave",
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
  }, [apply, markIn, playheadSec, selectedClipId]);

  const handleAssemble = async () => {
    if (!project || !projectId || !assembleRows) return;
    const hasClips = doc?.tracks.some((t) => t.clips.length > 0);
    if (hasClips) {
      const ok = await confirm({
        title: "Replace timeline?",
        description:
          "Replace the current timeline with a new rough cut? Your saved versions remain in History.",
        confirmLabel: "Replace",
      });
      if (!ok) return;
    }

    let dialogueByLineId: Record<string, AssembleDialogueLine> | undefined;
    try {
      const script = await getScriptContent({ projectId: projectId as never });
      if (script.document) {
        dialogueByLineId = {};
        for (const scene of script.document.scenes) {
          for (const beat of scene.beats) {
            for (const line of beat.lines) {
              dialogueByLineId[line.id] = {
                id: line.id,
                characterName: line.characterName,
                dialogue: line.dialogue,
              };
            }
          }
        }
      }
    } catch {
      /* captions optional */
    }

    const assembled = assembleFromShotList({
      project: {
        id: projectId,
        aspectRatio: project.aspectRatio,
        fps: project.fps,
      },
      parentFileId: tip?.timelineFileId,
      dialogueByLineId,
      shots: assembleRows.map((row) => ({
        shotId: row.shotId,
        sceneOrder: row.sceneOrder,
        shotOrder: row.shotOrder,
        durationSec: row.durationSec,
        dialogueLineId: row.dialogueLineId,
        dialogue: row.dialogue,
        take: {
          takeId: row.take.takeId,
          assetId: row.take.assetId,
          proxyAssetId: row.take.proxyAssetId,
          trimStartSec: row.take.trimStartSec,
          trimEndSec: row.take.trimEndSec,
          mediaDurationSec: row.take.mediaDurationSec,
        },
      })),
    });
    setHistory(replacePresent(createHistory(assembled), assembled, true));
    tipIdRef.current = tip?._id ?? null;
    setPlayheadSec(0);
    engineRef.current?.seek(0);
  };

  const restoreVersion = async (versionId: string) => {
    if (!projectId) return;
    const result = await getTimelineContent({
      projectId: projectId as never,
      versionId: versionId as never,
    });
    if (!result.document) return;
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
        <p role="alert">{loadError}</p>
        <Button onClick={() => void load()}>Retry loading</Button>
      </div>
    );
  function insert(media: StudioInsert) {
    if (!doc) return;
    try {
      // Compute once so undo/redo retains stable clip identifiers.
      const result = insertMedia(doc, media, playheadSec);
      apply(() => result.doc);
      setSelectedClipId(result.id);
      setPlayheadSec(result.startSec);
      pendingSeek.current = result.startSec;
      setEditError(null);
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Could not insert media",
      );
    }
  }
  async function dropMedia(
    assetId: string | null,
    files: File[],
    time: number,
    trackId: string,
  ) {
    if (dropBusy || !doc) return;
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
    return <p className="text-sm text-zinc-500">Loading editor…</p>;
  }
  if (project === null) {
    return (
      <p className="text-sm text-zinc-500">
        Project not found or access denied.
      </p>
    );
  }

  return (
    <div className="studio-editor flex min-h-0 flex-1 flex-col">
      {savePaused && (
        <div
          role="alert"
          className="flex items-center gap-2 bg-amber-950 p-2 text-sm"
        >
          <span>{loadError}</span>
          <Button onClick={() => setSavePaused(false)}>Retry save</Button>
          <Button
            onClick={() => {
              void confirm({
                title: "Save local draft as a new version?",
                description:
                  "Keeps the other saved version in history and appends your local edit.",
                confirmLabel: "Save local draft",
              }).then((ok) => {
                if (ok) {
                  tipIdRef.current = tip?._id ?? null;
                  pendingSave.current = null;
                  setSavePaused(false);
                }
              });
            }}
          >
            Keep local as new version
          </Button>
        </div>
      )}
      {loadError && (
        <p role="alert" className="studio-error">
          {loadError}
        </p>
      )}
      {editError && (
        <p role="alert" className="studio-error">
          {editError}
        </p>
      )}
      {dropBusy && (
        <p role="status" className="studio-notice">
          Preparing dropped media… You can continue editing.
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
        selectedClip={selectedClip}
        hasTimelineClips={Boolean(
          doc?.tracks.some((track) => track.clips.length),
        )}
        onPreview={() => engineRef.current?.pause()}
        onInsert={insert}
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-zinc-100">Edit</h2>
              <span className="font-mono text-xs text-zinc-400">
                {formatTimecode(playheadSec, project.fps)}
                {doc
                  ? ` / ${formatTimecode(doc.durationSec, project.fps)}`
                  : ""}
              </span>
              {saving && (
                <span className="text-[11px] text-zinc-500">Saving…</span>
              )}
              {history.dirty && !saving && (
                <span className="text-[11px] text-amber-500/80">Unsaved</span>
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
                onClick={() => setHistory((h) => (h ? undo(h) : h))}
              >
                Undo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setHistory((h) => (h ? redo(h) : h))}
              >
                Redo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!assembleRows || assembleRows.length === 0}
                title={
                  !assembleRows || assembleRows.length === 0
                    ? "Add footage or choose takes to assemble."
                    : undefined
                }
                onClick={() => void handleAssemble()}
              >
                Assemble chosen takes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!selectedClipId}
                onClick={() => {
                  if (selectedClipId)
                    apply((d) => splitClip(d, selectedClipId, playheadSec));
                }}
              >
                Split
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!selectedClip || selectedClip.source.type === "text"}
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
                Detach audio
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
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
                Add title
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setHistoryOpen(true)}
              >
                History
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setExportOpen(true)}
              >
                Export MP4
              </Button>
            </div>
          </div>
        }
        viewer={
          <>
            <canvas
              ref={setCanvasElement}
              aria-label="Timeline video preview"
            />
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
                ? `Preview unavailable: ${previewError}`
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
                    <p>{message}</p>
                    {previewError && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setPreviewError(null);
                          if (engineRef.current)
                            engineRef.current.seek(playheadSec);
                          else setPreviewRetry((value) => value + 1);
                        }}
                      >
                        Retry preview
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
          <ClipInspector
            projectId={projectId}
            clip={selectedClip}
            onChange={(patch) => {
              if (!selectedClipId) return;
              apply((d) => updateClip(d, selectedClipId, patch));
            }}
            onSwapTake={(take) => {
              if (!selectedClipId) return;
              apply((d) => swapTakeOnClip(d, selectedClipId, take));
            }}
            onDelete={() => {
              if (!selectedClipId) return;
              apply((d) => deleteClip(d, selectedClipId));
              setSelectedClipId(null);
            }}
          />
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
            onRestore={(id) => void restoreVersion(id)}
          />
        </>
      )}

      {/* keyboard mark-out retained for I/O trim */}
      <span className="sr-only">{markOut ?? ""}</span>
    </div>
  );
}
