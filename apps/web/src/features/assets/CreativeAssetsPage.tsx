import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import { api } from "@dirrio/backend";
import { useAction, useMutation, useQuery } from "@/lib/api/hooks";
import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AssetLibrary } from "@/features/assets/AssetLibrary";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  character: "character",
  creature: "creature",
  location: "environment",
  prop: "product",
};

function imageFilesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  return Array.from(dt.files).filter((f) => f.type.startsWith("image/"));
}

export function CreativeAssetsPage() {
  useLocale();
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") === "library" ? "library" : "grid";
  const ensureStyle = useMutation(api.entities.ensureStyle);
  const createEntity = useMutation(api.entities.create);
  const updateProject = useMutation(api.projects.update);
  const lockReference = useAction(api.entities.lockReference);
  const { uploadFiles } = useAssetUpload(projectId);

  const entities = useQuery(
    api.entities.listForProject,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const project = useQuery(
    api.projects.get,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const tips = useQuery(
    api.promptSheets.listTips,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const styleUrl = useQuery(
    api.storage.getAssetUrl,
    project?.styleReferenceAssetId
      ? { assetId: project.styleReferenceAssetId }
      : "skip",
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [uploadingStyle, setUploadingStyle] = useState(false);
  const [dropTarget, setDropTarget] = useState<"zone" | string | null>(null);
  const [dropBusy, setDropBusy] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    if (projectId) void ensureStyle({ projectId: projectId as never });
  }, [projectId, ensureStyle]);

  if (!projectId) return null;

  const creative = (entities ?? []).filter((e) => e.kind !== "style");
  const tipByEntity = new Map(
    (tips ?? [])
      .filter(
        (t) =>
          t.entityId &&
          ["character", "creature", "environment", "product"].includes(t.type),
      )
      .map((t) => [t.entityId as string, t]),
  );

  const onNewAsset = async () => {
    setCreating(true);
    try {
      const id = await createEntity({
        projectId: projectId as never,
        kind: "character",
        name: "New reference",
      });
      navigate(`/projects/${projectId}/assets/${id}`);
    } finally {
      setCreating(false);
    }
  };

  const onStyleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadingStyle(true);
    try {
      const ids = await uploadFiles(files, { type: "image" });
      const id = ids[0];
      if (id) {
        await updateProject({
          projectId: projectId as never,
          styleReferenceAssetId: id as never,
        });
      }
    } finally {
      setUploadingStyle(false);
    }
  };

  const assignImageToEntity = async (entityId: string, files: File[]) => {
    if (files.length === 0) return;
    setDropBusy(true);
    setDropError(null);
    try {
      const ids = await uploadFiles(files, {
        entityId,
        type: "image",
      });
      const assetId = ids[0];
      if (assetId) {
        await lockReference({
          entityId: entityId as never,
          assetId: assetId as never,
          referenceSheet: true,
        });
      }
    } catch (err) {
      setDropError(err instanceof Error ? err.message : String(err));
    } finally {
      setDropBusy(false);
      setDropTarget(null);
    }
  };

  const createAssetFromDrop = async (files: File[]) => {
    if (files.length === 0) return;
    setDropBusy(true);
    setDropError(null);
    try {
      const baseName =
        files[0]!.name.replace(/\.[^.]+$/, "").trim() || "New reference";
      const entityId = await createEntity({
        projectId: projectId as never,
        kind: "character",
        name: baseName,
      });
      const ids = await uploadFiles(files, {
        entityId,
        type: "image",
      });
      const assetId = ids[0];
      if (assetId) {
        await lockReference({
          entityId: entityId as never,
          assetId: assetId as never,
          referenceSheet: true,
        });
      }
    } catch (err) {
      setDropError(err instanceof Error ? err.message : String(err));
    } finally {
      setDropBusy(false);
      setDropTarget(null);
    }
  };

  const onZoneDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current += 1;
    if (
      imageFilesFromDataTransfer(e.dataTransfer).length > 0 ||
      e.dataTransfer.types.includes("Files")
    ) {
      setDropTarget((cur) => (typeof cur === "string" ? cur : "zone"));
    }
  };

  const onZoneDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropTarget(null);
  };

  const onZoneDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onZoneDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    const files = imageFilesFromDataTransfer(e.dataTransfer);
    setDropTarget(null);
    if (files.length === 0) {
      setDropError("Drop image files only.");
      return;
    }
    void createAssetFromDrop(files);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn(
              "px-2 py-1 text-sm",
              view === "grid"
                ? "border-b border-zinc-100 text-zinc-50"
                : "text-zinc-500",
            )}
            onClick={() => setSearchParams({})}
          >
            <I18nText text="Assets" />
          </button>
          <button
            type="button"
            className={cn(
              "px-2 py-1 text-sm",
              view === "library"
                ? "border-b border-zinc-100 text-zinc-50"
                : "text-zinc-500",
            )}
            onClick={() => setSearchParams({ view: "library" })}
          >
            <I18nText text="Library" />
          </button>
        </div>
        {view === "grid" ? (
          <Button
            type="button"
            size="sm"
            disabled={creating}
            onClick={() => void onNewAsset()}
          >
            {creating ? "…" : t("New reference")}
          </Button>
        ) : null}
      </div>

      {view === "library" ? (
        <AssetLibrary projectId={projectId} title={t("Library")} />
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-4 border border-zinc-800 p-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                <I18nText text="Style reference" />
              </p>
              <button
                type="button"
                className="mt-1 flex h-24 w-24 items-center justify-center overflow-hidden border border-dashed border-zinc-700 bg-zinc-900 text-[11px] text-zinc-500 hover:border-zinc-500"
                disabled={uploadingStyle}
                onClick={() => fileRef.current?.click()}
              >
                {styleUrl ? (
                  <img
                    src={styleUrl}
                    alt={t("Style reference")}
                    className="h-full w-full object-cover"
                  />
                ) : uploadingStyle ? (
                  "…"
                ) : (
                  "Upload"
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void onStyleUpload(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="max-w-xs pt-4 text-xs text-zinc-500">
              <I18nText text="Applied to every image." />
            </p>
          </div>

          {dropError ? (
            <p className="text-[11px] text-red-300">{t(dropError ?? "")}</p>
          ) : null}
          {dropBusy ? (
            <p className="text-[11px] text-zinc-500">
              <I18nText text="Uploading…" />
            </p>
          ) : null}

          <div
            className={cn(
              "min-h-48 rounded-sm border border-dashed p-2 transition-colors",
              dropTarget === "zone"
                ? "border-zinc-400 bg-zinc-900/60"
                : "border-zinc-800",
            )}
            onDragEnter={onZoneDragEnter}
            onDragLeave={onZoneDragLeave}
            onDragOver={onZoneDragOver}
            onDrop={onZoneDrop}
          >
            {creative.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-zinc-500">
                <I18nText text="No assets yet. Drop images here to create them." />
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {creative.map((entity) => {
                  const tip = tipByEntity.get(entity._id);
                  const thumbId =
                    entity.lockedReferenceAssetIds[0] ?? undefined;
                  return (
                    <AssetCard
                      key={entity._id}
                      name={entity.name}
                      kind={KIND_LABEL[entity.kind] ?? entity.kind}
                      thumbId={thumbId}
                      stale={tip?.status === "out_of_date"}
                      href={`/projects/${projectId}/assets/${entity._id}`}
                      dropActive={dropTarget === entity._id}
                      onDragEnterCard={() => setDropTarget(entity._id)}
                      onDragLeaveCard={() =>
                        setDropTarget((cur) =>
                          cur === entity._id ? "zone" : cur,
                        )
                      }
                      onDropFiles={(files) => {
                        void assignImageToEntity(entity._id, files);
                      }}
                    />
                  );
                })}
              </div>
            )}
            <p className="mt-2 px-1 text-[10px] text-zinc-600">
              <I18nText text="Drop an image on a card to assign it, or onto empty space to create a new asset." />
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function AssetCard({
  name,
  kind,
  thumbId,
  stale,
  href,
  dropActive,
  onDragEnterCard,
  onDragLeaveCard,
  onDropFiles,
}: {
  name: string;
  kind: string;
  thumbId?: string;
  stale?: boolean;
  href: string;
  dropActive?: boolean;
  onDragEnterCard?: () => void;
  onDragLeaveCard?: () => void;
  onDropFiles?: (files: File[]) => void;
}) {
  useLocale();
  const url = useQuery(
    api.storage.getAssetUrl,
    thumbId ? { assetId: thumbId as never } : "skip",
  );
  return (
    <Link
      to={href}
      className={cn(
        "group overflow-hidden border bg-zinc-950 hover:border-zinc-600",
        dropActive ? "border-zinc-300 ring-1 ring-zinc-400" : "border-zinc-800",
      )}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragEnterCard?.();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragLeaveCard?.();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const files = imageFilesFromDataTransfer(e.dataTransfer);
        if (files.length > 0) onDropFiles?.(files);
      }}
      onClick={(e) => {
        // Avoid navigating when a file drop just finished (browser may fire click).
        if (dropActive) e.preventDefault();
      }}
    >
      <div className="aspect-square bg-zinc-900">
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-700">
            {dropActive ? t("Drop") : "—"}
          </div>
        )}
      </div>
      <div className="space-y-0.5 px-2 py-1.5">
        <p className="truncate text-sm text-zinc-100 group-hover:text-white">
          {name}
        </p>
        <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500">
          {t(kind ?? "")}
          {stale ? (
            <span className="text-amber-400">
              <I18nText text="· needs update" />
            </span>
          ) : null}
        </p>
      </div>
    </Link>
  );
}
