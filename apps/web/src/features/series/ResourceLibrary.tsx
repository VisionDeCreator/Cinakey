import { DetailDrawer } from "@/components/DetailDrawer";
import { uploadMedia } from "../../lib/api/uploadMedia";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { api, type Doc, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Layers,
  MoreHorizontal,
  Plus,
  Search,
  Upload,
  Image as ImageIcon,
  Music,
  Film,
  UserRound,
  MapPin,
  Box,
  Palette,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

type Kind = Doc<"libraryResources">["kind"];
type Draft = {
  sourceEntityId?: Id<"entities">;
  resourceId?: Id<"libraryResources">;
  expectedVersionId?: Id<"resourceVersions">;
  name: string;
  description: string;
  kind: Kind;
  assetIds: Id<"assets">[];
};
const emptyDraft: Draft = {
  name: "",
  description: "",
  kind: "media",
  assetIds: [],
};
const kinds: Kind[] = [
  "media",
  "character",
  "creature",
  "location",
  "prop",
  "style",
];
const kindLabels: Record<Kind, string> = {
  media: "Media",
  character: "Characters",
  creature: "Creatures",
  location: "Locations",
  prop: "Props",
  style: "Style",
};

export function ResourceLibrary({
  seriesId,
  projectId,
  archived = false,
}: {
  seriesId: Id<"series">;
  projectId?: Id<"projects">;
  archived?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [kind, setKind] = useState<Kind | "all">("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const page = useQuery(api.resources.list, {
    seriesId,
    cursor,
    includeArchived: !projectId && showArchived,
  });
  const bindings = useQuery(
    api.resources.listForProject,
    projectId ? { projectId } : "skip",
  );
  const { workspaceId } = useWorkspace();
  const projects = useQuery(
    api.projects.listMine,
    projectId ? "skip" : workspaceId ? { workspaceId } : {},
  );
  const [sourceProject, setSourceProject] = useState("");
  const assets = useQuery(
    api.assets.list,
    sourceProject ? { projectId: sourceProject as Id<"projects"> } : "skip",
  );
  const entities = useQuery(
    api.entities.listForProject,
    sourceProject ? { projectId: sourceProject as Id<"projects"> } : "skip",
  );
  const publish = useMutation(api.resources.publish);
  const adopt = useMutation(api.resources.useInProject);
  const archive = useMutation(api.resources.setArchived);
  const { canWrite, canManage } = useWorkspace();
  const canEdit = !projectId && !archived && canManage && canWrite !== false;
  const uploadUrl = useMutation(api.resources.createUploadUrl);
  const completeUpload = useMutation(api.resources.completeUpload);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [containsLikeness, setContainsLikeness] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  const candidateIds = [
    ...new Set([
      ...(assets ?? []).map((a) => a._id),
      ...(page?.items ?? []).flatMap((r) => r.version?.assetIds ?? []),
      ...draft.assetIds,
    ]),
  ];
  const names = new Map((assets ?? []).map((a) => [a._id, a.name]));
  for (const row of page?.items ?? [])
    for (const id of row.version?.assetIds ?? [])
      if (!names.has(id)) names.set(id, row.version!.name);
  async function upload(files: FileList | File[] | null) {
    if (!files) return;
    const values = [...files];
    await run(async () => {
      for (const file of values) {
        const type = file.type.startsWith("image/")
          ? "image"
          : file.type.startsWith("video/")
            ? "video"
            : file.type.startsWith("audio/")
              ? "music"
              : null;
        if (!type) throw new Error(`Unsupported file: ${file.name}`);
        if (
          file.size >
          (type === "image" ? 25 : type === "video" ? 500 : 50) * 1024 * 1024
        )
          throw new Error(`File too large: ${file.name}`);
        const url = await uploadUrl({ seriesId });
        const result = await uploadMedia(url, file);
        if (!result.ok) throw new Error(`Upload failed: ${file.name}`);
        const { storageId } = (await result.json()) as {
          storageId: Id<"_storage" | "r2Files">;
        };
        await completeUpload({
          seriesId,
          storageId,
          name: file.name,
          type,
          containsLikeness,
          likenessConsent: containsLikeness ? consent : undefined,
        });
      }
      setMessage("Files added to the shared library.");
      setUploadOpen(false);
      setCursor(undefined);
      setPrevious([]);
    });
  }
  const visible = page?.items.filter(
    ({ resource, version }) =>
      version &&
      (kind === "all" || resource.kind === kind) &&
      `${version.name} ${version.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Shared creative library</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {projectId
              ? "Choose a version to use in this episode. New versions are adopted explicitly; existing edits keep their files."
              : "Reusable media, characters, locations, props and style for every episode."}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setDraft(emptyDraft);
                setSourceProject("");
                setEditing(true);
              }}
            >
              <Plus />
              Create resource
            </Button>
            <Button disabled={busy} onClick={() => setUploadOpen(true)}>
              <Upload />
              Upload media
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-xs text-zinc-400">
        <Layers className="size-4 shrink-0" />
        Episodes keep their chosen versions. Publish updates when your resources
        evolve.
      </div>
      {canEdit && (
        <>
          <Dialog
            open={uploadOpen}
            onOpenChange={(open) => {
              if (!busy) setUploadOpen(open);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload shared media</DialogTitle>
                <DialogDescription>
                  Add images, video, or audio to this series.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {message && (
                  <p role="status" className="text-sm text-zinc-400">
                    {message}
                  </p>
                )}
                <label
                  className="block text-sm"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!busy && !(containsLikeness && !consent))
                      void upload(event.dataTransfer.files);
                  }}
                >
                  Drop files here or choose shared media
                  <input
                    aria-label="Upload shared media"
                    type="file"
                    accept="image/*,video/*,audio/*"
                    multiple
                    disabled={busy || (containsLikeness && !consent)}
                    className="mt-3 block w-full rounded-xl border border-dashed border-zinc-700 p-4 text-xs text-zinc-400 file:mr-3 file:rounded-full file:border-0 file:bg-zinc-800 file:px-4 file:py-2 file:text-zinc-100"
                    onChange={(e) => {
                      void upload(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={containsLikeness}
                    onChange={(e) => setContainsLikeness(e.target.checked)}
                  />
                  These files depict real people
                </label>
                {containsLikeness && (
                  <label className="flex items-center gap-2 text-xs text-zinc-400">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    I have consent to use their likenesses
                  </label>
                )}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog
            open={editing}
            onOpenChange={(open) => {
              if (!busy) setEditing(open);
            }}
          >
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {draft.resourceId ? "Edit" : "Create resource"}
                </DialogTitle>
                <DialogDescription>
                  Define a reusable resource or promote existing work from a
                  project.
                </DialogDescription>
              </DialogHeader>
              <form
                className="grid gap-3 border-t border-zinc-800 pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await publish({ seriesId, ...draft });
                    setEditing(false);
                    setDraft(emptyDraft);
                    setMessage(
                      "Resource version published. Episodes remain pinned to their adopted versions.",
                    );
                  });
                }}
              >
                <Input
                  aria-label="Resource name"
                  placeholder="Resource name"
                  required
                  maxLength={200}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                <Select
                  disabled={!!draft.resourceId || busy}
                  value={draft.kind}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      kind: value as Kind,
                      sourceEntityId: undefined,
                    })
                  }
                >
                  <SelectTrigger aria-label="Resource kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {kinds.map((value) => (
                      <SelectItem key={value} value={value}>
                        {kindLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Textarea
                  aria-label="Resource description"
                  placeholder="Description, character details or visual direction"
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
                <Select
                  value={sourceProject || "none"}
                  disabled={busy}
                  onValueChange={(value) =>
                    setSourceProject(value === "none" ? "" : value)
                  }
                >
                  <SelectTrigger aria-label="Source project">
                    <SelectValue placeholder="Choose a source project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No source project</SelectItem>
                    {projects?.map(({ project }) => (
                      <SelectItem key={project._id} value={project._id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {!!entities?.length && (
                  <Select
                    value=""
                    onValueChange={(value) => {
                      const entity = entities.find((row) => row._id === value);
                      if (entity)
                        setDraft({
                          ...draft,
                          sourceEntityId: entity._id,
                          name: entity.name,
                          kind: entity.kind,
                          description: entity.description ?? "",
                          assetIds: entity.lockedReferenceAssetIds,
                        });
                    }}
                  >
                    <SelectTrigger aria-label="Promote entity">
                      <SelectValue placeholder="Choose an existing definition" />
                    </SelectTrigger>
                    <SelectContent>
                      {entities.map((entity) => (
                        <SelectItem key={entity._id} value={entity._id}>
                          {entity.name} ({entity.kind})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <fieldset className="max-h-48 space-y-1 overflow-y-auto">
                  <legend className="mb-2 text-xs text-zinc-400">
                    Files / reference images (up to 32)
                  </legend>
                  {candidateIds.map((id) => (
                    <label key={id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={draft.assetIds.includes(id)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            assetIds: e.target.checked
                              ? [...draft.assetIds, id]
                              : draft.assetIds.filter((value) => value !== id),
                          })
                        }
                      />
                      {names.get(id) ?? "Pinned reference"}
                    </label>
                  ))}
                </fieldset>
                <div className="flex gap-2">
                  {message && (
                    <p role="status" className="text-sm text-zinc-400">
                      {message}
                    </p>
                  )}
                  <Button disabled={busy || !draft.name.trim()}>
                    {draft.resourceId ? "Save changes" : "Create resource"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </>
      )}
      {message && (
        <p role="status" className="text-sm text-zinc-400">
          {message}
        </p>
      )}
      {!projectId && (
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => {
              setShowArchived(event.target.checked);
              setCursor(undefined);
              setPrevious([]);
            }}
          />
          Show archived resources
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-zinc-400" />
          <Input
            aria-label="Search resources"
            placeholder="Search resources…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-full bg-transparent pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Resource categories">
          {(["all", ...kinds] as const).map((value) => (
            <Button
              key={value}
              variant="outline"
              size="sm"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={cn(
                kind === value &&
                  "border-[var(--color-studio-accent)] text-[var(--color-studio-accent)]",
              )}
            >
              {value === "all" ? "All resources" : kindLabels[value]}
            </Button>
          ))}
        </div>
      </div>
      {(previous.length > 0 || (page && !page.isDone)) && (
        <p className="text-xs text-zinc-400">
          Search and categories filter this page. Browse other pages for more
          resources.
        </p>
      )}
      {page === undefined ? (
        <p className="text-sm text-zinc-400">Loading library…</p>
      ) : visible?.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-700 px-6 py-14 text-center">
          <Layers className="mx-auto mb-3 size-8 text-zinc-500" />
          <p className="text-sm text-zinc-400">
            {search || kind !== "all"
              ? "No matching resources on this page."
              : "No shared resources yet. Upload media or create your first resource."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {visible?.map(
            ({ resource, version }) =>
              version && (
                <ResourceCard
                  key={resource._id}
                  resource={resource}
                  version={version}
                  projectId={projectId}
                  adopted={
                    new Set(bindings?.map((row) => row.binding.versionId) ?? [])
                  }
                  disabled={busy || archived || canWrite === false}
                  onAdopt={(versionId) =>
                    void run(async () => {
                      await adopt({ projectId: projectId!, versionId });
                      setMessage(
                        "Added to this episode. Existing versions and edits were kept.",
                      );
                    })
                  }
                  canEdit={canEdit}
                  notice={message}
                  onEdit={() => {
                    setDraft({
                      resourceId: resource._id,
                      expectedVersionId: version._id,
                      name: version.name,
                      description: version.description,
                      kind: resource.kind,
                      assetIds: version.assetIds,
                    });
                    setEditing(true);
                  }}
                  onArchive={() =>
                    void run(async () => {
                      await archive({
                        resourceId: resource._id,
                        archived: !resource.archivedAt,
                      });
                      setMessage(
                        resource.archivedAt
                          ? "Resource restored."
                          : "Resource deleted. Show archived resources to restore it. Existing episode references are preserved.",
                      );
                    })
                  }
                />
              ),
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!previous.length}
          onClick={() => {
            const next = [...previous];
            setCursor(next.pop());
            setPrevious(next);
          }}
        >
          Previous page
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!page || page.isDone}
          onClick={() => {
            setPrevious([...previous, cursor]);
            setCursor(page!.cursor);
          }}
        >
          Next page
        </Button>
      </div>
      {!!projectId && !!bindings?.length && (
        <div className="border-t border-zinc-800 pt-3">
          <h3 className="text-xs text-zinc-500">Pinned in this project</h3>
          <ul className="mt-2 space-y-1 text-xs text-zinc-400">
            {bindings.map((row) => (
              <li key={row.binding._id}>
                {row.version?.name} · v{row.version?.version}
                {row.resource?.currentVersionId !== row.binding.versionId
                  ? " · Newer version available in the library"
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
function ResourceCard({
  resource,
  version,
  projectId,
  adopted,
  disabled,
  onAdopt,
  canEdit,
  notice,
  onEdit,
  onArchive,
}: {
  resource: Doc<"libraryResources">;
  version: Doc<"resourceVersions">;
  projectId?: Id<"projects">;
  adopted: Set<Id<"resourceVersions">>;
  disabled: boolean;
  canEdit: boolean;
  notice?: string;
  onAdopt: (versionId: Id<"resourceVersions">) => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const versions = useQuery(
    api.resources.versions,
    history ? { resourceId: resource._id } : "skip",
  );
  const files = useQuery(
    api.resources.assetUrls,
    version.assetIds.length ? { versionId: version._id } : "skip",
  );
  const cover = files?.find(
    (file) => file?.url && (file.type === "image" || file.type === "logo"),
  );
  const Icon =
    resource.kind === "character" || resource.kind === "creature"
      ? UserRound
      : resource.kind === "location"
        ? MapPin
        : resource.kind === "prop"
          ? Box
          : resource.kind === "style"
            ? Palette
            : files?.some((file) => file?.type === "video")
              ? Film
              : files?.some(
                    (file) => file?.type === "music" || file?.type === "audio",
                  )
                ? Music
                : ImageIcon;
  return (
    <article className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
      <button
        type="button"
        aria-label={`Preview ${version.name}`}
        onClick={() => {
          setPreview(true);
          setHistory(false);
        }}
        className="flex aspect-video w-full items-center justify-center overflow-hidden bg-[var(--color-studio-panel)] focus-visible:outline-[var(--color-studio-accent)]"
      >
        {cover?.url ? (
          <img
            src={cover.url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <Icon className="size-12 text-[var(--color-studio-accent)] opacity-60" />
        )}
      </button>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate font-medium">
            {version.name}
          </h3>
          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] capitalize text-zinc-400">
            {resource.kind}
          </span>
          <span className="text-xs text-zinc-400">v{version.version}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${version.name}`}
                className="size-7"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  setPreview(true);
                  setHistory(false);
                }}
              >
                View resource details
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setPreview(true);
                  setHistory(true);
                }}
              >
                Versions
              </DropdownMenuItem>
              {canEdit && (
                <>
                  <DropdownMenuItem
                    disabled={disabled || !!resource.archivedAt}
                    onSelect={onEdit}
                  >
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={disabled} onSelect={onArchive}>
                    {resource.archivedAt ? "Restore" : "Delete"}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="line-clamp-2 text-xs text-zinc-400">
          {version.description || "Shared across this series."}
          {resource.archivedAt ? " · Archived" : ""}
        </p>
        {projectId ? (
          <Button
            size="sm"
            disabled={
              disabled || adopted.has(version._id) || !!resource.archivedAt
            }
            onClick={() => onAdopt(version._id)}
          >
            {adopted.has(version._id)
              ? "Current version added"
              : "Use current version"}
          </Button>
        ) : null}
      </div>
      <DetailDrawer
        open={preview}
        onOpenChange={setPreview}
        eyebrow="SHARED RESOURCE"
        title={version.name}
        description={`${resource.kind} · v${version.version}${resource.archivedAt ? " · Archived" : ""}`}
        footer={
          canEdit ? (
            <>
              <Button variant="ghost" disabled={disabled} onClick={onArchive}>
                {resource.archivedAt ? "Restore resource" : "Delete resource"}
              </Button>
              <Button
                disabled={disabled || !!resource.archivedAt}
                onClick={() => {
                  setPreview(false);
                  onEdit();
                }}
              >
                Edit
              </Button>
            </>
          ) : projectId ? (
            <Button
              disabled={
                disabled || adopted.has(version._id) || !!resource.archivedAt
              }
              onClick={() => onAdopt(version._id)}
            >
              {adopted.has(version._id)
                ? "Current version added"
                : "Use current version"}
            </Button>
          ) : undefined
        }
      >
        {cover?.url ? (
          <img
            src={cover.url}
            alt={version.name}
            className="max-h-64 w-full rounded-2xl bg-zinc-950 object-contain"
          />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-2xl bg-zinc-950">
            <Icon className="size-12 text-[var(--color-studio-accent)] opacity-60" />
          </div>
        )}
        <div className="flex gap-6 border-b border-zinc-800">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={history === value}
              onClick={() => setHistory(value)}
              className={cn(
                "border-b-2 pb-3 text-sm",
                history === value
                  ? "border-[var(--color-studio-accent)]"
                  : "border-transparent text-zinc-400",
              )}
            >
              {value ? "Versions" : "Details"}
            </button>
          ))}
        </div>
        {notice && (
          <p role="status" className="text-sm text-zinc-400">
            {notice}
          </p>
        )}
        {!history && (
          <>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Name</h3>
              <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm">
                {version.name}
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Description</h3>
              <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-400">
                {version.description || "No description yet."}
              </p>
            </div>
            <h3 className="text-sm font-medium">Reference files</h3>
            {files?.map(
              (file) =>
                file?.url && (
                  <div key={file._id}>
                    <Button
                      variant="outline"
                      onClick={() => setPreviewFile(file._id)}
                    >
                      Preview {file.name}
                    </Button>
                  </div>
                ),
            )}

            {!version.assetIds.length && (
              <p className="text-sm text-zinc-400">No reference files.</p>
            )}
            <div className="flex justify-between text-sm">
              <span>Current version</span>
              <span>v{version.version}</span>
            </div>
            <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400">
              Episodes keep their adopted versions. Editing creates a new
              version; existing episode files are preserved. Deleted resources
              can be restored using the archived filter.
            </p>
          </>
        )}
        {history && versions === undefined && (
          <p role="status" className="text-sm text-zinc-400">
            Loading versions…
          </p>
        )}
        {history && (
          <ul className="space-y-2 text-xs text-zinc-400">
            {versions?.map((item) => (
              <li
                key={item._id}
                className="flex items-center justify-between gap-2"
              >
                <span>
                  {item.name} · v{item.version}
                </span>
                {projectId && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      disabled || adopted.has(item._id) || !!resource.archivedAt
                    }
                    onClick={() => onAdopt(item._id)}
                  >
                    {adopted.has(item._id) ? "Added" : "Use version"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DetailDrawer>
      <Dialog
        open={previewFile !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewFile(null);
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {files?.find((file) => file?._id === previewFile)?.name ??
                "File preview"}
            </DialogTitle>
            <DialogDescription>Shared resource file preview</DialogDescription>
          </DialogHeader>
          {files
            ?.filter((file) => file?._id === previewFile)
            .map(
              (file) =>
                file?.url && (
                  <div key={file._id}>
                    {file.type === "image" || file.type === "logo" ? (
                      <img
                        src={file.url}
                        alt={file.name}
                        className="max-h-[70vh] w-full object-contain"
                      />
                    ) : file.type === "video" ? (
                      <video
                        src={file.url}
                        controls
                        className="max-h-[70vh] w-full"
                      />
                    ) : (
                      <audio src={file.url} controls className="w-full" />
                    )}
                  </div>
                ),
            )}
        </DialogContent>
      </Dialog>
    </article>
  );
}
