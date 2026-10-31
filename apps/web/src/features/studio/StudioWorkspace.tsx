import { useGenerationSettings } from "./useGenerationSettings";
import { getLocale } from "@dirrio/ui/i18n";
import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import {
  useWorkspace,
  useDraftScope,
} from "@/features/workspaces/workspace-context";
import { formatUsd } from "@dirrio/ui/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/use-confirm";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { BlockoutPage } from "@/features/blockout/BlockoutPage";
import { resolveMediaDuration } from "@/features/edit/insertMedia";
import { beginMediaPointerDrag } from "@/features/edit/mediaDrag";
import { useAction, useMutation, useQuery } from "@/lib/api/hooks";
import { api } from "@dirrio/backend";
import {
  COST_CONFIRM_THRESHOLD_USD_MICROS,
  type TimelineClip,
} from "@dirrio/shared";
import {
  Film,
  Link2,
  Music,
  Plus,
  Star,
  Upload,
  Search,
  Maximize,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
  Archive,
  Trash2,
} from "lucide-react";
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
import { MediaThumbnail, ReferenceMedia } from "./ReferenceMedia";
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
function segmentTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function StudioWorkspace({
  toolbar,
  viewer,
  previewTransport,
  timeline,
  inspector,
  selectedClip,
  hasTimelineClips = false,
  readOnly = false,
  onInsert,
  onInsertMany,
  onPreview,
}: {
  toolbar: ReactNode;
  viewer: ReactNode;
  previewTransport?: ReactNode;
  timeline: ReactNode;
  inspector: ReactNode;
  selectedClip: TimelineClip | null;
  hasTimelineClips?: boolean;
  readOnly?: boolean;
  onInsert: (media: StudioInsert) => boolean | void;
  onInsertMany?: (media: StudioInsert[]) => boolean | void;
  onPreview: () => void;
}) {
  useLocale();
  const { canWrite } = useWorkspace();
  const draftScope = useDraftScope();
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
          error instanceof Error ? error.message : "Workspace setup failed",
        );
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, ensure, migrationAttempt]);
  const [workspaceParams, setWorkspaceParams] = useSearchParams();
  const segments = workspace?.segments ?? [];
  const selectedSegment =
    segments.find((s) => s._id === workspaceParams.get("segment")) ??
    segments[0];
  const preferences = useGenerationSettings(projectId, selectedSegment?._id);
  const { resolution, durationSec, aspectRatio } = preferences.settings;
  const createSegment = useMutation(api.workspace.createSegment);
  const deleteSegment = useMutation(api.workspace.deleteSegment);
  const restoreSegment = useMutation(api.workspace.restoreSegment);
  const archivedSegments = workspace?.archivedSegments ?? [];
  const updateSegment = useMutation(api.workspace.updateSegment);
  const reorderSegments = useMutation(api.workspace.reorderSegments);
  const scriptVersion = useRef<string | undefined>(undefined);
  const segmentStaging =
    workspace?.staging.filter(
      (s) => !s.segmentId || s.segmentId === selectedSegment?._id,
    ) ?? [];
  const staging =
    segmentStaging.find(
      (item) =>
        item._id ===
        (workspaceParams.get("staging") ?? preferences.settings.stagingId),
    ) ?? segmentStaging[0];
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
  const extensionEstimate = useQuery(api.generation.estimateCost, {
    adapterId: "seedance-2.5",
    kind: "extend",
    input: { durationSec: 5, resolution: "720p" },
  });
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
  const importInput = useRef<HTMLInputElement>(null);
  const previewContainer = useRef<HTMLDivElement>(null);
  const [mediaSearch, setMediaSearch] = useState("");
  const [mediaType, setMediaType] = useState("all");
  const [library, setLibrary] = useState<"references" | "media">("media");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { loaded: preferencesLoaded, update: updatePreferences } = preferences;
  const savedStagingId = preferences.settings.stagingId;
  const savedUseStaging = preferences.settings.useStaging;
  const useStaging =
    savedUseStaging &&
    savedStagingId === staging?._id &&
    Boolean(staging?.previzAssetId);
  const linkedStagingId = workspaceParams.get("staging");
  const linkedStaging = workspace?.staging.find(
    (item) => item._id === linkedStagingId,
  );
  const linkedReference = workspaceParams.get("stagingReference") === "1";
  const appliedStagingLink = useRef<string | null>(null);
  useEffect(() => {
    if (!preferencesLoaded || canWrite === false || workspace === undefined)
      return;
    const linkKey = `${projectId}:${linkedStagingId}:${linkedReference}`;
    if (appliedStagingLink.current === linkKey) return;
    appliedStagingLink.current = linkKey;
    if (!linkedStaging || !linkedReference || !linkedStaging.previzAssetId)
      return;
    if (savedStagingId !== linkedStaging._id || !savedUseStaging)
      updatePreferences({ stagingId: linkedStaging._id, useStaging: true });
  }, [
    preferencesLoaded,
    updatePreferences,
    savedStagingId,
    savedUseStaging,
    canWrite,
    linkedStaging,
    linkedReference,
    linkedStagingId,
    projectId,
    workspace,
  ]);
  const [dirty, setDirty] = useState(false);
  const [referencesValid, setReferencesValid] = useState(false);
  const [mediaDurations, setMediaDurations] = useState<Record<string, number>>(
    {},
  );
  const [inSec, setInSec] = useState(0);
  const [outSec, setOutSec] = useState(0);
  const [inspectorView, setInspectorView] = useState<
    "script" | "generation" | "clip"
  >("script");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() => {
    const defaults = {
      left: 330,
      right: 310,
      bottom: 280,
      library: true,
      inspector: true,
      timeline: true,
      generations: true,
    };
    try {
      const saved = JSON.parse(
        localStorage.getItem("dirrio:workspace-layout:2") ?? "null",
      );
      if (!saved) return defaults;
      return {
        ...defaults,
        left: Math.max(280, Math.min(420, Number(saved.left) || defaults.left)),
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
      localStorage.setItem("dirrio:workspace-layout:2", JSON.stringify(layout));
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
        aria-label={t("Resize {0}", {
          0:
            panel === "left"
              ? "library"
              : panel === "right"
                ? "inspector"
                : "timeline",
        })}
        aria-orientation={panel === "bottom" ? "horizontal" : "vertical"}
        aria-valuemin={panel === "left" ? 150 : panel === "right" ? 240 : 160}
        aria-valuemax={1200}
        aria-valuenow={Math.round(layout[panel])}
        onPointerDown={(event) => resizePanel(panel, event)}
        onDoubleClick={() =>
          setLayout((old) => ({
            ...old,
            [panel]: panel === "left" ? 330 : panel === "right" ? 310 : 280,
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
  function selectSegment(id?: string) {
    scriptVersion.current = undefined;
    setWorkspaceParams((previous) => {
      const next = new URLSearchParams(previous);
      if (id) next.set("segment", id);
      else next.delete("segment");
      next.delete("staging");
      next.delete("stagingReference");
      return next;
    });
  }
  async function segmentAction(action: () => Promise<void> | void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await preferences.flush())) return;
      if (scriptSave.current && !(await scriptSave.current())) return;
      await action();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not update segment",
      );
    } finally {
      setBusy(false);
    }
  }
  async function moveSegment(direction: number) {
    await segmentAction(async () => {
      const ids = segments.map((s) => s._id);
      const index = ids.indexOf(selectedSegment!._id),
        target = index + direction;
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target]!, ids[index]!];
      await reorderSegments({ projectId: projectId as never, segmentIds: ids });
    });
  }

  const dirtyChanged = useCallback((value: boolean) => setDirty(value), []);
  const estimate = useQuery(api.generation.estimateCost, {
    adapterId: "seedance-2.5",
    kind: "text-to-video",
    input: {
      durationSec,
      resolution,
      aspectRatio,
      prompt: "video",
    },
  });
  const videos = useMemo(() => footage?.videos ?? [], [footage]);
  const source = assets?.find((a) => a._id === sourceId);
  const selectedAsset = assets?.find(
    (asset) =>
      selectedClip?.source.type === "asset" &&
      asset._id === selectedClip.source.assetId,
  );
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
  const [onlySegmentFootage, setOnlySegmentFootage] = useState(false);
  const scopedVideos = onlySegmentFootage
    ? videos.filter((video) => video.segmentId === selectedSegment?._id)
    : videos;
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
        get title() {
          return t("Generate a 5-second extension?");
        },
        description: t(
          "Approximately {0}. The original video and current edit are preserved.",
          {
            0: extensionEstimate
              ? formatUsd(extensionEstimate.usdMicros)
              : t("the displayed estimate"),
          },
        ),
        confirmLabel: t("Generate extension"),
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await extend({
        maxCostUsdMicros: extensionEstimate?.usdMicros ?? 0,
        projectId: projectId as never,
        adapterId: "seedance-2.5",
        kind: "extend",
        prompt: "Continue the motion seamlessly.",
        parentAssetIds: [sourceVideo.assetId],
        segmentId: sourceVideo.segmentId,
        scriptVersionId: sourceVideo.scriptVersionId,
        input: { durationSec: 5 },
      });
      setNotice("Extension started. It will appear as another generation.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not extend video");
    } finally {
      setBusy(false);
    }
  }
  const usdMicros = estimate?.usdMicros ?? 0;
  const overCap = spend?.remaining != null && usdMicros > spend.remaining;
  const validDuration =
    Number.isInteger(durationSec) && durationSec >= 4 && durationSec <= 30;
  async function startGeneration() {
    if (
      busy ||
      running ||
      !validDuration ||
      overCap ||
      !preferences.loaded ||
      preferences.error ||
      (preferences.settings.useStaging && !useStaging)
    )
      return;
    setBusy(true);
    setError(null);
    try {
      if (!(await preferences.flush())) return;
      if (scriptSave.current && !(await scriptSave.current())) return;
      const generationScriptVersion = scriptVersion.current;
      if (selectedSegment && !generationScriptVersion)
        throw new Error("Wait for the script to finish loading");
      if (
        usdMicros >= COST_CONFIRM_THRESHOLD_USD_MICROS &&
        !(await confirm({
          get title() {
            return t("Generate video?");
          },
          description: t(
            "Approximately {0}. Previous footage and timeline edits are preserved.",
            { 0: formatUsd(usdMicros) },
          ),
          confirmLabel: t("Generate"),
        }))
      )
        return;
      await generate({
        maxCostUsdMicros: usdMicros,
        projectId: projectId as never,
        segmentId: selectedSegment?._id,
        scriptVersionId: generationScriptVersion as never,
        settingsSnapshot: {
          resolution,
          durationSec,
          aspectRatio,
          stagingId: preferences.settings.stagingId ?? undefined,
          useStaging: preferences.settings.useStaging,
        },
        durationSec,
        resolution,
        aspectRatio,
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
    if (!onInsertMany || busy || readOnly) return;
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
      if (onInsertMany(selected) === false) {
        setError("Timeline is read-only. Request editing access first.");
        return;
      }
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
    if (readOnly) return;
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
    const accepted = onInsert({
      assetId: source._id,
      type: source.type,
      durationSec: outSec - inSec,
      inSec,
      outSec,
    });
    if (accepted === false) {
      setError("Timeline is read-only. Request editing access first.");
      return;
    }
    setNotice(
      t("{0} added to the timeline. The source is preserved.", {
        0: source.name,
      }),
    );
    setView("edit");
  }
  const media = (assets ?? []).filter((a) =>
    ["video", "image", "audio", "music"].includes(a.type),
  );
  const scopedAssets =
    library === "references"
      ? media.filter(
          (a) =>
            a.type === "image" ||
            (a.type === "video" && bindings?.some((b) => b.assetId === a._id)),
        )
      : media;
  const libraryAssets = scopedAssets.filter(
    (asset) =>
      (mediaType === "all" ||
        (mediaType === "audio"
          ? ["audio", "music"].includes(asset.type)
          : asset.type === mediaType)) &&
      `${asset.name} ${bindings?.find((binding) => binding.assetId === asset._id)?.alias ?? ""}`
        .toLowerCase()
        .includes(mediaSearch.trim().toLowerCase()),
  );
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
      <nav
        className="studio-layout-controls"
        aria-label={t("Workspace panels")}
      >
        {(["library", "inspector", "generations", "timeline"] as const).map(
          (panel) => (
            <button
              key={panel}
              aria-pressed={layout[panel]}
              onClick={() =>
                setLayout((old) => ({ ...old, [panel]: !old[panel] }))
              }
            >
              {t(panel.charAt(0).toUpperCase() + panel.slice(1))}
            </button>
          ),
        )}
        <button
          onClick={() =>
            setLayout({
              left: 330,
              right: 310,
              bottom: 280,
              library: true,
              inspector: true,
              timeline: true,
              generations: true,
            })
          }
        >
          <I18nText text="Reset layout" />
        </button>
      </nav>
      <aside
        hidden={!layout.library}
        className="studio-library"
        aria-label={t("Project library")}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={async (event) => {
          if (!event.dataTransfer.files.length) return;
          if (canWrite === false) {
            event.preventDefault();
            return;
          }
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
          <h2>
            <I18nText text="Project media" />{" "}
            <span className="studio-media-count">{media.length}</span>
          </h2>
          <Button
            size="sm"
            disabled={canWrite === false}
            onClick={() => importInput.current?.click()}
          >
            <Plus size={14} />
            <I18nText text="Import" />
          </Button>
        </div>
        {migrationError && !workspace?.migrated && (
          <p role="alert">
            {t(migrationError ?? "")}
            <Button
              onClick={() => {
                setMigrationError(null);
                setMigrationAttempt((value) => value + 1);
              }}
            >
              <I18nText text="Retry workspace setup" />
            </Button>
          </p>
        )}
        <div className="studio-media-search">
          <Search size={14} />
          <Input
            aria-label={t("Search project media")}
            placeholder={t("Search media…")}
            value={mediaSearch}
            onChange={(event) => setMediaSearch(event.target.value)}
          />
        </div>
        <div className="studio-library-tabs">
          <button
            aria-pressed={library === "media"}
            onClick={() => setLibrary("media")}
          >
            <I18nText text="All media" />
          </button>
          <button
            aria-pressed={library === "references"}
            onClick={() => setLibrary("references")}
          >
            <I18nText text="References" />
          </button>
        </div>
        <div
          className="studio-media-filters"
          role="group"
          aria-label={t("Media types")}
        >
          {[
            {
              value: "all",
              get label() {
                return t("All");
              },
            },
            {
              value: "video",
              get label() {
                return t("Video");
              },
            },
            {
              value: "image",
              get label() {
                return t("Images");
              },
            },
            {
              value: "audio",
              get label() {
                return t("Audio");
              },
            },
          ].map((filter) => (
            <button
              key={filter.value}
              aria-pressed={mediaType === filter.value}
              onClick={() => setMediaType(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="studio-assets">
          {!libraryAssets.length && (
            <p className="studio-library-empty">
              {mediaSearch || mediaType !== "all"
                ? t("No media matches your filters.")
                : library === "references"
                  ? t("No reference media yet.")
                  : t("Import media to start your story.")}
            </p>
          )}
          {libraryAssets.map((asset) => (
            <ReferenceMedia
              key={asset._id}
              asset={asset}
              url={urls?.find((u) => u.assetId === asset._id)?.url}
            >
              <button
                key={asset._id}
                className={`studio-asset ${sourceId === asset._id ? "selected" : ""}`}
                draggable={false}
                data-media-draggable
                onDragStart={(event) => event.preventDefault()}
                onPointerDown={(event) =>
                  beginMediaPointerDrag(event, asset._id)
                }
                title={t("Drag to the timeline or script, or click to preview")}
                onClick={() => preview(asset._id)}
              >
                {asset.type === "image" || asset.type === "video" ? (
                  <MediaThumbnail
                    asset={asset}
                    url={urls?.find((u) => u.assetId === asset._id)?.url}
                  />
                ) : (
                  <Music size={18} />
                )}
                {asset.type === "video" && asset.durationSec != null && (
                  <span className="studio-asset-duration">
                    {Math.floor(asset.durationSec / 60)}:
                    {String(Math.floor(asset.durationSec % 60)).padStart(
                      2,
                      "0",
                    )}
                  </span>
                )}
                <span className="studio-asset-caption">
                  <strong title={asset.name}>{asset.name}</strong>
                  <small>
                    {bindings?.find((b) => b.assetId === asset._id)
                      ? `@${bindings.find((b) => b.assetId === asset._id)?.alias}`
                      : asset.type}
                  </small>
                </span>
              </button>
            </ReferenceMedia>
          ))}
        </div>
        <label className="studio-upload-label">
          <Upload size={15} />
          <strong>
            <I18nText text="Drop media here" />
          </strong>
          <small>
            <I18nText text="Images, video, or audio · choose files" />
          </small>
          <input
            ref={importInput}
            aria-label={t("Import media")}
            type="file"
            disabled={canWrite === false}
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
          <I18nText text="Import music" />
          <input
            type="file"
            disabled={canWrite === false}
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
        <section className="studio-viewer" aria-label={t("Media viewer")}>
          <div className="studio-section-heading">
            <div>
              <h2>
                {view === "source"
                  ? (source?.name ?? "Viewer")
                  : view === "staging"
                    ? t("Preview")
                    : t("Timeline preview")}
              </h2>
              <span className="studio-muted">
                {view === "source"
                  ? t("Source preview · your edit is unchanged")
                  : t("Connected project workspace")}
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
                <I18nText text="Source" />
              </button>
              <button
                aria-label={t("Show timeline preview")}
                aria-pressed={view === "edit"}
                onClick={() => setView("edit")}
              >
                <I18nText text="Timeline" />
              </button>
              <button
                aria-pressed={view === "staging"}
                onClick={() => {
                  setView("staging");
                  onPreview();
                }}
              >
                <I18nText text="Staging" />
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
                <I18nText text="Play both from start" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCompareIds([]);
                  setView("source");
                }}
              >
                <I18nText text="Close comparison" />
              </Button>
            </div>
          )}
          <div
            ref={previewContainer}
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
                  <h2>
                    <I18nText text="Your story starts here" />
                  </h2>
                  <p>
                    <I18nText text="Preview any generation or imported asset, then add the range you want to your edit." />
                  </p>
                </div>
              ))}
            {view === "staging" && (
              <div className="studio-staging-panel">
                <BlockoutPage
                  onUseForGeneration={(id) => {
                    if (canWrite === false || !preferences.loaded) return;
                    setWorkspaceParams(
                      (previous) => {
                        const next = new URLSearchParams(previous);
                        next.set("staging", id);
                        next.set("stagingReference", "1");
                        return next;
                      },
                      { replace: true },
                    );
                    preferences.update({
                      stagingId: id as never,
                      useStaging: true,
                    });
                    setInspectorView("generation");
                    setLayout((previous) => ({ ...previous, inspector: true }));
                  }}
                />
              </div>
            )}
          </div>
          {view === "edit" && previewTransport && (
            <div className="studio-preview-transport">
              {previewTransport}
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("Fullscreen preview")}
                onClick={() => {
                  void previewContainer.current
                    ?.requestFullscreen()
                    .catch(() =>
                      setError("Fullscreen is not available in this browser."),
                    );
                }}
              >
                <Maximize size={15} />
              </Button>
            </div>
          )}
          {view === "edit" && selectedAsset && (
            <div className="studio-source-summary">
              <MediaThumbnail
                asset={selectedAsset}
                url={
                  urls?.find((row) => row.assetId === selectedAsset._id)?.url
                }
              />
              <div>
                <strong title={selectedAsset.name}>{selectedAsset.name}</strong>
                <small>
                  {selectedAsset.width && selectedAsset.height
                    ? `${selectedAsset.width} × ${selectedAsset.height} · `
                    : ""}
                  {t(selectedAsset.type ?? "")}
                </small>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => preview(selectedAsset._id)}
              >
                <I18nText text="View source" />
              </Button>
            </div>
          )}
          {view === "source" && source && (
            <div className="studio-source-toolbar">
              <label>
                <I18nText text="Name" />
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
                <I18nText text="In (s)" />
                <input
                  aria-label={t("Source in")}
                  type="number"
                  min={0}
                  step={0.1}
                  value={inSec}
                  onChange={(e) => setInSec(Number(e.target.value))}
                />
              </label>
              <label>
                <I18nText text="Out (s)" />
                <input
                  aria-label={t("Source out")}
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
                disabled={
                  canWrite === false ||
                  readOnly ||
                  (source.type !== "image" && !sourceDuration)
                }
                onClick={insert}
              >
                <Plus />
                <I18nText text="Add to timeline" />
              </Button>
              {sourceUrl && (
                <a
                  className="studio-download"
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <I18nText text="Open source ↗" />
                </a>
              )}
              {sourceVideo && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void extendSource()}
                >
                  <I18nText text="Extend +5s ·" />{" "}
                  {extensionEstimate
                    ? formatUsd(extensionEstimate.usdMicros)
                    : "…"}
                </Button>
              )}
            </div>
          )}
        </section>
        <section
          hidden={!layout.generations}
          className="studio-generations"
          aria-label={t("Generation history")}
        >
          <div className="studio-section-heading">
            <h2>
              <I18nText text="Generations" />{" "}
              <span className="studio-muted">{scopedVideos.length}</span>
            </h2>
          </div>
          {onInsertMany && (
            <Button
              size="sm"
              variant="outline"
              disabled={readOnly || !assemblyIds.length || busy}
              onClick={() => void insertSelected()}
            >
              <I18nText text="Add selected videos (" />
              {assemblyIds.length})
            </Button>
          )}
          <label className="flex items-center gap-2 px-3 text-xs">
            <input
              type="checkbox"
              checked={onlySegmentFootage}
              onChange={(event) => setOnlySegmentFootage(event.target.checked)}
            />
            <I18nText text="Selected segment only" />
          </label>
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
                  aria-label={t("Preview {0}", { 0: video.name })}
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
                      ? t("Video {0}", {
                          0: String(scopedVideos.length - index).padStart(
                            2,
                            "0",
                          ),
                        })
                      : video.name}
                  </strong>
                  <small>
                    {video.segmentId && (
                      <span>
                        {segments.find((s) => s._id === video.segmentId)
                          ?.title ?? t("Archived segment")}{" "}
                        · {t("Version")} {video.scriptVersion} ·{" "}
                      </span>
                    )}
                    {video.durationSec ?? mediaDurations[video.assetId] ?? "?"}s
                    · {video.generated ? t("Generated") : t("Imported")}
                  </small>
                </button>
                {onInsertMany && (
                  <label className="studio-check">
                    <input
                      type="checkbox"
                      aria-label={t("Select {0} for editing", {
                        0: video.name,
                      })}
                      checked={assemblyIds.includes(video.assetId)}
                      onChange={(event) =>
                        setAssemblyIds((ids) =>
                          event.target.checked
                            ? [...ids, video.assetId]
                            : ids.filter((id) => id !== video.assetId),
                        )
                      }
                    />
                    <I18nText text="Add to edit" />
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
                  <I18nText text="Compare" />
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
                <I18nText text="No footage yet. Generate a video or import a video." />
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
                  ? t(
                      "Submission needs review. Funds remain reserved; do not resubmit.",
                    )
                  : `${job.status} · ${formatUsd(job.estimatedCostUsdMicros)}`}{" "}
                · {new Date(job.createdAt).toLocaleString(getLocale())}
                {job.errorMessage && (
                  <span className="block">{job.errorMessage}</span>
                )}
                {job.status === "refunded" && (
                  <span className="block">
                    <I18nText text="Funds released. Your existing media and edit are preserved." />
                  </span>
                )}
              </p>
            ))}
        </section>
        {notice && (
          <p className="studio-notice" role="status">
            {t(notice ?? "")}
          </p>
        )}
        {error && (
          <p className="studio-error" role="alert">
            {t(error ?? "")}
          </p>
        )}
      </div>
      <aside
        hidden={!layout.inspector}
        className="studio-inspector"
        aria-label={t("Script and clip inspector")}
      >
        {divider("right")}
        <div className="studio-inspector-tabs">
          <button
            aria-pressed={inspectorView === "script"}
            onClick={() => setInspectorView("script")}
          >
            <Link2 size={14} />
            <I18nText text="Script" />
          </button>
          <button
            aria-pressed={inspectorView === "generation"}
            onClick={() => setInspectorView("generation")}
          >
            <I18nText text="Generation" />
          </button>
          <button
            aria-pressed={inspectorView === "clip"}
            onClick={() => setInspectorView("clip")}
          >
            <I18nText text="Clip settings" />
          </button>
        </div>
        <div hidden={inspectorView !== "script"}>
          <div className="studio-segments">
            <div className="studio-segment-heading">
              <span>
                <I18nText text="Script segment" />
              </span>{" "}
              {canWrite !== false && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void segmentAction(async () =>
                      selectSegment(
                        await createSegment({ projectId: projectId as never }),
                      ),
                    )
                  }
                >
                  <Plus size={14} />
                  <I18nText text="Add segment" />
                </Button>
              )}
            </div>
            <div className="studio-segment-picker">
              <label>
                <select
                  aria-label={t("Script segment")}
                  value={selectedSegment?._id ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    const id = event.target.value;
                    void segmentAction(async () => selectSegment(id));
                  }}
                >
                  {segments.map((segment, index) => (
                    <option key={segment._id} value={segment._id}>
                      {index + 1}. {segment.title}
                    </option>
                  ))}
                </select>
              </label>
              {canWrite !== false && selectedSegment && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("Segment actions")}
                      disabled={busy}
                    >
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="studio-segment-menu"
                  >
                    <DropdownMenuItem
                      disabled={
                        busy || segments[0]?._id === selectedSegment._id
                      }
                      onSelect={() => void moveSegment(-1)}
                    >
                      <ArrowUp size={14} />
                      <I18nText text="Move earlier" />
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={
                        busy || segments.at(-1)?._id === selectedSegment._id
                      }
                      onSelect={() => void moveSegment(1)}
                    >
                      <ArrowDown size={14} />
                      <I18nText text="Move later" />
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={busy || segments.length < 2}
                      onSelect={() =>
                        void segmentAction(async () => {
                          await updateSegment({
                            projectId: projectId as never,
                            segmentId: selectedSegment._id,
                            archive: true,
                          });
                          selectSegment(
                            segments.find((s) => s._id !== selectedSegment._id)!
                              ._id,
                          );
                        })
                      }
                    >
                      <Archive size={14} />
                      <I18nText text="Archive segment" />
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="studio-segment-delete"
                      disabled={busy}
                      onSelect={() =>
                        void segmentAction(async () => {
                          if (
                            !(await confirm({
                              title: t("Delete segment?"),
                              description: t(
                                "Deleting {0} permanently removes its script and all script versions. This cannot be undone.",
                                { 0: selectedSegment.title },
                              ),
                              confirmLabel: t("Delete segment"),
                              destructive: true,
                            }))
                          )
                            return;
                          await deleteSegment({
                            projectId: projectId as never,
                            segmentId: selectedSegment._id,
                          });
                          try {
                            localStorage.removeItem(
                              `dirrio.scriptDraft.${draftScope}${projectId}.${selectedSegment._id}.plain`,
                            );
                          } catch {
                            /* optional browser recovery */
                          }
                          selectSegment(
                            segments.find(
                              (segment) => segment._id !== selectedSegment._id,
                            )?._id,
                          );
                        })
                      }
                    >
                      <Trash2 size={14} />
                      <I18nText text="Delete segment" />
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {canWrite !== false && (
              <>
                {selectedSegment && (
                  <>
                    <label className="studio-segment-title">
                      <span>
                        <I18nText text="Segment title" />
                      </span>
                      <input
                        aria-label={t("Segment title")}
                        key={`${selectedSegment._id}-${selectedSegment.title}`}
                        defaultValue={selectedSegment.title}
                        maxLength={120}
                        onBlur={(event) => {
                          const title = event.target.value.trim();
                          if (title !== selectedSegment.title)
                            void segmentAction(async () => {
                              await updateSegment({
                                projectId: projectId as never,
                                segmentId: selectedSegment._id,
                                title,
                              });
                            });
                        }}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            {selectedSegment && (
              <p className="studio-segment-details">
                <span>
                  <I18nText text="Planned range" />{" "}
                  <strong>
                    {segmentTime(
                      segments
                        .slice(0, segments.indexOf(selectedSegment))
                        .reduce(
                          (total, segment) => total + segment.durationSec,
                          0,
                        ),
                    )}
                    –
                    {segmentTime(
                      segments
                        .slice(0, segments.indexOf(selectedSegment) + 1)
                        .reduce(
                          (total, segment) => total + segment.durationSec,
                          0,
                        ),
                    )}
                  </strong>
                </span>
                <span>
                  <I18nText text="Script version" />{" "}
                  <strong>{selectedSegment.versionCount}</strong>
                </span>
                <small>
                  <I18nText text="Based on segment durations, not timeline edits." />
                </small>
              </p>
            )}
            <details className="studio-archived-segments">
              <summary>
                <I18nText text="Archived segments" /> ({archivedSegments.length}
                )
              </summary>
              {archivedSegments.length ? (
                <ul>
                  {archivedSegments.map((segment) => (
                    <li key={segment._id}>
                      <span>{segment.title}</span>
                      {canWrite !== false && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          aria-label={t("Restore {0}", { 0: segment.title })}
                          onClick={() =>
                            void segmentAction(async () => {
                              const id = await restoreSegment({
                                projectId: projectId as never,
                                segmentId: segment._id,
                              });
                              selectSegment(id);
                            })
                          }
                        >
                          <I18nText text="Restore" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  <I18nText text="No archived segments" />
                </p>
              )}
            </details>
          </div>
          {selectedSegment && (
            <StudioScript
              key={`${projectId}-${selectedSegment?._id ?? "legacy"}`}
              segmentId={selectedSegment?._id}
              versionRef={scriptVersion}
              recoverLegacyDraft={selectedSegment?._id === segments[0]?._id}
              stagingReferenceId={
                useStaging ? staging?.previzAssetId : undefined
              }
              projectId={projectId}
              onDirty={dirtyChanged}
              onValidityChange={setReferencesValid}
              saveRef={scriptSave}
            />
          )}
        </div>
        <div
          hidden={inspectorView === "clip"}
          className={
            inspectorView === "script"
              ? "studio-script-generation-footer"
              : undefined
          }
        >
          <section className="studio-generation-settings">
            <h2>
              <I18nText text="Generation" />
            </h2>
            {inspectorView === "generation" && selectedSegment && (
              <div className="studio-generation-segment">
                <span>
                  <I18nText text="Script segment" />
                </span>
                <strong>{selectedSegment.title}</strong>
              </div>
            )}
            <label>
              <I18nText text="Model" />
              <span>Seedance 2.5</span>
            </label>
            <div className="studio-generation-controls">
              <div>
                <label id="generation-resolution-label">
                  <I18nText text="Resolution" />
                </label>
                <Select
                  value={resolution}
                  disabled={canWrite === false || busy || !preferences.loaded}
                  onValueChange={(value) =>
                    preferences.update({
                      resolution: value as "720p" | "1080p",
                    })
                  }
                >
                  <SelectTrigger aria-labelledby="generation-resolution-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="720p">720p</SelectItem>
                    <SelectItem value="1080p">1080p</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label id="generation-aspect-label">
                  <I18nText text="Aspect ratio" />
                </label>
                <Select
                  value={aspectRatio}
                  disabled={canWrite === false || busy || !preferences.loaded}
                  onValueChange={(value) =>
                    preferences.update({
                      aspectRatio: value as "16:9" | "9:16" | "1:1",
                    })
                  }
                >
                  <SelectTrigger aria-labelledby="generation-aspect-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["16:9", "9:16", "1:1"].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="studio-duration-control">
                <label htmlFor="generation-duration">
                  <I18nText text="Duration" />{" "}
                  <output htmlFor="generation-duration">
                    {durationSec} <I18nText text="seconds" />
                  </output>
                </label>
                <input
                  id="generation-duration"
                  aria-label={t("Generation duration")}
                  aria-valuetext={t("{0} seconds", { 0: durationSec })}
                  type="range"
                  min={4}
                  max={30}
                  step={1}
                  value={durationSec}
                  disabled={canWrite === false || busy || !preferences.loaded}
                  onBlur={() => void preferences.flush()}
                  onPointerUp={() => void preferences.flush()}
                  onKeyUp={() => void preferences.flush()}
                  onChange={(event) =>
                    preferences.update(
                      { durationSec: Number(event.target.value) },
                      300,
                    )
                  }
                  style={
                    {
                      "--duration-progress": `${((durationSec - 4) / 26) * 100}%`,
                    } as CSSProperties
                  }
                />
                <div className="studio-duration-limits">
                  <span>4s</span>
                  <span>30s</span>
                </div>
              </div>
            </div>
            {workspace && segmentStaging.length > 0 && (
              <div className="staging-generation-selector">
                <span>
                  <I18nText text="Staging" />
                </span>
                <Select
                  value={staging?._id ?? ""}
                  disabled={canWrite === false || busy || !preferences.loaded}
                  onValueChange={(id) => {
                    preferences.update({
                      stagingId: id as never,
                      useStaging: false,
                    });
                    setWorkspaceParams(
                      (previous) => {
                        const next = new URLSearchParams(previous);
                        next.set("staging", id);
                        next.delete("stagingReference");
                        return next;
                      },
                      { replace: true },
                    );
                  }}
                >
                  <SelectTrigger aria-label={t("Generation staging")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {segmentStaging.map((item) => (
                      <SelectItem key={item._id} value={item._id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {staging?.previzAssetId && (
              <label className="studio-check">
                <input
                  type="checkbox"
                  checked={useStaging}
                  disabled={canWrite === false || busy || !preferences.loaded}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    if (staging)
                      preferences.update({
                        stagingId: staging._id,
                        useStaging: checked,
                      });
                    setWorkspaceParams(
                      (previous) => {
                        const next = new URLSearchParams(previous);
                        if (checked) next.set("stagingReference", "1");
                        else next.delete("stagingReference");
                        return next;
                      },
                      { replace: true },
                    );
                  }}
                />
                <I18nText text="Use staging as video reference" />
              </label>
            )}
            {workspace && preferences.settings.useStaging && !useStaging && (
              <div role="alert" className="space-y-2 text-xs text-amber-300">
                <p>
                  <I18nText text="The saved staging reference is unavailable. Choose another reference or reset it." />
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={canWrite === false || busy}
                  onClick={() => {
                    preferences.update({ stagingId: null, useStaging: false });
                    setWorkspaceParams(
                      (previous) => {
                        const next = new URLSearchParams(previous);
                        next.delete("stagingReference");
                        next.delete("staging");
                        return next;
                      },
                      { replace: true },
                    );
                  }}
                >
                  <I18nText text="Reset staging reference" />
                </Button>
              </div>
            )}
            <div aria-live="polite" className="text-xs text-zinc-400">
              {preferences.error ? (
                <div role="alert" className="space-y-2 text-red-400">
                  <p>{t("Could not save generation settings.")}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void preferences.retry()}
                  >
                    <I18nText text="Retry save" />
                  </Button>
                </div>
              ) : !preferences.loaded ? (
                t("Loading settings…")
              ) : preferences.saving || preferences.pending ? (
                t("Saving…")
              ) : preferences.saved ? (
                t("All changes saved")
              ) : null}
            </div>
            <Button
              className="w-full"
              disabled={
                !preferences.loaded ||
                preferences.saving ||
                preferences.pending ||
                Boolean(preferences.error) ||
                (preferences.settings.useStaging && !useStaging) ||
                canWrite === false ||
                busy ||
                running ||
                !validDuration ||
                !usdMicros ||
                overCap ||
                dirty ||
                !referencesValid
              }
              onClick={() => void startGeneration()}
            >
              {busy
                ? t("Starting…")
                : running
                  ? t("Generating…")
                  : t("Generate video · {0}", { 0: formatUsd(usdMicros) })}
            </Button>
            {spend && (
              <p className="studio-muted">
                <I18nText text="Spent:" />{" "}
                {formatUsd(spend.spentUsdMicros ?? 0)}{" "}
                <I18nText text="· Reserved:" />{" "}
                {formatUsd(spend.reservedUsdMicros ?? 0)}
                {spend.remaining != null
                  ? t(" · Project budget remaining: {0}", {
                      0: formatUsd(spend.remaining),
                    })
                  : ""}
              </p>
            )}
            <p className="studio-muted">
              {dirty
                ? t("Save the script before generating.")
                : !referencesValid
                  ? t(
                      "Resolve the script reference issues in the Script tab before generating.",
                    )
                  : overCap
                    ? t("Project spend cap reached.")
                    : !validDuration
                      ? t(
                          "Use a whole-number duration of 4–30 seconds per video.",
                        )
                      : t("Previous videos and timeline edits are preserved.")}
            </p>
          </section>
        </div>
        <div hidden={inspectorView !== "clip"}>{inspector}</div>
      </aside>
      <section
        hidden={!layout.timeline}
        className="studio-timeline"
        aria-label={t("Project timeline")}
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
