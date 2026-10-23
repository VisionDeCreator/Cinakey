import { api, type Doc, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
const selectClass =
  "min-w-0 rounded border border-zinc-700 bg-zinc-950 p-2 text-sm";

export function ResourceLibrary({
  seriesId,
  projectId,
  archived = false,
}: {
  seriesId: Id<"series">;
  projectId?: Id<"projects">;
  archived?: boolean;
}) {
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const page = useQuery(api.resources.list, {
    seriesId,
    cursor,
    includeArchived: !projectId,
  });
  const bindings = useQuery(
    api.resources.listForProject,
    projectId ? { projectId } : "skip",
  );
  const projects = useQuery(api.projects.listMine, projectId ? "skip" : {});
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
  async function upload(files: FileList | null) {
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
        const result = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!result.ok) throw new Error(`Upload failed: ${file.name}`);
        const { storageId } = (await result.json()) as {
          storageId: Id<"_storage">;
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
      setCursor(undefined);
      setPrevious([]);
    });
  }
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-medium">Shared creative library</h2>
        <p className="mt-1 text-sm text-zinc-400">
          {projectId
            ? "Choose a version to use in this episode. New versions are adopted explicitly; existing edits keep their files."
            : "Reusable media, characters, locations, props and style. Episodes share the original files."}
        </p>
      </div>
      {!projectId && !archived && (
        <div className="space-y-3 rounded-lg border border-zinc-800 p-4">
          <label className="block text-sm">
            Upload shared media
            <input
              aria-label="Upload shared media"
              type="file"
              accept="image/*,video/*,audio/*"
              multiple
              disabled={busy || (containsLikeness && !consent)}
              className="mt-2 block text-xs"
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
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setDraft(emptyDraft);
              setEditing(!editing);
            }}
          >
            Create resource / promote existing work
          </Button>
          {editing && (
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
              <select
                aria-label="Resource kind"
                className={selectClass}
                disabled={!!draft.resourceId}
                value={draft.kind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    kind: e.target.value as Kind,
                    sourceEntityId: undefined,
                  })
                }
              >
                {[
                  "media",
                  "character",
                  "creature",
                  "location",
                  "prop",
                  "style",
                ].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <Textarea
                aria-label="Resource description"
                placeholder="Description, character details or visual direction"
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
              <select
                aria-label="Source project"
                className={selectClass}
                value={sourceProject}
                onChange={(e) => setSourceProject(e.target.value)}
              >
                <option value="">
                  Select a project to promote its files or entities
                </option>
                {projects?.map(({ project }) => (
                  <option key={project._id} value={project._id}>
                    {project.title}
                  </option>
                ))}
              </select>
              {!!entities?.length && (
                <select
                  aria-label="Promote entity"
                  className={selectClass}
                  value=""
                  onChange={(e) => {
                    const entity = entities.find(
                      (row) => row._id === e.target.value,
                    );
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
                  <option value="">
                    Use an existing character/location/prop definition
                  </option>
                  {entities.map((entity) => (
                    <option key={entity._id} value={entity._id}>
                      {entity.name} ({entity.kind})
                    </option>
                  ))}
                </select>
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
                <Button disabled={busy || !draft.name.trim()}>
                  Publish {draft.resourceId ? "new version" : "resource"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="text-sm text-zinc-400">
          {message}
        </p>
      )}
      {page === undefined ? (
        <p className="text-sm text-zinc-400">Loading library…</p>
      ) : page.items.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No shared resources on this page.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {page.items.map(
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
                  disabled={busy || archived}
                  onAdopt={(versionId) =>
                    void run(async () => {
                      await adopt({ projectId: projectId!, versionId });
                      setMessage(
                        "Added to this episode. Existing versions and edits were kept.",
                      );
                    })
                  }
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
                    void run(() =>
                      archive({
                        resourceId: resource._id,
                        archived: !resource.archivedAt,
                      }),
                    )
                  }
                />
              ),
          )}
        </div>
      )}
      <div className="flex gap-2">
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
  onEdit,
  onArchive,
}: {
  resource: Doc<"libraryResources">;
  version: Doc<"resourceVersions">;
  projectId?: Id<"projects">;
  adopted: Set<Id<"resourceVersions">>;
  disabled: boolean;
  onAdopt: (versionId: Id<"resourceVersions">) => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState(false);
  const versions = useQuery(
    api.resources.versions,
    history ? { resourceId: resource._id } : "skip",
  );
  const files = useQuery(
    api.resources.assetUrls,
    preview ? { versionId: version._id } : "skip",
  );
  return (
    <article className="space-y-3 rounded-lg border border-zinc-800 p-4">
      <div>
        <p className="text-[10px] uppercase text-zinc-500">
          {resource.kind} · v{version.version}
          {resource.archivedAt ? " · Archived" : ""}
        </p>
        <h3 className="font-medium">{version.name}</h3>
        <p className="mt-1 line-clamp-3 text-xs text-zinc-400">
          {version.description}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPreview(!preview)}
        >
          {preview ? "Hide files" : `Preview ${version.assetIds.length} files`}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setHistory(!history)}
        >
          Versions
        </Button>
      </div>
      {preview &&
        files?.map(
          (file) =>
            file?.url && (
              <div key={file._id}>
                {file.type === "image" || file.type === "logo" ? (
                  <img
                    src={file.url}
                    alt={file.name}
                    loading="lazy"
                    className="max-h-40 w-full rounded object-contain"
                  />
                ) : file.type === "video" ? (
                  <video
                    src={file.url}
                    controls
                    preload="metadata"
                    className="max-h-40 w-full"
                  />
                ) : (
                  <audio
                    src={file.url}
                    controls
                    preload="none"
                    className="w-full"
                  />
                )}
              </div>
            ),
        )}
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
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || !!resource.archivedAt}
            onClick={onEdit}
          >
            Publish revision
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={onArchive}
          >
            {resource.archivedAt ? "Restore" : "Archive"}
          </Button>
        </div>
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
    </article>
  );
}
