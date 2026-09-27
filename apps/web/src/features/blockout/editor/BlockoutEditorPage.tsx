import { api } from "@cinakey/backend";
import {
  mergeBlockoutDocuments,
  tracksFromShot,
  type BlockoutNode,
  type BlockoutProject,
  type BlockoutTransform,
} from "@cinakey/shared";
import { useAction, useQuery } from "convex/react";
import {
  ArrowLeft,
  Camera,
  Download,
  ImageIcon,
  Move3d,
  Orbit,
  Rotate3d,
  Save,
  Scale3d,
  Upload,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { useCopilotContext } from "@/features/copilot/CopilotContext";
import { ExportDialog } from "@/features/blockout/export/ExportDialog";
import { ImportBlockoutDialog } from "@/features/blockout/export/ImportBlockoutDialog";
import { cn } from "@/lib/utils";
import { EditorInspector } from "./EditorInspector";
import { EditorLibrary } from "./EditorLibrary";
import { EditorTimeline } from "./EditorTimeline";
import {
  applyTransformEdit,
  buildEditorDocument,
  createDefaultShotState,
  createLight,
  createMannequin,
  createProp,
  createSetPiece,
  hasKeyframes,
  removeKeyframe,
  snapToFrame,
  stateFromShot,
  upsertKeyframe,
  type EditorShotState,
  type ShotMeta,
} from "./editorModel";
import { GUIDE_TAGS, renderGuideImages } from "./renderGuides";
import {
  EditorRuntime,
  type FrameRect,
  type GizmoMode,
  type ViewMode,
} from "./runtime/editorRuntime";
import { parseAspect } from "./runtime/shotRenderer";
import { createTimeStore } from "./timeStore";

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon: ReactNode }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex border border-zinc-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.label}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-8 items-center gap-1.5 px-2.5 text-xs text-zinc-400 transition-colors hover:text-zinc-100 [&_svg]:size-3.5",
            value === o.value && "bg-zinc-800 text-zinc-50",
          )}
        >
          {o.icon}
          <span className="hidden xl:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.getAttribute("role") === "combobox"
  );
}

export function BlockoutEditorPage() {
  const { projectId, shotId } = useParams();
  const { setContext } = useCopilotContext();
  const project = useQuery(api.projects.get, projectId ? { projectId: projectId as never } : "skip");
  const shot = useQuery(api.shots.get, shotId ? { shotId: shotId as never } : "skip");
  const scenes = useQuery(
    api.scenes.listForProject,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const entities = useQuery(
    api.entities.listForProject,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const getBlockout = useAction(api.blockouts.get);
  const saveBlockout = useAction(api.blockouts.save);
  const { uploadFiles } = useAssetUpload(projectId);

  const [state, setState] = useState<EditorShotState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<ViewMode>("orbit");
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [overlay, setOverlay] = useState({ show: false, opacity: 0.5 });
  const [frameRect, setFrameRect] = useState<FrameRect | null>(null);
  const [busy, setBusy] = useState<null | "saving" | "guides">(null);
  const [status, setStatus] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<EditorRuntime | null>(null);
  const [timeStore] = useState(createTimeStore);

  const characters = (entities ?? [])
    .filter((e) => e.kind === "character")
    .map((e) => ({ id: e._id as string, name: e.name }));
  const scene = (scenes ?? []).find((s) => s._id === shot?.sceneId) ?? null;
  const fps = project?.fps ?? 24;
  const aspectRatio = project?.aspectRatio ?? "16:9";
  const aspect = parseAspect(aspectRatio);
  const durationSec = shot?.durationSec ?? 4;
  const shotReady = shot !== undefined && shot !== null && entities !== undefined;
  const hasShot = Boolean(shot);

  // ---- load --------------------------------------------------------------

  type Stored = Awaited<ReturnType<typeof getBlockout>>;
  const applyLoaded = useEffectEvent((stored: Stored) => {
    if (!shot || !entities) return;
    if (stored) {
      const s = stored.document.scenes[0]!.shots[0]!;
      setState(stateFromShot(s, tracksFromShot(s)));
    } else {
      const chars = shot.characterIds
        .map((id) => entities.find((e) => e._id === id))
        .filter((e): e is NonNullable<typeof e> => Boolean(e))
        .map((e) => ({ id: e._id as string, name: e.name }));
      setState(createDefaultShotState(shot as ShotMeta, chars));
      if (shot.keyframeUrl) {
        setOverlay({ show: true, opacity: 0.5 });
        setView("shot");
      }
    }
    setDirty(false);
    setLoadError(null);
  });

  useEffect(() => {
    if (!shotReady || !shotId) return;
    let cancelled = false;
    getBlockout({ shotId: shotId as never })
      .then((stored) => {
        if (!cancelled) applyLoaded(stored);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load blockout");
      });
    return () => {
      cancelled = true;
    };
  }, [shotReady, shotId, reloadKey, getBlockout]);

  useEffect(() => {
    if (projectId && shotId) setContext({ view: "blockout", projectId, selectionIds: [shotId] });
  }, [projectId, shotId, setContext]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ---- runtime -----------------------------------------------------------

  function commitTransform(nodeId: string, t: BlockoutTransform) {
    setState((s) => (s ? applyTransformEdit(s, nodeId, snapToFrame(timeStore.get(), fps), t) : s));
    setDirty(true);
  }
  const onRuntimeTransform = useEffectEvent(commitTransform);

  const syncScene = useEffectEvent(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !state) return;
    runtime.setAspect(aspect);
    runtime.setShot(state.nodes, state.cameraNodeId, state.lensMm);
    runtime.setTracks(state.tracks, durationSec, fps);
  });
  const syncControls = useEffectEvent(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.select(selectedId);
    runtime.setView(view);
    runtime.setGizmoMode(gizmoMode);
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasShot) return;
    const runtime = new EditorRuntime(el, {
      onSelect: (id) => setSelectedId(id),
      onTransformCommit: (id, t) => onRuntimeTransform(id, t),
      onTime: (t) => timeStore.set(t),
      onPlayingChange: setPlaying,
      onFrameRect: setFrameRect,
    });
    runtimeRef.current = runtime;
    syncScene();
    syncControls();
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [hasShot, timeStore]);

  useEffect(() => {
    syncScene();
  }, [state, aspect, durationSec, fps]);

  useEffect(() => {
    syncControls();
  }, [selectedId, view, gizmoMode]);

  // ---- edits -------------------------------------------------------------

  function update(fn: (s: EditorShotState) => EditorShotState) {
    setState((s) => (s ? fn(s) : s));
    setDirty(true);
  }

  function addNode(node: BlockoutNode) {
    update((s) => ({ ...s, nodes: [...s.nodes, node] }));
    setSelectedId(node.id);
  }

  function patchNode(nodeId: string, patch: Partial<BlockoutNode>) {
    update((s) => ({
      ...s,
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const next = { ...n, ...patch };
        for (const k of Object.keys(patch) as Array<keyof BlockoutNode>) {
          if (patch[k] === undefined) delete next[k];
        }
        return next;
      }),
    }));
  }

  function deleteNode(nodeId: string) {
    update((s) => {
      const tracks = { ...s.tracks };
      delete tracks[nodeId];
      return { ...s, nodes: s.nodes.filter((n) => n.id !== nodeId), tracks };
    });
    setSelectedId(null);
  }

  function setKey() {
    const runtime = runtimeRef.current;
    if (!runtime || !selectedId) return;
    const t = runtime.currentTransform(selectedId);
    if (!t) return;
    const at = snapToFrame(timeStore.get(), fps);
    update((s) => ({ ...s, tracks: upsertKeyframe(s.tracks, selectedId, at, t) }));
  }

  function deleteKey() {
    if (!selectedId) return;
    const at = snapToFrame(timeStore.get(), fps);
    update((s) => ({ ...s, tracks: removeKeyframe(s.tracks, selectedId, at) }));
  }

  function togglePlay() {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (playing) runtime.pause();
    else runtime.play();
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "w") setGizmoMode("translate");
    else if (key === "e") setGizmoMode("rotate");
    else if (key === "r") setGizmoMode("scale");
    else if (key === "c") setView((v) => (v === "orbit" ? "shot" : "orbit"));
    else if (key === "k") setKey();
    else if (key === " ") {
      e.preventDefault();
      togglePlay();
    } else if (key === "escape") setSelectedId(null);
    else if ((key === "delete" || key === "backspace") && selectedId) {
      const node = state?.nodes.find((n) => n.id === selectedId);
      if (node && node.kind !== "camera" && node.kind !== "ground") deleteNode(selectedId);
    } else return;
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ---- save / guides / export -------------------------------------------

  function projectMeta(): BlockoutProject {
    return {
      id: projectId ?? "",
      title: project?.title ?? "",
      aspectRatio,
      fps,
    };
  }

  function currentDocument(next: EditorShotState) {
    return buildEditorDocument(
      projectMeta(),
      { id: shot!.sceneId, order: scene?.order ?? 0, ...(scene?.heading ? { heading: scene.heading } : {}) },
      shot as ShotMeta,
      next,
    );
  }

  async function persist(next: EditorShotState, message: string) {
    await saveBlockout({ shotId: shot!._id, document: currentDocument(next) });
    setDirty(false);
    setStatus(message);
  }

  async function save() {
    if (!state || !shot) return;
    setBusy("saving");
    setStatus(null);
    try {
      await persist(state, "Saved as a new version");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function renderGuides() {
    if (!state || !shot) return;
    setBusy("guides");
    setStatus("Rendering guides…");
    try {
      const t = snapToFrame(timeStore.get(), fps);
      const images = await renderGuideImages(
        {
          nodes: state.nodes,
          cameraNodeId: state.cameraNodeId,
          tracks: state.tracks,
          durationSec,
          lensMm: state.lensMm,
        },
        fps,
        aspect,
        t,
      );
      const base = `Shot ${shot.order + 1} blockout`;
      const common = { shotId: shot._id, sceneId: shot.sceneId };
      const [keyframeAssetId] = await uploadFiles(
        [new File([images.keyframe], `${base} keyframe.png`, { type: "image/png" })],
        { ...common, tags: [...GUIDE_TAGS.keyframe] },
      );
      const [depthAssetId] = await uploadFiles(
        [new File([images.depth], `${base} depth.png`, { type: "image/png" })],
        { ...common, tags: [...GUIDE_TAGS.depth] },
      );
      if (!keyframeAssetId || !depthAssetId) throw new Error("Guide upload failed");
      const next = { ...state, guides: { keyframeAssetId, depthAssetId } };
      setState(next);
      await persist(next, "Keyframe and depth guides saved to the shot's assets");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Guide render failed");
    } finally {
      setBusy(null);
    }
  }

  // ---- render ------------------------------------------------------------

  if (shot === null) {
    return <p className="text-sm text-zinc-500">This shot no longer exists.</p>;
  }

  const selectedNode = state?.nodes.find((n) => n.id === selectedId) ?? null;
  const backHref = `/projects/${projectId}/blockout`;
  const shotLabel = shot ? `Shot ${shot.order + 1} · ${shot.shotType}` : "Shot";

  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] min-h-[32rem] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Button asChild variant="ghost" size="sm">
          <Link to={backHref}>
            <ArrowLeft />
            Blockout
          </Link>
        </Button>
        <div className="mr-2 min-w-0">
          <p className="truncate text-sm font-medium text-zinc-100">{shotLabel}</p>
          <p className="truncate text-[11px] text-zinc-500">{scene?.heading ?? ""}</p>
        </div>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "orbit", label: "Orbit", icon: <Orbit /> },
            { value: "shot", label: "Shot camera", icon: <Camera /> },
          ]}
        />
        <Segmented
          value={gizmoMode}
          onChange={setGizmoMode}
          options={[
            { value: "translate", label: "Move", icon: <Move3d /> },
            { value: "rotate", label: "Rotate", icon: <Rotate3d /> },
            { value: "scale", label: "Scale", icon: <Scale3d /> },
          ]}
        />
        {shot?.keyframeUrl ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={overlay.show ? "secondary" : "ghost"}
              onClick={() => {
                const show = !overlay.show;
                setOverlay((o) => ({ ...o, show }));
                if (show) setView("shot");
              }}
            >
              <ImageIcon />
              Storyboard
            </Button>
            {overlay.show ? (
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={overlay.opacity}
                onChange={(e) => setOverlay((o) => ({ ...o, opacity: Number(e.target.value) }))}
                className="w-20 accent-zinc-200"
                aria-label="Storyboard overlay opacity"
              />
            ) : null}
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {status ? <span className="hidden max-w-64 truncate text-xs text-zinc-400 lg:inline">{status}</span> : null}
          <Button type="button" size="sm" variant="ghost" disabled={!state || busy !== null} onClick={() => void renderGuides()}>
            <Camera />
            Render guides
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={!shot} onClick={() => setImportOpen(true)}>
            <Upload />
            Import
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={!state} onClick={() => setExportOpen(true)}>
            <Download />
            Export
          </Button>
          <Button type="button" size="sm" disabled={!state || busy !== null} onClick={() => void save()}>
            <Save />
            {busy === "saving" ? "Saving…" : dirty ? "Save*" : "Save"}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-48 shrink-0 border-r border-zinc-800 md:block">
          <EditorLibrary
            characters={characters}
            nodes={state?.nodes ?? []}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAddMannequin={(c) =>
              addNode(createMannequin(state?.nodes.filter((n) => n.kind === "mannequin").length ?? 0, c))
            }
            onAddProp={(t) => addNode(createProp(t, state?.nodes.filter((n) => n.kind === "prop").length ?? 0))}
            onAddSet={() => addNode(createSetPiece())}
            onAddLight={(r) => addNode(createLight(r))}
          />
        </aside>

        <div className="relative min-w-0 flex-1 overflow-hidden bg-[radial-gradient(ellipse_at_center,#27272a_0%,#09090b_75%)]">
          <div ref={containerRef} className="absolute inset-0" />
          {view === "shot" && frameRect ? (
            <div
              className="pointer-events-none absolute"
              style={{ left: frameRect.left, top: frameRect.top, width: frameRect.width, height: frameRect.height }}
            >
              {overlay.show && shot?.keyframeUrl ? (
                <img
                  src={shot.keyframeUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ opacity: overlay.opacity }}
                />
              ) : null}
              <div className="absolute inset-0 border border-zinc-500/60" />
              <div className="absolute inset-y-0 left-1/3 w-px bg-white/15" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-white/15" />
              <div className="absolute inset-x-0 top-1/3 h-px bg-white/15" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-white/15" />
              <span className="absolute left-2 top-1.5 font-mono text-[10px] text-zinc-300">
                {aspectRatio} · {state?.lensMm ?? shot?.lensMm ?? 35}mm
              </span>
            </div>
          ) : null}
          {!state ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
              {loadError ?? "Loading blockout…"}
            </div>
          ) : null}
        </div>

        <aside className="hidden w-60 shrink-0 overflow-y-auto border-l border-zinc-800 md:block">
          <EditorInspector
            node={selectedNode}
            timeStore={timeStore}
            getTransform={(id) => runtimeRef.current?.currentTransform(id) ?? null}
            animated={selectedNode ? hasKeyframes(state?.tracks ?? {}, selectedNode.id) : false}
            lensMm={state?.lensMm ?? 35}
            durationSec={durationSec}
            fps={fps}
            aspectRatio={aspectRatio}
            characters={characters}
            onTransform={commitTransform}
            onPatch={patchNode}
            onLens={(lensMm) => update((s) => ({ ...s, lensMm }))}
            onDelete={deleteNode}
          />
        </aside>
      </div>

      {state ? (
        <EditorTimeline
          timeStore={timeStore}
          durationSec={durationSec}
          fps={fps}
          playing={playing}
          nodes={state.nodes}
          tracks={state.tracks}
          selectedId={selectedId}
          onTogglePlay={togglePlay}
          onSeek={(t) => runtimeRef.current?.setTime(t)}
          onSelect={setSelectedId}
          onSetKey={setKey}
          onDeleteKey={deleteKey}
        />
      ) : null}

      {state && shot ? (
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          scopeLabel={`${shotLabel} (current editor state)`}
          baseName={`${project?.title ?? "blockout"}-sc${(scene?.order ?? 0) + 1}-sh${shot.order + 1}`}
          multiShot={false}
          loadDocument={async () => ({
            document: mergeBlockoutDocuments([currentDocument(state)], projectMeta()),
          })}
        />
      ) : null}
      {shot ? (
        <ImportBlockoutDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          shotId={shot._id}
          onImported={() => {
            setState(null);
            setReloadKey((k) => k + 1);
            setStatus("Imported");
          }}
        />
      ) : null}
    </div>
  );
}
