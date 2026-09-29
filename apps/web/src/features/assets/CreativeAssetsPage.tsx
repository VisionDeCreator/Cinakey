import { api } from "@cinakey/backend";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AssetLibrary } from "@/features/assets/AssetLibrary";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { useCopilotContext } from "@/features/copilot/CopilotContext";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  character: "character",
  creature: "creature",
  location: "environment",
  prop: "product",
};

export function CreativeAssetsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") === "library" ? "library" : "grid";
  const { setContext } = useCopilotContext();
  const ensureStyle = useMutation(api.entities.ensureStyle);
  const createEntity = useMutation(api.entities.create);
  const updateProject = useMutation(api.projects.update);
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

  useEffect(() => {
    if (projectId) {
      setContext({ view: "assets", projectId, selectionIds: [] });
      void ensureStyle({ projectId: projectId as never });
    }
  }, [projectId, setContext, ensureStyle]);

  if (!projectId) return null;

  const creative = (entities ?? []).filter((e) => e.kind !== "style");
  const tipByEntity = new Map(
    (tips ?? [])
      .filter((t) => t.entityId && ["character", "creature", "environment", "product"].includes(t.type))
      .map((t) => [t.entityId as string, t]),
  );

  const onNewAsset = async () => {
    setCreating(true);
    try {
      const id = await createEntity({
        projectId: projectId as never,
        kind: "character",
        name: "New asset",
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
            Assets
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
            Library
          </button>
        </div>
        {view === "grid" ? (
          <Button
            type="button"
            size="sm"
            disabled={creating}
            onClick={() => void onNewAsset()}
          >
            {creating ? "…" : "New asset"}
          </Button>
        ) : null}
      </div>

      {view === "library" ? (
        <AssetLibrary projectId={projectId} title="Library" />
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-4 border border-zinc-800 p-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                Style reference
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
                    alt="Style reference"
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
              Applied to every image.
            </p>
          </div>

          {creative.length === 0 ? (
            <p className="text-sm text-zinc-500">No assets yet.</p>
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
                  />
                );
              })}
            </div>
          )}
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
}: {
  name: string;
  kind: string;
  thumbId?: string;
  stale?: boolean;
  href: string;
}) {
  const url = useQuery(
    api.storage.getAssetUrl,
    thumbId ? { assetId: thumbId as never } : "skip",
  );
  return (
    <Link
      to={href}
      className="group overflow-hidden border border-zinc-800 bg-zinc-950 hover:border-zinc-600"
    >
      <div className="aspect-square bg-zinc-900">
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-700">
            —
          </div>
        )}
      </div>
      <div className="space-y-0.5 px-2 py-1.5">
        <p className="truncate text-sm text-zinc-100 group-hover:text-white">
          {name}
        </p>
        <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500">
          {kind}
          {stale ? (
            <span className="text-amber-400">· needs update</span>
          ) : null}
        </p>
      </div>
    </Link>
  );
}
