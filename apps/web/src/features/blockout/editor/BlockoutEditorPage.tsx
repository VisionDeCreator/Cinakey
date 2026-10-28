import "./editor.css";
import { uploadMedia } from "../../../lib/api/uploadMedia";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { Button } from "@/components/ui/button";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import {
  encodePrevizMp4,
  runExport,
} from "@/features/blockout/export/runExport";
import { useAction, useMutation, useQuery } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { api } from "@cinakey/backend";
import {
  CAMERA_MOVE_PRESETS,
  createPartDocument,
  migrateToV2,
  normalizeImportedDocument,
  type BlockoutDocument,
  type BlockoutEase,
  type BlockoutLightRole,
  type BlockoutObject,
  type BlockoutObjectType,
  type BlockoutProject,
  type CameraMovePresetId,
  type CameraPose,
} from "@cinakey/shared";
import {
  ArrowLeft,
  Camera,
  Download,
  ImageIcon,
  Maximize2,
  Move3d,
  Orbit,
  Pause,
  Play,
  Rotate3d,
  Save,
  Scale3d,
  Upload,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { EditorInspector } from "./EditorInspector";
import { EditorLibrary } from "./EditorLibrary";
import { EditorTimeline } from "./EditorTimeline";
import {
  applyPresetToDoc,
  createObject,
  currentCut,
  deleteCameraKey,
  deleteObjectKey,
  keyCameraAtFrame,
  keyObjectAtFrame,
  setObjectTransform,
  updateKeyEase,
  updateShotTiming,
  type SelKey,
} from "./editorModel";
import { GUIDE_TAGS, renderGuidesForDocument } from "./renderGuides";
import {
  PartSceneRuntime,
  type GizmoMode,
  type MaximizeView,
  type PassMode,
} from "./runtime/partSceneRuntime";

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
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-8 items-center gap-1.5 px-2.5 text-xs text-zinc-400 transition-colors hover:text-zinc-100 [&_svg]:size-3.5",
            value === o.value && "staging-editor-active",
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
  const { canWrite } = useWorkspace();
  const writeAllowed = useRef(canWrite !== false);
  useLayoutEffect(() => {
    writeAllowed.current = canWrite !== false;
  }, [canWrite]);
  const { projectId } = useParams();
  const [search, setSearch] = useSearchParams();

  const project = useQuery(
    api.projects.get,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const workspace = useQuery(
    api.workspace.list,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const loadedFile = useRef<
    import("@cinakey/backend").Id<"_storage"> | undefined
  >(undefined);
  const entities = useQuery(
    api.entities.listForProject,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const loadStaging = useAction(api.workspace.loadStaging);
  const saveStaging = useAction(api.workspace.saveStaging);
  const setPrevizAsset = useMutation(api.workspace.setPreviz);
  const createUploadUrl = useMutation(api.storage.createUploadUrl);
  const createAsset = useMutation(api.storage.createAssetFromUpload);
  const { uploadFiles } = useAssetUpload(projectId);

  const stagingId = search.get("new")
    ? null
    : (search.get("staging") ?? workspace?.staging[0]?._id ?? null);

  const [doc, setDoc] = useState<BlockoutDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const editRevision = useRef(0);
  const markDirty = () => {
    editRevision.current++;
    setDirty(true);
  };
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<SelKey | null>(null);
  const [cameraDirty, setCameraDirty] = useState(false);
  const [live, setLive] = useState<CameraPose>({
    pos: [0, 1.6, 6],
    target: [0, 1.4, 0],
    focal: 35,
    roll: 0,
  });
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [maximize, setMaximize] = useState<MaximizeView>("split");
  const [passMode, setPassMode] = useState<PassMode>("clay");
  const [busy, setBusy] = useState<null | "saving" | "guides" | "export">(null);
  const [status, setStatus] = useState<string | null>(null);
  const [exportBurnIn, setExportBurnIn] = useState(true);
  const [exportMode, setExportMode] = useState<"clay" | "depth">("clay");
  const [exportRange, setExportRange] = useState<"part" | "shot">("part");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const undoStack = useRef<string[]>([]);
  const runtimeRef = useRef<PartSceneRuntime | null>(null);
  const shotCanvasRef = useRef<HTMLCanvasElement>(null);
  const dirCanvasRef = useRef<HTMLCanvasElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const shotStageRef = useRef<HTMLDivElement>(null);
  const dirStageRef = useRef<HTMLDivElement>(null);
  const playAcc = useRef(0);
  const lastNow = useRef(0);

  const characters = (entities ?? []).filter(
    (e) => e.kind === "character" || e.kind === "creature",
  );
  const cut = doc ? currentCut(doc, frame) : null;
  const location = cut?.sceneHeading ?? "";

  // Load document
  const applyLoaded = useEffectEvent((loaded: BlockoutDocument) => {
    setDoc(loaded);
    setDirty(false);
    undoStack.current = [];
    const start = 0;
    setFrame(start);
    setCameraDirty(false);
    setSelectedId(null);
    setSelectedKey(null);
    runtimeRef.current?.setDocument(loaded);
    runtimeRef.current?.setFrame(start, true);
    const pose = runtimeRef.current?.getLivePose();
    if (pose) setLive(pose);
  });

  const loadedProjectId = project?._id;
  const projectTitle = project?.title ?? "";
  const projectAspect = project?.aspectRatio ?? "16:9";
  const projectFps = project?.fps ?? 24;
  const newDocument = search.get("new") === "1";
  useEffect(() => {
    if (!loadedProjectId || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadStaging({
          projectId: projectId as never,
          id: (stagingId as never) ?? undefined,
          newDocument: newDocument,
        });
        if (cancelled) return;
        loadedFile.current = stored.fileId ?? undefined;
        const projectMeta: BlockoutProject = {
          id: loadedProjectId,
          title: projectTitle,
          aspectRatio: projectAspect,
          fps: projectFps,
        };
        let document: BlockoutDocument;
        if (stored?.document) {
          document = migrateToV2(stored.document, {
            project: projectMeta,
          });
        } else {
          document = createPartDocument(projectMeta, "", {
            name: projectTitle,
          });
        }
        applyLoaded(document);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    stagingId,
    loadedProjectId,
    projectTitle,
    projectAspect,
    projectFps,
    newDocument,
    projectId,
    loadStaging,
  ]);

  const pushUndo = () => {
    if (!doc) return;
    undoStack.current.push(JSON.stringify(doc));
    if (undoStack.current.length > 60) undoStack.current.shift();
  };

  const frameRef = useRef(frame);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  // Mount runtime once canvases exist. The loading gate below unmounts
  // canvases while !doc, so this must wait until the first loaded document.
  const editorReady = Boolean(doc);
  useEffect(() => {
    if (!editorReady) return;
    if (
      !shotCanvasRef.current ||
      !dirCanvasRef.current ||
      !hudCanvasRef.current ||
      !shotStageRef.current ||
      !dirStageRef.current
    ) {
      return;
    }
    const rt = new PartSceneRuntime({
      onSelectObject: (id) => setSelectedId(id),
      onCameraDirty: () => {
        if (!writeAllowed.current) return;
        setCameraDirty(true);
        markDirty();
        const pose = runtimeRef.current?.getLivePose();
        if (pose) setLive(pose);
      },
      onObjectMoved: (id, pose) => {
        if (!writeAllowed.current) return;
        pushUndo();
        setDoc((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            objects: prev.objects.map((o) =>
              o.id !== id
                ? o
                : setObjectTransform(
                    o,
                    frameRef.current,
                    pose.x,
                    pose.z,
                    pose.rot,
                    pose.y,
                  ),
            ),
          };
        });
        markDirty();
      },
    });
    runtimeRef.current = rt;
    rt.mount({
      shotCanvas: shotCanvasRef.current,
      dirCanvas: dirCanvasRef.current,
      hudCanvas: hudCanvasRef.current,
      shotStage: shotStageRef.current,
      dirStage: dirStageRef.current,
    });
    const loaded = docRef.current;
    if (loaded) {
      rt.setDocument(loaded);
      rt.setFrame(frameRef.current, true);
      setLive(rt.getLivePose());
    }
    return () => {
      rt.dispose();
      runtimeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per editorReady
  }, [editorReady]);

  // Sync doc → runtime object meshes when objects change
  useEffect(() => {
    if (!doc || !runtimeRef.current) return;
    runtimeRef.current.refreshObjects(doc.objects);
    runtimeRef.current.refreshCameraPath();
  }, [doc]);

  useEffect(() => {
    runtimeRef.current?.setFrame(frame, !cameraDirty);
    if (!cameraDirty) {
      const pose = runtimeRef.current?.getLivePose();
      if (pose) setLive(pose);
    }
  }, [frame, cameraDirty]);

  useEffect(() => {
    runtimeRef.current?.setGizmoMode(gizmoMode);
  }, [gizmoMode]);

  useEffect(() => {
    runtimeRef.current?.selectObject(canWrite === false ? null : selectedId);
  }, [selectedId, canWrite]);

  useEffect(() => {
    runtimeRef.current?.setPassMode(passMode);
  }, [passMode]);

  // Playback
  useEffect(() => {
    if (!playing || !doc) return;
    lastNow.current = performance.now();
    playAcc.current = 0;
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - lastNow.current) / 1000;
      lastNow.current = now;
      playAcc.current += dt * doc.fps;
      if (playAcc.current >= 1) {
        const step = Math.floor(playAcc.current);
        playAcc.current -= step;
        setFrame((f) => {
          const next = f + step;
          if (next >= doc.frames) {
            setPlaying(false);
            return doc.frames;
          }
          return next;
        });
        setCameraDirty(false);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, doc]);

  // Unsaved leave warning
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const commitDoc = (next: BlockoutDocument, opts?: { undo?: boolean }) => {
    if (!writeAllowed.current) return;
    if (opts?.undo !== false) pushUndo();
    setDoc(next);
    markDirty();
    runtimeRef.current?.setDocument(next);
  };

  const undo = () => {
    if (!writeAllowed.current) return;
    const raw = undoStack.current.pop();
    if (!raw) {
      setStatus("Nothing to undo");
      return;
    }
    const prev = JSON.parse(raw) as BlockoutDocument;
    setDoc(prev);
    markDirty();
    setCameraDirty(false);
    runtimeRef.current?.setDocument(prev);
    runtimeRef.current?.setFrame(frame, true);
    setStatus("Undone");
  };

  const onLiveChange = (pose: CameraPose) => {
    if (!writeAllowed.current) return;
    setLive(pose);
    setCameraDirty(true);
    markDirty();
    runtimeRef.current?.setLivePose(pose, true);
  };

  const keyCamera = () => {
    if (!writeAllowed.current) return;
    if (!doc) return;
    pushUndo();
    const { doc: next, key } = keyCameraAtFrame(doc, frame, live);
    setDoc(next);
    markDirty();
    setCameraDirty(false);
    setSelectedKey({ kind: "cam", id: key.id });
    runtimeRef.current?.setCameraDirty(false);
    runtimeRef.current?.setDocument(next);
    setStatus(`Camera keyed at frame ${frame}`);
  };

  const addObject = (
    type: BlockoutObjectType,
    opts?: {
      name?: string;
      entityId?: string;
      lightRole?: BlockoutLightRole;
    },
  ) => {
    if (!writeAllowed.current || !doc) return;
    pushUndo();
    const o = createObject(type, live, opts);
    const next = { ...doc, objects: [...doc.objects, o] };
    setDoc(next);
    markDirty();
    setSelectedId(o.id);
    runtimeRef.current?.refreshObjects(next.objects);
  };

  const onSave = async () => {
    if (!writeAllowed.current) return;
    if (!doc || !projectId || busy) return;
    const snapshot = cameraDirty ? keyCameraAtFrame(doc, frame, live).doc : doc;
    const revision = editRevision.current;
    if (cameraDirty) {
      pushUndo();
      setDoc(snapshot);
      docRef.current = snapshot;
      setCameraDirty(false);
      runtimeRef.current?.setCameraDirty(false);
      runtimeRef.current?.setDocument(snapshot);
    }
    setBusy("saving");
    setStatus(null);
    try {
      const saved = await saveStaging({
        projectId: projectId as never,
        id: (stagingId as never) ?? undefined,
        document: snapshot,
        expectedFileId: loadedFile.current,
      });
      loadedFile.current = saved.fileId;
      if (!stagingId) setSearch({ staging: saved.id }, { replace: true });
      const unchanged = editRevision.current === revision;
      if (unchanged) setDirty(false);
      setStatus(
        unchanged ? "Saved" : "Version saved · newer changes remain unsaved",
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const onRenderGuides = async () => {
    if (!writeAllowed.current) return;
    if (!doc || !projectId || busy) return;
    setBusy("guides");
    setStatus(null);
    try {
      const guides = await renderGuidesForDocument(doc);
      const guideMap: BlockoutDocument["guides"] = { ...(doc.guides ?? {}) };
      for (const g of guides) {
        const keyFiles = [
          new File([g.keyframe], `guide-s${g.n}-key.png`, {
            type: "image/png",
          }),
        ];
        const depthFiles = [
          new File([g.depth], `guide-s${g.n}-depth.png`, {
            type: "image/png",
          }),
        ];
        const keyIds = await uploadFiles(keyFiles, {
          type: "image",
          tags: [...GUIDE_TAGS.keyframe],
        });
        const depthIds = await uploadFiles(depthFiles, {
          type: "image",
          tags: [...GUIDE_TAGS.depth],
        });
        const key = g.shotId ?? `n${g.n}`;
        guideMap[key] = {
          keyframeAssetId: keyIds[0],
          depthAssetId: depthIds[0],
        };
      }
      const next = { ...doc, guides: guideMap };
      commitDoc(next, { undo: false });
      if (projectId) {
        const saved = await saveStaging({
          projectId: projectId as never,
          id: (stagingId as never) ?? undefined,
          document: next,
          expectedFileId: loadedFile.current,
        });
        loadedFile.current = saved.fileId;
        setDirty(false);
      }
      setStatus(`Rendered ${guides.length} guide pairs`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Guides failed");
    } finally {
      setBusy(null);
    }
  };

  const onExportMp4 = async () => {
    if (!writeAllowed.current) return;
    if (!doc || !projectId || busy) return;
    setBusy("export");
    setStatus(null);
    const ac = new AbortController();
    try {
      const range =
        exportRange === "shot" && cut
          ? { start: cut.start, end: cut.end }
          : undefined;
      await runExport({
        document: doc,
        baseName: doc.name || "blockout",
        options: {
          json: false,
          mp4: true,
          burnIn: exportBurnIn,
          mode: exportMode,
          range: exportRange,
          shotStart: range?.start,
          shotEnd: range?.end,
        },
        signal: ac.signal,
        onProgress: (p) => setStatus(p.label),
      });
      // Also upload as previz when whole part
      if (exportRange === "part" && projectId) {
        const blob = await encodePrevizMp4({
          document: doc,
          signal: ac.signal,
          onProgress: (p) => setStatus(p.label),
        });
        const uploadUrl = await createUploadUrl({
          projectId: projectId as never,
        });
        const res = await uploadMedia(uploadUrl, blob);
        if (!res.ok) throw new Error("Upload failed");
        const { storageId } = (await res.json()) as { storageId: string };
        const assetId = await createAsset({
          projectId: projectId as never,
          storageId: storageId as never,
          type: "video",
          name: `${doc.name} pre-viz`,
          format: "video/mp4",
          tags: ["previz", "blockout"],
          durationSec: doc.frames / doc.fps,
        });
        let savedStagingId = stagingId;
        if (!savedStagingId) {
          const saved = await saveStaging({
            projectId: projectId as never,
            document: doc,
          });
          savedStagingId = saved.id;
          loadedFile.current = saved.fileId;
          setSearch({ staging: saved.id }, { replace: true });
        }
        await setPrevizAsset({
          id: savedStagingId as never,
          assetId: assetId as never,
        });
      }
      setStatus("Export done");
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        setStatus(err instanceof Error ? err.message : "Export failed");
      }
    } finally {
      setBusy(null);
    }
  };

  const onExportJson = () => {
    if (!doc) return;
    void runExport({
      document: doc,
      baseName: doc.name || "blockout",
      options: {
        json: true,
        mp4: false,
        burnIn: false,
        mode: "clay",
        range: "part",
      },
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });
  };

  const onImportApply = () => {
    if (!writeAllowed.current) return;
    const { doc: next, error } = normalizeImportedDocument(
      JSON.parse(importText),
    );
    if (error) {
      setStatus(error);
      return;
    }
    const withProject =
      project && stagingId
        ? {
            ...next,
            project: {
              id: project._id,
              title: project.title,
              aspectRatio: project.aspectRatio,
              fps: project.fps,
            },
          }
        : next;
    commitDoc(withProject);
    setImportOpen(false);
    setStatus("Imported");
  };

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void onSave();
        return;
      }
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
        return;
      }
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        keyCamera();
        return;
      }
      if (e.key.toLowerCase() === "w") setGizmoMode("translate");
      if (e.key.toLowerCase() === "e") setGizmoMode("rotate");
      if (e.key.toLowerCase() === "r") setGizmoMode("scale");
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        setCameraDirty(false);
        setFrame((f) => Math.max(0, f - (e.shiftKey && doc ? doc.fps : 1)));
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        setCameraDirty(false);
        setFrame((f) =>
          Math.min(doc?.frames ?? f, f + (e.shiftKey && doc ? doc.fps : 1)),
        );
      }
      if (e.key === "Home") {
        e.preventDefault();
        setFrame(0);
        setCameraDirty(false);
      }
      if (e.key === "End" && doc) {
        e.preventDefault();
        setFrame(doc.frames);
        setCameraDirty(false);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedKey) {
          e.preventDefault();
          pushUndo();
          if (!doc) return;
          if (selectedKey.kind === "cam") {
            commitDoc(deleteCameraKey(doc, selectedKey.id), { undo: false });
          } else {
            commitDoc(
              {
                ...doc,
                objects: doc.objects.map((o) =>
                  o.id !== selectedKey.objectId
                    ? o
                    : deleteObjectKey(o, selectedKey.f),
                ),
              },
              { undo: false },
            );
          }
          setSelectedKey(null);
        } else if (selectedId && doc) {
          e.preventDefault();
          pushUndo();
          commitDoc(
            {
              ...doc,
              objects: doc.objects.filter((o) => o.id !== selectedId),
            },
            { undo: false },
          );
          setSelectedId(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!projectId) return null;
  if (loadError) {
    return <div className="p-4 text-sm text-rose-300">{loadError}</div>;
  }
  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Loading editor…
      </div>
    );
  }

  const selectedObject = doc.objects.find((o) => o.id === selectedId) ?? null;
  const shotTitle = cut
    ? `Camera cut ${cut.n}${cut.shotType ? ` · ${cut.shotType.toUpperCase()}` : ""}`
    : doc.name;

  return (
    <div className="staging-editor flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-200">
      {/* Top bar */}
      <header className="staging-editor-header flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-2 py-1.5">
        <Button type="button" size="sm" variant="ghost" className="h-8" asChild>
          <Link
            to={`/projects/${projectId}/studio${stagingId ? `?staging=${stagingId}` : ""}`}
          >
            <ArrowLeft className="size-3.5" />
            Back to Studio
          </Link>
        </Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-100">
            3D staging editor
          </p>
          <p className="text-xs text-zinc-400">{shotTitle} · {dirty ? "Unsaved changes" : "Saved staging"}</p>
          {location ? (
            <p className="truncate text-[11px] text-zinc-500">{location}</p>
          ) : null}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={playing ? "default" : "outline"}
            className="h-8 min-w-[4.5rem]"
            onClick={() => setPlaying((p) => !p)}
            title="Play / pause (Space)"
          >
            {playing ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
            {playing ? "Pause" : "Play"}
          </Button>
          <Segmented
            value={maximize}
            onChange={setMaximize}
            options={[
              { value: "split", label: "Split", icon: <Maximize2 /> },
              { value: "shot", label: "Camera view", icon: <Camera /> },
              { value: "director", label: "Director", icon: <Orbit /> },
            ]}
          />
          <fieldset disabled={canWrite === false} className="contents">
            <Segmented
              value={gizmoMode}
              onChange={setGizmoMode}
              options={[
                { value: "translate", label: "Move", icon: <Move3d /> },
                { value: "rotate", label: "Rotate", icon: <Rotate3d /> },
                { value: "scale", label: "Scale", icon: <Scale3d /> },
              ]}
            />
          </fieldset>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={canWrite === false || busy === "guides"}
            onClick={() => void onRenderGuides()}
          >
            <ImageIcon className="size-3.5" />
            Render guides
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => {
              setImportText(JSON.stringify(doc, null, 2));
              setImportOpen(true);
            }}
          >
            <Upload className="size-3.5" />
            Import
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            onClick={onExportJson}
          >
            <Download className="size-3.5" />
            Export
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={canWrite === false || busy === "saving"}
            onClick={() => void onSave()}
          >
            <Save className="size-3.5" />
            Save staging
            {dirty ? (
              <span className="ml-1 size-1.5 rounded-full bg-amber-400" />
            ) : null}
          </Button>
        </div>
      </header>

      {/* Main */}
      <div className="staging-editor-body flex min-h-0 flex-1">
        <EditorLibrary
          objects={doc.objects}
          selectedId={selectedId}
          onSelect={setSelectedId}
          characters={characters.map((c) => ({
            id: c._id,
            name: c.name,
            kind: c.kind,
          }))}
          onAddCharacter={(entity) =>
            addObject(
              entity?.kind === "creature" ? "creature" : "character",
              entity
                ? { name: entity.name, entityId: entity.id }
                : { name: "Figure" },
            )
          }
          onAddProp={(type) => addObject(type)}
          onAddLight={(role) =>
            addObject("light", {
              lightRole: role,
              name: undefined,
            })
          }
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className={cn(
              "grid min-h-0 flex-1 gap-px bg-zinc-800",
              maximize === "split"
                ? "grid-cols-1 md:grid-cols-2"
                : "grid-cols-1",
            )}
          >
            <div
              ref={shotStageRef}
              className={cn(
                "relative flex items-center justify-center bg-zinc-950",
                maximize === "director" && "hidden",
              )}
            >
              <div className="relative">
                <canvas ref={shotCanvasRef} className="block" />
                <canvas
                  ref={hudCanvasRef}
                  className="pointer-events-none absolute inset-0"
                />
              </div>
              <span className="absolute left-2 top-2 text-[10px] uppercase tracking-wide text-zinc-500">
                Camera
              </span>
            </div>
            <div
              ref={dirStageRef}
              className={cn(
                "relative bg-zinc-950",
                maximize === "shot" && "hidden",
              )}
            >
              <canvas ref={dirCanvasRef} className="block h-full w-full" />
              <span className="absolute left-2 top-2 text-[10px] uppercase tracking-wide text-zinc-500">
                Director
              </span>
              <div className="absolute right-2 top-2 flex gap-1">
                <button
                  type="button"
                  className={cn(
                    "border px-1.5 py-0.5 text-[10px]",
                    passMode === "clay"
                      ? "border-zinc-500 text-zinc-200"
                      : "border-zinc-800 text-zinc-500",
                  )}
                  onClick={() => setPassMode("clay")}
                >
                  Clay
                </button>
                <button
                  type="button"
                  className={cn(
                    "border px-1.5 py-0.5 text-[10px]",
                    passMode === "depth"
                      ? "border-zinc-500 text-zinc-200"
                      : "border-zinc-800 text-zinc-500",
                  )}
                  onClick={() => setPassMode("depth")}
                >
                  Depth
                </button>
              </div>
            </div>
          </div>

          <EditorTimeline
            doc={doc}
            frame={frame}
            playing={playing}
            selectedKey={selectedKey}
            onFrame={(f) => {
              setPlaying(false);
              setCameraDirty(false);
              setFrame(f);
            }}
            onTogglePlay={() => setPlaying((p) => !p)}
            onSelectKey={setSelectedKey}
          />

          <p className="shrink-0 border-t border-zinc-800 px-3 py-1 text-[11px] text-zinc-500">
            Click an object to select it. W / E / R move, rotate, scale. Space
            plays, K sets a key.
            {status ? ` · ${status}` : ""}
          </p>
        </div>

        <fieldset disabled={canWrite === false} className="contents">
          <EditorInspector
            doc={doc}
            live={live}
            cameraDirty={cameraDirty}
            selectedObject={selectedObject}
            selectedKey={selectedKey}
            exportBurnIn={exportBurnIn}
            exportMode={exportMode}
            exportRange={exportRange}
            onLiveChange={onLiveChange}
            onSensorChange={(sensor) => {
              pushUndo();
              commitDoc(
                { ...doc, camera: { ...doc.camera, sensor } },
                { undo: false },
              );
            }}
            onTimingChange={(opts) => {
              pushUndo();
              commitDoc(updateShotTiming(doc, opts), { undo: false });
            }}
            onPreset={(id: CameraMovePresetId) => {
              pushUndo();
              const next = applyPresetToDoc(doc, id, live);
              commitDoc(next, { undo: false });
              setCameraDirty(false);
              setStatus(
                `${CAMERA_MOVE_PRESETS.find((p) => p[0] === id)?.[1] ?? id}`,
              );
            }}
            onKeyEase={(ease: BlockoutEase) => {
              if (!selectedKey) return;
              pushUndo();
              commitDoc(updateKeyEase(doc, selectedKey, ease), { undo: false });
            }}
            onKeyFrame={(f) => {
              if (!selectedKey || !doc) return;
              pushUndo();
              if (selectedKey.kind === "cam") {
                commitDoc(
                  {
                    ...doc,
                    camera: {
                      ...doc.camera,
                      keys: doc.camera.keys.map((k) =>
                        k.id === selectedKey.id ? { ...k, f } : k,
                      ),
                    },
                  },
                  { undo: false },
                );
              } else {
                commitDoc(
                  {
                    ...doc,
                    objects: doc.objects.map((o) =>
                      o.id !== selectedKey.objectId
                        ? o
                        : {
                            ...o,
                            keys: o.keys.map((k) =>
                              k.f === selectedKey.f ? { ...k, f } : k,
                            ),
                          },
                    ),
                  },
                  { undo: false },
                );
                setSelectedKey({
                  kind: "obj",
                  objectId: selectedKey.objectId,
                  f,
                });
              }
            }}
            onKeyFocal={(focal) => {
              if (!selectedKey || selectedKey.kind !== "cam") return;
              pushUndo();
              commitDoc(
                {
                  ...doc,
                  camera: {
                    ...doc.camera,
                    keys: doc.camera.keys.map((k) =>
                      k.id === selectedKey.id ? { ...k, focal } : k,
                    ),
                  },
                },
                { undo: false },
              );
            }}
            onDeleteKey={() => {
              if (!selectedKey || !doc) return;
              pushUndo();
              if (selectedKey.kind === "cam") {
                commitDoc(deleteCameraKey(doc, selectedKey.id), {
                  undo: false,
                });
              } else {
                commitDoc(
                  {
                    ...doc,
                    objects: doc.objects.map((o) =>
                      o.id !== selectedKey.objectId
                        ? o
                        : deleteObjectKey(o, selectedKey.f),
                    ),
                  },
                  { undo: false },
                );
              }
              setSelectedKey(null);
            }}
            onObjectField={(patch: Partial<BlockoutObject>) => {
              if (!selectedId) return;
              pushUndo();
              commitDoc(
                {
                  ...doc,
                  objects: doc.objects.map((o) =>
                    o.id === selectedId ? { ...o, ...patch } : o,
                  ),
                },
                { undo: false },
              );
            }}
            onExportBurnIn={setExportBurnIn}
            onExportMode={(m) => {
              setExportMode(m);
              setPassMode(m);
            }}
            onExportRange={setExportRange}
            onExport={() => void onExportMp4()}
            exporting={busy === "export"}
          />
        </fieldset>
      </div>

      {importOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col border border-zinc-700 bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
              <p className="text-xs text-zinc-300">Import blockout JSON</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setImportOpen(false)}
              >
                Close
              </Button>
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="min-h-0 flex-1 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 outline-none"
              spellCheck={false}
            />
            <div className="flex justify-end gap-2 border-t border-zinc-800 p-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = ".json,application/json";
                  input.onchange = () => {
                    const f = input.files?.[0];
                    if (!f) return;
                    void f.text().then(setImportText);
                  };
                  input.click();
                }}
              >
                Open file…
              </Button>
              <Button type="button" size="sm" onClick={onImportApply}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// silence unused helpers kept for future selection keying
void keyObjectAtFrame;
