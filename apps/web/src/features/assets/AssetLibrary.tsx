import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AssetDetailDrawer } from "@/features/assets/AssetDetailDrawer";
import { useAssetUpload } from "@/features/assets/useAssetUpload";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { api, type Id } from "@cinakey/backend";
import type { AssetType } from "@cinakey/shared";
import {
  LayoutGrid,
  List,
  Star,
  Upload,
  MoreHorizontal,
  Music,
  Image as ImageIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

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
  const { workspaceId, canWrite } = useWorkspace();
  const projects = useQuery(
    api.projects.listMine,
    workspaceId ? { workspaceId } : {},
  );
  const [selectedProjectId, setSelectedProjectId] = useState<
    string | undefined
  >(projectId);
  const effectiveProjectId = projectId ?? selectedProjectId;

  const [view, setView] = useState<"grid" | "list">("grid");
  const [type, setType] = useState<string>("all");
  const [tag, setTag] = useState<string>("all");
  const [characterId, setCharacterId] = useState<string>("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [localSearch, setSearch] = useState("");
  const [params] = useSearchParams();
  const search = requireProject ? (params.get("q") ?? "") : localSearch;
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState<Id<"assets"> | null>(
    null,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Debounce search lightly
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const filterOpts = useQuery(api.assets.filterOptions, {
    ...(!projectId && workspaceId ? { workspaceId } : {}),
    projectId: effectiveProjectId
      ? (effectiveProjectId as Id<"projects">)
      : undefined,
  });

  const assets = useQuery(api.assets.list, {
    ...(!projectId && workspaceId ? { workspaceId } : {}),
    projectId: effectiveProjectId
      ? (effectiveProjectId as Id<"projects">)
      : undefined,
    type: type === "all" ? undefined : (type as AssetType),
    tag: tag === "all" ? undefined : tag,
    characterId:
      characterId === "all" ? undefined : (characterId as Id<"entities">),
    starredOnly: starredOnly || undefined,
    query: debouncedSearch || undefined,
  });

  const { uploads, uploadFiles } = useAssetUpload(effectiveProjectId);
  const setStarred = useMutation(api.assets.setStarred);

  const canUpload = canWrite !== false && Boolean(effectiveProjectId);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    await uploadFiles(files);
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {requireProject ? "Your assets" : title}
          </h1>
          {description || requireProject ? (
            <p className="mt-1 text-sm text-zinc-400">
              {description ??
                "Your footage, images and audio, together in one place."}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="lg"
            disabled={!canUpload}
            onClick={() => fileRef.current?.click()}
            title={canUpload ? "Upload files" : "Select a project to upload"}
          >
            <Upload className="size-4" />
            Upload assets
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
        </div>
      </div>
      {!projectId && (
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm text-zinc-300">Project</span>{" "}
          {!projectId ? (
            <Select
              value={selectedProjectId ?? "all"}
              onValueChange={(v) => {
                setSelectedProjectId(v === "all" ? undefined : v);
                setTag("all");
                setCharacterId("all");
              }}
            >
              <SelectTrigger
                aria-label="Project"
                className="w-full max-w-sm rounded-full bg-transparent"
              >
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
          <p className="text-xs text-zinc-400">
            Uploads are added to the selected project.
          </p>
          {effectiveProjectId && (
            <Link
              to={`/projects/${effectiveProjectId}/assets`}
              className="text-xs text-zinc-400 underline hover:text-zinc-100"
            >
              Open project assets ↗
            </Link>
          )}
        </div>
      )}

      <div
        className={cn(
          "rounded-2xl border border-dashed border-zinc-700 px-4 py-5 text-center transition-colors",
          dragging &&
            "border-[var(--color-studio-accent)] bg-[var(--color-studio-accent-soft)]",
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
        <Upload className="mx-auto mb-2 size-5 text-zinc-400" />
        <p className="text-sm text-zinc-400">
          {canUpload
            ? "Drag and drop video, images, or audio here"
            : requireProject
              ? "Select a project above to upload"
              : "Select a project to upload, or browse all assets below"}
        </p>
        {canUpload && (
          <button
            type="button"
            className="mt-1 text-xs text-[var(--color-studio-accent)]"
            onClick={() => fileRef.current?.click()}
          >
            or browse files
          </button>
        )}
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

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800">
        <div className="flex flex-wrap gap-5" aria-label="Asset categories">
          {["all", ...TYPES].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              onClick={() => setType(value)}
              className={cn(
                "border-b-2 px-1 pb-3 text-sm capitalize",
                type === value
                  ? "border-[var(--color-studio-accent)] text-zinc-100"
                  : "border-transparent text-zinc-400",
              )}
            >
              {value === "all"
                ? "All assets"
                : value === "image"
                  ? "Images"
                  : value === "logo"
                    ? "Logos"
                    : value}
            </button>
          ))}
        </div>
        <div className="mb-2 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={starredOnly}
            onClick={() => setStarredOnly((v) => !v)}
            className={cn(
              starredOnly &&
                "border-[var(--color-studio-accent)] text-[var(--color-studio-accent)]",
            )}
          >
            <Star className={starredOnly ? "fill-current" : undefined} />
            Favourites
          </Button>
          <div className="flex rounded-xl border border-zinc-800 p-0.5">
            {(["grid", "list"] as const).map((mode) => (
              <Button
                key={mode}
                variant="ghost"
                size="icon"
                aria-label={`${mode === "grid" ? "Grid" : "List"} view`}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
                className={cn(
                  "size-8 rounded-lg",
                  view === mode &&
                    "bg-[var(--color-studio-accent-soft)] text-[var(--color-studio-accent)]",
                )}
              >
                {mode === "grid" ? <LayoutGrid /> : <List />}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {!requireProject && (
          <Input
            aria-label="Search assets"
            placeholder="Search name or tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs rounded-full bg-transparent"
          />
        )}
        <Select value={tag} onValueChange={setTag}>
          <SelectTrigger
            aria-label="Filter by tag"
            className="w-48 rounded-full bg-transparent"
          >
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
          <SelectTrigger
            aria-label="Filter by character"
            className="w-52 rounded-full bg-transparent"
          >
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
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {assets === undefined ? (
        <p className="text-sm text-zinc-500">Loading assets…</p>
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-700 px-6 py-12 text-center">
          <p className="text-sm text-zinc-500">
            {search ||
            type !== "all" ||
            tag !== "all" ||
            characterId !== "all" ||
            starredOnly
              ? "No matching assets."
              : "No assets yet."}
          </p>
          {effectiveProjectId ? (
            <Button asChild variant="secondary" size="sm" className="mt-4">
              <Link to={`/projects/${effectiveProjectId}/assets`}>
                Back to project
              </Link>
            </Button>
          ) : null}
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {assets.map((asset) => (
            <AssetGridItem
              key={asset._id}
              assetId={asset._id}
              name={asset.name}
              type={asset.type}
              starred={asset.starred}
              tags={asset.tags}
              onOpen={() => {
                setSelectedAssetId(asset._id);
                setDrawerOpen(true);
              }}
              onToggleStar={() =>
                void setStarred({
                  assetId: asset._id,
                  starred: !asset.starred,
                }).catch(() =>
                  setError("Could not update favourites. Try again."),
                )
              }
            />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800 border-y border-zinc-800">
          {assets.map((asset) => (
            <li
              key={asset._id}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedAssetId(asset._id);
                  setDrawerOpen(true);
                }
              }}
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
                  <Star className="size-4 fill-[var(--color-studio-accent)] text-[var(--color-studio-accent)]" />
                ) : null}
                <Badge variant="outline">{asset.type}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}

      {assets && (
        <p className="text-xs text-zinc-400">
          {assets.length} {assets.length === 1 ? "asset" : "assets"}
        </p>
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
  tags,
  onOpen,
  onToggleStar,
}: {
  assetId: Id<"assets">;
  name: string;
  type: string;
  starred: boolean;
  tags?: string[];
  onOpen: () => void;
  onToggleStar: () => void;
}) {
  const url = useQuery(api.storage.getAssetUrl, { assetId });
  const showThumb = type === "image" || type === "logo" || type === "video";

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 text-left transition-colors hover:border-zinc-600">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Preview ${name}`}
        className="block w-full text-left"
      >
        <div className="aspect-video bg-zinc-950">
          {showThumb && url && type !== "video" ? (
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : showThumb && url && type === "video" ? (
            <video
              src={url}
              className="h-full w-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs uppercase tracking-wide text-zinc-600">
              {type === "music" || type === "audio" ? (
                <Music className="size-10 text-[var(--color-studio-accent)] opacity-70" />
              ) : (
                <ImageIcon className="size-10 text-zinc-500" />
              )}
            </div>
          )}
        </div>
        <div className="space-y-2 p-4 pr-20">
          <p className="truncate text-sm text-zinc-100">{name}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="rounded-full capitalize">
              {type}
            </Badge>
            {tags?.slice(0, 2).map((tag) => (
              <Badge key={tag} variant="muted" className="rounded-full">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </button>
      <button
        type="button"
        aria-label={`${starred ? "Remove" : "Add"} ${name} ${starred ? "from" : "to"} favourites`}
        aria-pressed={starred}
        className="absolute bottom-4 right-12 p-1 text-zinc-400 hover:text-[var(--color-studio-accent)]"
        onClick={(e) => {
          e.stopPropagation();
          onToggleStar();
        }}
      >
        <Star
          className={cn(
            "size-4",
            starred &&
              "fill-[var(--color-studio-accent)] text-[var(--color-studio-accent)]",
          )}
        />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${name}`}
            className="absolute bottom-3 right-3 size-8"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onOpen}>
            View asset details
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleStar}>
            {starred ? "Remove from favourites" : "Add to favourites"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
