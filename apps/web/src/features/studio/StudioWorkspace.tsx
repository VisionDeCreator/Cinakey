import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/use-confirm";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { BlockoutPage } from "@/features/blockout/BlockoutPage";
import { resolveMediaDuration } from "@/features/edit/insertMedia";
import { beginMediaPointerDrag } from "@/features/edit/mediaDrag";
import { useAction, useMutation, useQuery } from "@/lib/api/hooks";
import { api } from "@cinakey/backend";
import {
  COST_CONFIRM_THRESHOLD_CREDITS,
  type TimelineClip,
} from "@cinakey/shared";
import { Film, Image, Link2, Music, Plus, Star, Upload } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { MediaPreview } from "./MediaPreview";
import "./studio.css";
import { StudioScript } from "./StudioScript";

export type StudioInsert = {
  assetId: string;
  type: string;
  durationSec: number;
  inSec: number;
  outSec: number;
  startSec?: number;
  trackId?: string;
};
export function StudioWorkspace({
  toolbar,
  viewer,
  timeline,
  inspector,
  selectedClip,
  hasTimelineClips = false,
  onInsert,
  onInsertMany,
  onPreview,
}: {
  toolbar: ReactNode;
  viewer: ReactNode;
  timeline: ReactNode;
  inspector: ReactNode;
  selectedClip: TimelineClip | null;
  hasTimelineClips?: boolean;
  onInsert: (media: StudioInsert) => void;
  onInsertMany?: (media: StudioInsert[]) => void;
  onPreview: () => void;
}) {
  const { projectId = "" } = useParams();
  const workspace = useQuery(api.workspace.list, {
    projectId: projectId as never,
  });
  const ensure = useAction(api.workspace.ensure);
  const [migrationAttempt, setMigrationAttempt] = useState(0);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ensure({ projectId: projectId as never }).catch((error) => {
      if (!cancelled)
        setMigrationError(
          error instanceof Error ? error.message : "Project migration failed",
        );
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, ensure, migrationAttempt]);
  const [durationSec, setDurationSec] = useState(5);
  const [workspaceParams, setWorkspaceParams] = useSearchParams();
  const staging =
    workspace?.staging.find(
      (item) => item._id === workspaceParams.get("staging"),
    ) ?? workspace?.staging[0];
  const assets = useQuery(api.assets.list, { projectId: projectId as never });
  const urls = useQuery(api.storage.listProjectAssetUrls, {
    projectId: projectId as never,
  });
  const footage = useQuery(api.workspace.videos, {
    projectId: projectId as never,
  });
  const spend = useQuery(api.workspace.spend, {
    projectId: projectId as never,
  });
  const bindings = useQuery(api.references.list, {
    projectId: projectId as never,
  });
  const generate = useAction(api.workspace.generate);
  const extend = useAction(api.generation.startGeneration);
  const rename = useMutation(api.assets.update);
  const star = useMutation(api.assets.setStarred);
  const confirm = useConfirm();
  const { uploadFiles, uploads } = useAssetUpload(projectId);
  const [assemblyIds, setAssemblyIds] = useState<string[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const compareRef = useRef<HTMLDivElement>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [view, setView] = useState<"source" | "edit" | "staging" | "compare">(
    "edit",
  );
  const [library, setLibrary] = useState<"references" | "media">("media");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolution, setResolution] = useState("1080p");
  const [useStaging, setUseStaging] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [referencesValid, setReferencesValid] = useState(false);
  const [mediaDurations, setMediaDurations] = useState<Record<string, number>>(
    {},
  );
  const [inSec, setInSec] = useState(0);
  const [outSec, setOutSec] = useState(0);
  const [inspectorView, setInspectorView] = useState<"script" | "clip">(
    "script",
  );
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() => {
    const defaults = {
      left: 210,
      right: 310,
      bottom: 280,
      library: true,
      inspector: true,
      timeline: true,
      generations: true,
    };
    try {
      const saved = JSON.parse(
        localStorage.getItem("cinakey:workspace-layout:2") ?? "null",
      );
      if (!saved) return defaults;
      return {
        ...defaults,
        left: Math.max(150, Math.min(420, Number(saved.left) || defaults.left)),
        right: Math.max(
          240,
          Math.min(480, Number(saved.right) || defaults.right),
        ),
        bottom: Math.max(
          160,
          Math.min(600, Number(saved.bottom) || defaults.bottom),
        ),
        ...Object.fromEntries(
          ["library", "inspector", "timeline", "generations"].map((key) => [
            key,
            typeof saved[key] === "boolean" ? saved[key] : true,
          ]),
        ),
      };
    } catch {
      return defaults;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "cinakey:workspace-layout:2",
        JSON.stringify(layout),
      );
    } catch {
      /* optional preference */
    }
  }, [layout]);
  function resizePanel(
    panel: "left" | "right" | "bottom",
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const start = panel === "bottom" ? event.clientY : event.clientX;
    const initial = layout[panel];
    const move = (e: PointerEvent) => {
      const delta = (panel === "bottom" ? e.clientY : e.clientX) - start;
      const bounds = workspaceRef.current?.getBoundingClientRect();
      const maximum =
        panel === "bottom"
          ? Math.max(160, (bounds?.height ?? 800) - 170)
          : Math.max(
              panel === "left" ? 150 : 240,
              (bounds?.width ?? 1200) * 0.35,
            );
      const value = Math.max(
        panel === "bottom" ? 160 : panel === "left" ? 150 : 240,
        Math.min(maximum, initial + delta * (panel === "left" ? 1 : -1)),
      );
      setLayout((old) => ({ ...old, [panel]: value }));
    };
    const end = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("lostpointercapture", end);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("lostpointercapture", end, { once: true });
  }
  function divider(panel: "left" | "right" | "bottom") {
    return (
      <div
        className={`studio-divider studio-divider-${panel}`}
        role="separator"
        tabIndex={0}
        aria-label={`Resize ${panel === "left" ? "library" : panel === "right" ? "inspector" : "timeline"}`}
        aria-orientation={panel === "bottom" ? "horizontal" : "vertical"}
        aria-valuemin={panel === "left" ? 150 : panel === "right" ? 240 : 160}
        aria-valuemax={1200}
        aria-valuenow={Math.round(layout[panel])}
        onPointerDown={(event) => resizePanel(panel, event)}
        onDoubleClick={() =>
          setLayout((old) => ({
            ...old,
            [panel]: panel === "left" ? 210 : panel === "right" ? 310 : 280,
          }))
        }
        onKeyDown={(event) => {
          if (
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          const delta = ["ArrowRight", "ArrowDown"].includes(event.key)
            ? 20
            : -20;
          setLayout((old) => ({
            ...old,
            [panel]: Math.max(
              panel === "left" ? 150 : panel === "right" ? 240 : 160,
              Math.min(600, old[panel] + delta * (panel === "left" ? 1 : -1)),
            ),
          }));
        }}
      />
    );
  }
  const scriptSave = useRef<(() => Promise<boolean>) | null>(null);
  const dirtyChanged = useCallback((value: boolean) => setDirty(value), []);
  const estimate = useQuery(api.generation.estimateCost, {
    adapterId: "seedance-2.5",
    kind: "text-to-video",
    input: {
      durationSec,
      resolution,
      prompt: "video",
    },
  });
  const videos = useMemo(() => footage?.videos ?? [], [footage]);
  const source = assets?.find((a) => a._id === sourceId);
  const sourceVideo = videos.find((a) => a.assetId === sourceId);
  const sourceDuration = sourceId
    ? (mediaDurations[sourceId] ?? source?.durationSec)
    : undefined;
  const sourceUrl =
    sourceVideo?.url ?? urls?.find((u) => u.assetId === sourceId)?.url ?? null;
  const jobs = footage?.jobs ?? [];
  const running = jobs.some((j) =>
    ["queued", "submitted", "running"].includes(j.status),
  );
  const scopedVideos = videos;
  const initialSourceSelected = useRef<string | null>(null);
  useEffect(() => {
    // Restore a project with footage but no script directly into a useful viewer.
    if (
      !sourceId &&
      !hasTimelineClips &&
      videos[0] &&
      !selectedClip &&
      initialSourceSelected.current !== projectId
    ) {
      initialSourceSelected.current = projectId;
      setSourceId(videos[0].assetId);
      setInSec(0);
      setOutSec(videos[0].durationSec ?? 0);
      setView("source");
    }
  }, [videos, sourceId, selectedClip, projectId, hasTimelineClips]);
  const selectedId = selectedClip?.id ?? null;
  const [lastSelection, setLastSelection] = useState(selectedId);
  if (lastSelection !== selectedId) {
    setLastSelection(selectedId);
    if (selectedId) {
      setView("edit");
      setInspectorView("clip");
    }
  }
  async function preview(id: string) {
    const asset = assets?.find((a) => a._id === id);
    setSourceId(id);
    setInSec(0);
    setOutSec(
      mediaDurations[id] ??
        asset?.durationSec ??
        (asset?.type === "image" ? 3 : 0),
    );
    setView("source");
    onPreview();
  }
  function toggleCompare(id: string) {
    const next = compareIds.includes(id)
      ? compareIds.filter((v) => v !== id)
      : [...compareIds.slice(-1), id];
    setCompareIds(next);
    if (next.length === 2) {
      setView("compare");
      onPreview();
    } else if (view === "compare") setView("source");
  }
  async function extendSource() {
    if (!sourceVideo || busy) return;
    if (
      !(await confirm({
        title: "Generate a 5-second extension?",
        description:
          "Approximately 10 credits. The original video and current edit are preserved.",
        confirmLabel: "Generate extension",
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await extend({
        projectId: projectId as never,
        adapterId: "seedance-2.5",
        kind: "extend",
        prompt: "Continue the motion seamlessly.",
        parentAssetIds: [sourceVideo.assetId],
        input: { durationSec: 5 },
      });
      setNotice("Extension started. It will appear as another generation.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not extend video");
    } finally {
      setBusy(false);
    }
  }
  const credits = estimate?.credits ?? 0;
  const overCap = spend?.remaining != null && credits > spend.remaining;
  const validDuration =
    Number.isInteger(durationSec) && durationSec >= 4 && durationSec <= 30;
  async function startGeneration() {
    if (busy || running || !validDuration || overCap) return;
    if (scriptSave.current && !(await scriptSave.current())) return;
    if (
      credits >= COST_CONFIRM_THRESHOLD_CREDITS &&
      !(await confirm({
        title: "Generate video?",
        description: `Approximately ${credits} credits. Previous footage and timeline edits are preserved.`,
        confirmLabel: "Generate",
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await generate({
        projectId: projectId as never,
        durationSec,
        resolution,
        stagingId:
          useStaging && staging?.previzAssetId ? staging._id : undefined,
      });
      setNotice("Generation started. You can keep editing while it runs.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start generation");
    } finally {
      setBusy(false);
    }
  }
  async function insertSelected() {
    if (!onInsertMany || busy) return;
    setBusy(true);
    setError(null);
    try {
      const selected: StudioInsert[] = [];
      for (const id of assemblyIds) {
        const asset = assets?.find((asset) => asset._id === id);
        if (!asset) continue;
        const duration =
          mediaDurations[id] ??
          asset.durationSec ??
          (await resolveMediaDuration(
            videos.find((video) => video.assetId === id)?.url ?? "",
            "video",
          ));
        selected.push({
          assetId: id,
          type: "video",
          durationSec: duration,
          inSec: 0,
          outSec: duration,
        });
      }
      onInsertMany(selected);
      setNotice("Selected videos inserted in selection order.");
      setAssemblyIds([]);
      setView("edit");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not insert selected videos",
      );
    } finally {
      setBusy(false);
    }
  }
  function insert() {
    if (
      !source ||
      !Number.isFinite(inSec) ||
      !Number.isFinite(outSec) ||
      inSec < 0 ||
      outSec <= inSec ||
      (sourceDuration != null && outSec > sourceDuration + 0.01)
    ) {
      setError("Choose a source range within the clip duration.");
      return;
    }
    onInsert({
      assetId: source._id,
      type: source.type,
      durationSec: outSec - inSec,
      inSec,
      outSec,
    });
    setNotice(`${source.name} added to the timeline. The source is preserved.`);
    setView("edit");
  }
  const media = (assets ?? []).filter((a) =>
    ["video", "image", "audio", "music"].includes(a.type),
  );
  const libraryAssets =
    library === "references"
      ? media.filter(
          (a) =>
            a.type === "image" ||
            (a.type === "video" && bindings?.some((b) => b.assetId === a._id)),
        )
      : media;
  return (
    <div
      ref={workspaceRef}
      className="studio-workspace"
      style={
        {
          "--library-width": layout.library ? `${layout.left}px` : "0px",
          "--inspector-width": layout.inspector ? `${layout.right}px` : "0px",
          "--timeline-height": layout.timeline ? `${layout.bottom}px` : "0px",
        } as CSSProperties
      }
    >
      <nav className="studio-layout-controls" aria-label="Workspace panels">
        {(["library", "inspector", "generations", "timeline"] as const).map(
          (panel) => (
            <button
              key={panel}
              aria-pressed={layout[panel]}
              onClick={() =>
                setLayout((old) => ({ ...old, [panel]: !old[panel] }))
              }
            >
              {panel.charAt(0).toUpperCase() + panel.slice(1)}
            </button>
          ),
        )}
        <button
          onClick={() =>
            setLayout({
              left: 210,
              right: 310,
              bottom: 280,
              library: true,
              inspector: true,
              timeline: true,
              generations: true,
            })
          }
        >
          Reset layout
        </button>
      </nav>
      <aside
        hidden={!layout.library}
        className="studio-library"
        aria-label="Project library"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={async (event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          try {
            await uploadFiles(Array.from(event.dataTransfer.files));
            setLibrary("media");
          } catch (error) {
            setError(error instanceof Error ? error.message : "Upload failed");
          }
        }}
      >
        {divider("left")}
        <div className="studio-section-heading">
          <h2>Project media</h2>
        </div>
        {migrationError && (
          <p role="alert">
            {migrationError}
            <Button
              onClick={() => {
                setMigrationError(null);
                setMigrationAttempt((value) => value + 1);
              }}
            >
              Retry migration
            </Button>
          </p>
        )}
        <div className="studio-library-tabs">
          <button
            aria-pressed={library === "references"}
            onClick={() => setLibrary("references")}
          >
            References
          </button>
          <button
            aria-pressed={library === "media"}
            onClick={() => setLibrary("media")}
          >
            All media
          </button>
        </div>
        <div className="studio-assets">
          {libraryAssets.map((asset) => (
            <button
              key={asset._id}
              className={`studio-asset ${sourceId === asset._id ? "selected" : ""}`}
              draggable={false}
              data-media-draggable
              onDragStart={(event) => event.preventDefault()}
              onPointerDown={(event) => beginMediaPointerDrag(event, asset._id)}
              title="Drag to a timeline track, or click to preview"
              onClick={() => preview(asset._id)}
            >
              <span className="studio-asset-icon">
                {asset.type === "image" ? (
                  <Image />
                ) : asset.type === "video" ? (
                  <Film />
                ) : (
                  <Music />
                )}
              </span>
              <span>
                <strong>{asset.name}</strong>
                <small>
                  {bindings?.find((b) => b.assetId === asset._id)
                    ? `@${bindings.find((b) => b.assetId === asset._id)?.alias}`
                    : asset.type}
                </small>
              </span>
            </button>
          ))}
        </div>
        <label className="studio-upload-label">
          <Upload size={15} />
          Import media
          <input
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            onChange={async (e) => {
              if (e.target.files) {
                try {
                  await uploadFiles(e.target.files);
                  setLibrary("media");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Upload failed");
                }
              }
              e.target.value = "";
            }}
          />
        </label>
        <label className="studio-upload-label">
          <Music size={15} />
          Import music
          <input
            type="file"
            accept="audio/*"
            multiple
            onChange={async (e) => {
              if (e.target.files) {
                try {
                  await uploadFiles(e.target.files, { type: "music" });
                  setLibrary("media");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Upload failed");
                }
              }
              e.target.value = "";
            }}
          />
        </label>
        {uploads
          .filter((u) => u.status !== "done")
          .map((u) => (
            <p
              key={u.id}
              className={u.status === "error" ? "studio-error" : "studio-muted"}
            >
              {u.name}: {u.error ?? `${u.progress}%`}
            </p>
          ))}
      </aside>
      <div className="studio-center">
        <section className="studio-viewer" aria-label="Media viewer">
          <div className="studio-section-heading">
            <div>
              <h2>
                {view === "source"
                  ? (source?.name ?? "Viewer")
                  : view === "staging"
                    ? "Staging"
                    : "Timeline preview"}
              </h2>
              <span className="studio-muted">
                {view === "source"
                  ? "Source preview · your edit is unchanged"
                  : "Connected project workspace"}
              </span>
            </div>
            <div className="studio-view-switch">
              <button
                aria-pressed={view === "source"}
                onClick={() => {
                  setView("source");
                  onPreview();
                }}
              >
                Source
              </button>
              <button
                aria-pressed={view === "edit"}
                onClick={() => setView("edit")}
              >
                Edit
              </button>
              <button
                aria-pressed={view === "staging"}
                onClick={() => {
                  setView("staging");
                  onPreview();
                }}
              >
                Staging
              </button>
            </div>
          </div>
          {view === "compare" && (
            <div className="studio-compare-toolbar">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  for (const video of compareRef.current?.querySelectorAll(
                    "video",
                  ) ?? []) {
                    video.currentTime = 0;
                    void video
                      .play()
                      .catch(() =>
                        setError(
                          "Use each video's play control to start playback.",
                        ),
                      );
                  }
                }}
              >
                Play both from start
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCompareIds([]);
                  setView("source");
                }}
              >
                Close comparison
              </Button>
            </div>
          )}
          <div
            className={`studio-preview-content ${view === "staging" ? "studio-preview-staging" : ""}`}
          >
            {view === "compare" && (
              <div ref={compareRef} className="studio-compare">
                {compareIds.map((id) => {
                  const video = videos.find((v) => v.assetId === id);
                  return video ? (
                    <div key={id} className="studio-compare-item">
                      <MediaPreview url={video.url} name={video.name} />
                      <span>{video.name}</span>
                    </div>
                  ) : null;
                })}
              </div>
            )}
            <div hidden={view !== "edit"} className="studio-edit-preview">
              {viewer}
            </div>
            {view === "source" &&
              (source ? (
                <MediaPreview
                  url={sourceUrl}
                  name={source.name}
                  type={source.type}
                  onDuration={(duration) => {
                    setMediaDurations((old) =>
                      old[source._id] === duration
                        ? old
                        : { ...old, [source._id]: duration },
                    );
                    setOutSec((old) =>
                      Number(Math.min(old || duration, duration).toFixed(3)),
                    );
                  }}
                />
              ) : (
                <div className="studio-empty-view">
                  <Film size={32} />
                  <h2>Your story starts here</h2>
                  <p>
                    Preview any generation or imported asset, then add the range
                    you want to your edit.
                  </p>
                </div>
              ))}
            {view === "staging" && (
              <div className="studio-staging-panel">
                <BlockoutPage />
              </div>
            )}
          </div>
          {view === "source" && source && (
            <div className="studio-source-toolbar">
              <label>
                Name
                <input
                  key={source._id + source.name}
                  defaultValue={source.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== source.name)
                      void rename({ assetId: source._id, name }).catch(
                        (e: Error) => setError(e.message),
                      );
                  }}
                />
              </label>
              <label>
                In (s)
                <input
                  aria-label="Source in"
                  type="number"
                  min={0}
                  step={0.1}
                  value={inSec}
                  onChange={(e) => setInSec(Number(e.target.value))}
                />
              </label>
              <label>
                Out (s)
                <input
                  aria-label="Source out"
                  type="number"
                  min={0}
                  max={sourceDuration ?? undefined}
                  step={0.1}
                  value={outSec}
                  onChange={(e) => setOutSec(Number(e.target.value))}
                />
              </label>
              <Button
                size="sm"
                disabled={source.type !== "image" && !sourceDuration}
                onClick={insert}
              >
                <Plus />
                Add to timeline
              </Button>
              {sourceUrl && (
                <a
                  className="studio-download"
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open source ↗
                </a>
              )}
              {sourceVideo && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void extendSource()}
                >
                  Extend +5s · ~10 cr
                </Button>
              )}
            </div>
          )}
        </section>
        <section
          hidden={!layout.generations}
          className="studio-generations"
          aria-label="Generation history"
        >
          <div className="studio-section-heading">
            <h2>
              Generations{" "}
              <span className="studio-muted">{scopedVideos.length}</span>
            </h2>
          </div>
          {onInsertMany && (
            <Button
              size="sm"
              variant="outline"
              disabled={!assemblyIds.length || busy}
              onClick={() => void insertSelected()}
            >
              Add selected videos ({assemblyIds.length})
            </Button>
          )}
          <div className="studio-generation-strip">
            {scopedVideos.map((video, index) => (
              <div
                key={video.assetId}
                className={`studio-generation ${sourceId === video.assetId ? "selected" : ""}`}
                draggable={false}
                data-media-draggable
                onDragStart={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  if (
                    !(event.target as HTMLElement).closest(
                      ".studio-compare-button, .studio-favourite, input, label",
                    )
                  )
                    beginMediaPointerDrag(event, video.assetId);
                }}
              >
                <button
                  className="studio-generation-preview"
                  onClick={() => preview(video.assetId)}
                  aria-label={`Preview ${video.name}`}
                >
                  {video.url ? (
                    <video
                      src={video.url}
                      muted
                      playsInline
                      preload="metadata"
                      aria-hidden
                    />
                  ) : (
                    <Film />
                  )}
                  <strong>
                    {video.generated
                      ? `Video ${String(scopedVideos.length - index).padStart(2, "0")}`
                      : video.name}
                  </strong>
                  <small>
                    {video.durationSec ?? mediaDurations[video.assetId] ?? "?"}s
                    · {video.generated ? "Generated" : "Imported"}
                  </small>
                </button>
                {onInsertMany && (
                  <label className="studio-check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${video.name} for editing`}
                      checked={assemblyIds.includes(video.assetId)}
                      onChange={(event) =>
                        setAssemblyIds((ids) =>
                          event.target.checked
                            ? [...ids, video.assetId]
                            : ids.filter((id) => id !== video.assetId),
                        )
                      }
                    />
                    Add to edit
                    {assemblyIds.includes(video.assetId)
                      ? ` · ${assemblyIds.indexOf(video.assetId) + 1}`
                      : ""}
                  </label>
                )}
                <button
                  className="studio-compare-button"
                  aria-pressed={compareIds.includes(video.assetId)}
                  onClick={() => toggleCompare(video.assetId)}
                >
                  Compare
                </button>
                <button
                  className="studio-favourite"
                  aria-label={`${video.starred ? "Unfavourite" : "Favourite"} ${video.name}`}
                  aria-pressed={video.starred}
                  onClick={() =>
                    void star({
                      assetId: video.assetId,
                      starred: !video.starred,
                    }).catch((e: Error) => setError(e.message))
                  }
                >
                  <Star
                    size={14}
                    fill={video.starred ? "currentColor" : "none"}
                  />
                </button>
              </div>
            ))}
            {footage && scopedVideos.length === 0 && (
              <p className="studio-muted">
                No footage yet. Generate a video or import a video.
              </p>
            )}
          </div>
          {jobs
            .filter((j) => j.status !== "succeeded")
            .slice(0, 4)
            .map((job) => (
              <p
                key={job.jobId}
                className={
                  ["failed", "refunded"].includes(job.status)
                    ? "studio-error"
                    : "studio-muted"
                }
              >
                {job.submissionState === "uncertain"
                  ? "Submission needs review. Credits remain reserved; do not resubmit."
                  : `${job.status} · ${job.estimatedCostCredits} credits`}{" "}
                · {new Date(job.createdAt).toLocaleString()}
                {job.errorMessage && (
                  <span className="block">{job.errorMessage}</span>
                )}
                {job.status === "refunded" && (
                  <span className="block">
                    Credits refunded. Your existing media and edit are
                    preserved.
                  </span>
                )}
              </p>
            ))}
        </section>
        {notice && (
          <p className="studio-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="studio-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <aside
        hidden={!layout.inspector}
        className="studio-inspector"
        aria-label="Script and clip inspector"
      >
        {divider("right")}
        <div className="studio-inspector-tabs">
          <button
            aria-pressed={inspectorView === "script"}
            onClick={() => setInspectorView("script")}
          >
            <Link2 size={14} />
            Script & generation
          </button>
          <button
            aria-pressed={inspectorView === "clip"}
            onClick={() => setInspectorView("clip")}
          >
            Clip settings
          </button>
        </div>
        <div hidden={inspectorView !== "script"}>
          <StudioScript
            projectId={projectId}
            onDirty={dirtyChanged}
            onValidityChange={setReferencesValid}
            saveRef={scriptSave}
          />
          <section className="studio-generation-settings">
            <h2>Generation</h2>
            <label>
              Model<span>Seedance 2.5</span>
            </label>
            <label>
              Resolution
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              >
                <option>720p</option>
                <option>1080p</option>
              </select>
            </label>
            <label>
              Duration (seconds)
              <input
                aria-label="Generation duration"
                type="number"
                min={4}
                max={30}
                value={durationSec}
                onChange={(event) => setDurationSec(Number(event.target.value))}
              />
            </label>
            {workspace && workspace.staging.length > 0 && (
              <label>
                Staging
                <select
                  aria-label="Generation staging"
                  value={staging?._id ?? ""}
                  onChange={(event) => {
                    const id = event.target.value;
                    setUseStaging(false);
                    setWorkspaceParams(
                      (old) => {
                        const next = new URLSearchParams(old);
                        next.set("staging", id);
                        return next;
                      },
                      { replace: true },
                    );
                  }}
                >
                  {workspace.staging.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {staging?.previzAssetId && (
              <label className="studio-check">
                <input
                  type="checkbox"
                  checked={useStaging}
                  onChange={(event) => setUseStaging(event.target.checked)}
                />
                Use staging as video reference
              </label>
            )}
            <Button
              className="w-full"
              disabled={
                busy ||
                running ||
                !validDuration ||
                !credits ||
                overCap ||
                dirty ||
                !referencesValid
              }
              onClick={() => void startGeneration()}
            >
              {busy
                ? "Starting…"
                : running
                  ? "Generating…"
                  : `Generate video · ${credits} cr`}
            </Button>
            <p className="studio-muted">
              {dirty
                ? "Save the script before generating."
                : !referencesValid
                  ? "Link unresolved or ambiguous references before generating."
                  : overCap
                    ? "Project spend cap reached."
                    : !validDuration
                      ? "Use a whole-number duration of 4–30 seconds per video."
                      : "Previous videos and timeline edits are preserved."}
            </p>
          </section>
        </div>
        <div hidden={inspectorView !== "clip"}>{inspector}</div>
      </aside>
      <section
        hidden={!layout.timeline}
        className="studio-timeline"
        aria-label="Project timeline"
        onDropCapture={() => setView("edit")}
        onPointerDownCapture={() => setView("edit")}
        onClickCapture={(e) => {
          const button = (e.target as HTMLElement).closest("button");
          if (button?.textContent?.trim() === "Play") setView("edit");
        }}
      >
        {divider("bottom")}
        {toolbar}
        {timeline}
      </section>
    </div>
  );
}
