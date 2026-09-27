import { api, type Id } from "@cinakey/backend";
import type { AssetType } from "@cinakey/shared";
import { useMutation, useQuery } from "convex/react";
import {
  LayoutGrid,
  List,
  Star,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { AssetDetailDrawer } from "@/features/assets/AssetDetailDrawer";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { cn } from "@/lib/utils";

const TYPES: AssetType[] = ["video", "image", "audio", "music", "logo"];

export function AssetLibrary({
  projectId,
  title = "Assets",
  description,
  requireProject = false,
}: {
  projectId?: string;
  title?: string;
  description?: string;
  /** When true, show project picker if projectId missing (global page). */
  requireProject?: boolean;
}) {
  const projects = useQuery(api.projects.listMine, {});
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(
    projectId,
  );
  const effectiveProjectId = projectId ?? selectedProjectId;

  const [view, setView] = useState<"grid" | "list">("grid");
  const [type, setType] = useState<string>("all");
  const [tag, setTag] = useState<string>("all");
  const [characterId, setCharacterId] = useState<string>("all");
  const [shotId, setShotId] = useState<string>("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState<Id<"assets"> | null>(
    null,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Debounce search lightly
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const filterOpts = useQuery(api.assets.filterOptions, {
    projectId: effectiveProjectId
      ? (effectiveProjectId as Id<"projects">)
      : undefined,
  });

  const assets = useQuery(api.assets.list, {
    projectId: effectiveProjectId
      ? (effectiveProjectId as Id<"projects">)
      : undefined,
    type: type === "all" ? undefined : (type as AssetType),
    tag: tag === "all" ? undefined : tag,
    characterId:
      characterId === "all"
        ? undefined
        : (characterId as Id<"entities">),
    shotId: shotId === "all" ? undefined : (shotId as Id<"shots">),
    starredOnly: starredOnly || undefined,
    query: debouncedSearch || undefined,
  });

  const { uploads, uploadFiles } = useAssetUpload(effectiveProjectId);
  const setStarred = useMutation(api.assets.setStarred);

  const canUpload = Boolean(effectiveProjectId);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    await uploadFiles(files);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-zinc-400">{description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!projectId ? (
            <Select
              value={selectedProjectId ?? "all"}
              onValueChange={(v) =>
                setSelectedProjectId(v === "all" ? undefined : v)
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {(projects ?? []).map(({ project }) => (
                  <SelectItem key={project._id} value={project._id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={!canUpload}
            onClick={() => fileRef.current?.click()}
            title={
              canUpload
                ? "Upload files"
                : "Select a project to upload"
            }
          >
            <Upload className="size-4" />
            Upload
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={(e) => {
              void onFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex border border-zinc-800">
            <Button
              variant={view === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="rounded-none"
              onClick={() => setView("grid")}
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="icon"
              className="rounded-none"
              onClick={() => setView("list")}
            >
              <List className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "border border-dashed border-zinc-700 px-4 py-6 text-center transition-colors",
          dragging && "border-zinc-400 bg-zinc-900/50",
          !canUpload && "opacity-50",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          if (canUpload) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (canUpload) void onFiles(e.dataTransfer.files);
        }}
      >
        <p className="text-sm text-zinc-400">
          {canUpload
            ? "Drag and drop video, images, or audio here"
            : requireProject
              ? "Select a project above to upload"
              : "Select a project to upload, or browse all assets below"}
        </p>
      </div>

      {uploads.length > 0 ? (
        <ul className="space-y-2">
          {uploads.map((u) => (
            <li key={u.id} className="text-sm">
              <div className="flex justify-between gap-2 text-zinc-300">
                <span className="truncate">{u.name}</span>
                <span className="shrink-0 text-zinc-500">
                  {u.status === "error"
                    ? u.error
                    : u.status === "done"
                      ? "Done"
                      : `${u.progress}%`}
                </span>
              </div>
              {u.status === "uploading" ? (
                <Progress value={u.progress} className="mt-1" />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search name or tags…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tag} onValueChange={setTag}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Tag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tags</SelectItem>
            {(filterOpts?.tags ?? []).map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={characterId} onValueChange={setCharacterId}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Character" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All characters</SelectItem>
            {(filterOpts?.characters ?? []).map((c) => (
              <SelectItem key={c._id} value={c._id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={shotId} onValueChange={setShotId}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Shot" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All shots</SelectItem>
            {(filterOpts?.shots ?? []).map((s) => (
              <SelectItem key={s._id} value={s._id}>
                {s.shotType} #{s.order + 1}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={starredOnly ? "secondary" : "outline"}
          size="sm"
          onClick={() => setStarredOnly((v) => !v)}
        >
          <Star className={starredOnly ? "fill-amber-400 text-amber-400" : undefined} />
          Starred
        </Button>
      </div>

      {assets === undefined ? (
        <p className="text-sm text-zinc-500">Loading assets…</p>
      ) : assets.length === 0 ? (
        <div className="border border-dashed border-zinc-700 px-6 py-12 text-center">
          <p className="text-sm text-zinc-300">No assets yet</p>
          <p className="mt-1 text-sm text-zinc-500">
            Upload footage, photos, or audio
            {effectiveProjectId
              ? ", or generate from the Dev generation page."
              : ". Pick a project to upload."}
          </p>
          {effectiveProjectId ? (
            <Button asChild variant="secondary" size="sm" className="mt-4">
              <Link to={`/projects/${effectiveProjectId}`}>
                Back to project overview
              </Link>
            </Button>
          ) : null}
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {assets.map((asset) => (
            <AssetGridItem
              key={asset._id}
              assetId={asset._id}
              name={asset.name}
              type={asset.type}
              starred={asset.starred}
              onOpen={() => {
                setSelectedAssetId(asset._id);
                setDrawerOpen(true);
              }}
              onToggleStar={() =>
                void setStarred({
                  assetId: asset._id,
                  starred: !asset.starred,
                })
              }
            />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800 border-y border-zinc-800">
          {assets.map((asset) => (
            <li
              key={asset._id}
              className="flex cursor-pointer items-center justify-between gap-3 py-3 hover:bg-zinc-900/40"
              onClick={() => {
                setSelectedAssetId(asset._id);
                setDrawerOpen(true);
              }}
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-100">
                  {asset.name}
                </p>
                <p className="text-xs text-zinc-500">
                  {asset.type} · {new Date(asset.updatedAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {asset.starred ? (
                  <Star className="size-4 fill-amber-400 text-amber-400" />
                ) : null}
                <Badge variant="outline">{asset.type}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AssetDetailDrawer
        assetId={selectedAssetId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}

function AssetGridItem({
  assetId,
  name,
  type,
  starred,
  onOpen,
  onToggleStar,
}: {
  assetId: Id<"assets">;
  name: string;
  type: string;
  starred: boolean;
  onOpen: () => void;
  onToggleStar: () => void;
}) {
  const url = useQuery(api.storage.getAssetUrl, { assetId });
  const showThumb = type === "image" || type === "logo" || type === "video";

  return (
    <div className="group relative overflow-hidden border border-zinc-800 bg-zinc-900/40 text-left transition-colors hover:border-zinc-600">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="aspect-video bg-zinc-950">
          {showThumb && url && type !== "video" ? (
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : showThumb && url && type === "video" ? (
            <video src={url} className="h-full w-full object-cover" muted />
          ) : (
            <div className="flex h-full items-center justify-center text-xs uppercase tracking-wide text-zinc-600">
              {type}
            </div>
          )}
        </div>
        <div className="p-2 pr-10">
          <p className="truncate text-sm text-zinc-100">{name}</p>
          <p className="text-xs text-zinc-500">{type}</p>
        </div>
      </button>
      <button
        type="button"
        className="absolute bottom-2 right-2 p-1 text-zinc-500 hover:text-amber-400"
        onClick={(e) => {
          e.stopPropagation();
          onToggleStar();
        }}
      >
        <Star
          className={cn("size-4", starred && "fill-amber-400 text-amber-400")}
        />
      </button>
    </div>
  );
}
