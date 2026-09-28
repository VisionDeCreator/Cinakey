import { api, type Id } from "@cinakey/backend";
import {
  addClip,
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
  type TrackKind,
} from "@cinakey/shared";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useCopilotContext } from "@/features/copilot/CopilotContext";
import { ClipInspector } from "@/features/edit/ClipInspector";
import { ExportDialog } from "@/features/edit/ExportDialog";
import { MediaBin } from "@/features/edit/MediaBin";
import { PlaybackEngine } from "@/features/edit/engine/PlaybackEngine";
import {
  formatTimecode,
  type MediaUrlMap,
} from "@/features/edit/mediaUrls";
import {
  TimelineTracks,
  type TrimMode,
} from "@/features/edit/TimelineTracks";
import { TimelineHistoryDialog } from "@/features/edit/TimelineHistoryDialog";
import {
  createHistory,
  documentHash,
  markClean,
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
  const storeJson = useAction(api.storage.storeJson);
  const createVersion = useMutation(api.timelineVersions.createVersion);

  const { setContext } = useCopilotContext();

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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const tipIdRef = useRef<string | null>(null);
  const lastSavedHash = useRef<string | null>(null);
  const selectionPrev = useRef<Map<string, string>>(new Map());

  const doc = history?.present ?? null;

  const urls: MediaUrlMap = useMemo(() => {
    const map: MediaUrlMap = {};
    for (const asset of assets ?? []) {
      // assets.list may not include urls — resolve below via enrichment
      map[asset._id] = {
        url: "",
        durationSec: asset.durationSec,
        type: asset.type,
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
        };
      }
    }
    return map;
  }, [urls, assetUrls]);

  useEffect(() => {
    if (!projectId) return;
    setContext({ view: "edit", projectId, selectionIds: selectedClipId ? [selectedClipId] : [] });
  }, [projectId, selectedClipId, setContext]);

  const load = useCallback(async () => {
    if (!projectId || !project) return;
    setLoadError(null);
    try {
      const result = await getTimelineContent({
        projectId: projectId as never,
      });
      const empty = createEmptyTimeline({
        id: projectId,
        aspectRatio: project.aspectRatio,
        fps: project.fps,
      });
      const next = result.document ?? empty;
      setHistory(replacePresent(createHistory(next), next, false));
      lastSavedHash.current = documentHash(next);
      tipIdRef.current = result.version?._id ?? null;
      setPlayheadSec(0);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
      const empty = createEmptyTimeline({
        id: projectId,
        aspectRatio: project.aspectRatio,
        fps: project.fps,
      });
      setHistory(createHistory(empty));
    }
  }, [getTimelineContent, project, projectId]);

  useEffect(() => {
    void load();
  }, [load, tip?._id]);

  // Playback engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    if (!engineRef.current) {
      engineRef.current = new PlaybackEngine(canvas);
      engineRef.current.subscribe((s) => {
        setPlayheadSec(s.currentSec);
        setPlaying(s.playing);
      });
    }
    engineRef.current.setDocument(doc, mergedUrls);
    return () => {
      /* keep engine across doc updates */
    };
  }, [doc, mergedUrls]);

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const apply = useCallback(
    (fn: (d: TimelineDocument) => TimelineDocument) => {
      setHistory((h) => {
        if (!h) return h;
        return pushDocument(h, recomputeTimelineDuration(fn(h.present)));
      });
    },
    [],
  );

  // Autosave
  useEffect(() => {
    if (!history?.dirty || !projectId || !doc) return;
    const hash = documentHash(doc);
    if (hash === lastSavedHash.current) return;
    const t = window.setTimeout(() => {
      void (async () => {
        setSaving(true);
        try {
          const toSave = {
            ...doc,
            version: (doc.version ?? 1) + 1,
            parentFileId: tip?.timelineFileId,
          };
          const { storageId } = await storeJson({ value: toSave });
          const id = await createVersion({
            projectId: projectId as never,
            parentId: (tipIdRef.current as never) ?? undefined,
            label: "Autosave",
            timelineFileId: storageId,
          });
          tipIdRef.current = id;
          lastSavedHash.current = documentHash(toSave);
          setHistory((h) => (h ? markClean({ ...h, present: toSave }) : h));
        } catch (err) {
          setLoadError(err instanceof Error ? err.message : "Autosave failed");
        } finally {
          setSaving(false);
        }
      })();
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [history?.dirty, doc, projectId, storeJson, createVersion, tip?.timelineFileId]);

  // Auto-update linked clips when selected take changes
  useEffect(() => {
    if (!assembleRows || !doc) return;
    for (const row of assembleRows) {
      const prev = selectionPrev.current.get(row.shotId);
      const cur = row.selectedTakeId;
      if (prev && prev !== cur) {
        for (const track of doc.tracks) {
          for (const clip of track.clips) {
            if (
              clip.linkedShotId === row.shotId &&
              clip.source.type === "take" &&
              clip.source.takeId === prev
            ) {
              apply((d) =>
                swapTakeOnClip(d, clip.id, {
                  takeId: row.take.takeId,
                  shotId: row.shotId,
                  assetId: row.take.assetId,
                  proxyAssetId: row.take.proxyAssetId,
                  trimStartSec: row.take.trimStartSec,
                  trimEndSec: row.take.trimEndSec,
                }),
              );
            }
          }
        }
      }
      selectionPrev.current.set(row.shotId, cur);
    }
  }, [assembleRows, doc, apply]);

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
    if (hasClips && !window.confirm("Replace the current timeline with a new rough cut?")) {
      return;
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
    setHistory(replacePresent(createHistory(result.document), result.document, true));
  };

  const selectedClip: TimelineClip | null =
    doc && selectedClipId ? findClip(doc, selectedClipId)?.clip ?? null : null;

  if (!projectId) return null;
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
    <div className="-mx-4 -mb-4 flex h-[calc(100dvh-7.5rem)] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-100">Edit</h2>
          <span className="font-mono text-xs text-zinc-400">
            {formatTimecode(playheadSec, project.fps)}
            {doc ? ` / ${formatTimecode(doc.durationSec, project.fps)}` : ""}
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
            onClick={() => setHistoryOpen(true)}
          >
            History
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!assembleRows || assembleRows.length === 0}
            onClick={() => void handleAssemble()}
          >
            Assemble from shot list
          </Button>
          <Button type="button" size="sm" onClick={() => setExportOpen(true)}>
            Export MP4
          </Button>
        </div>
      </div>

      {loadError && (
        <p className="border-b border-rose-900/50 bg-rose-950/40 px-4 py-1 text-xs text-rose-300">
          {loadError}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_220px_240px]">
        <div className="flex min-h-0 flex-col">
          <div className="flex flex-1 items-center justify-center bg-black p-2">
            <canvas
              ref={canvasRef}
              className="max-h-full max-w-full rounded-sm bg-zinc-950"
            />
          </div>
          {doc && (
            <TimelineTracks
              doc={doc}
              playheadSec={playheadSec}
              pxPerSec={pxPerSec}
              selectedClipId={selectedClipId}
              trimMode={trimMode}
              onSelectClip={setSelectedClipId}
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
          )}
        </div>

        {doc && (
          <MediaBin
            projectId={projectId}
            doc={doc}
            playheadSec={playheadSec}
            onAddClip={(kind: TrackKind, clip) => {
              const track = doc.tracks.find((t) => t.kind === kind);
              if (!track) return;
              apply((d) => addClip(d, track.id, clip));
              setSelectedClipId(clip.id);
            }}
          />
        )}

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
      </div>

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
