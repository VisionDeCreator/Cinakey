import { api } from "@cinakey/backend";
import type { EntityKind } from "@cinakey/shared";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCopilotContext } from "@/features/copilot/CopilotContext";

const SECTIONS: { kind: EntityKind; label: string }[] = [
  { kind: "style", label: "Style" },
  { kind: "character", label: "Characters" },
  { kind: "creature", label: "Creatures" },
  { kind: "location", label: "Locations" },
  { kind: "prop", label: "Props" },
];

export function LookDevPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const entities = useQuery(
    api.entities.listForProject,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const ensureStyle = useMutation(api.entities.ensureStyle);
  const createEntity = useMutation(api.entities.create);
  const { setContext } = useCopilotContext();

  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<
    "character" | "creature" | "location" | "prop"
  >("character");
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (projectId) {
      setContext({ view: "look-dev", projectId, selectionIds: [] });
      void ensureStyle({ projectId: projectId as never });
    }
  }, [projectId, setContext, ensureStyle]);

  if (!projectId) return null;

  const byKind = (kind: EntityKind) =>
    (entities ?? []).filter((e) => e.kind === kind);

  async function handleCreate() {
    const name = createName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const id = await createEntity({
        projectId: projectId as never,
        kind: createKind,
        name,
      });
      setCreateOpen(false);
      setCreateName("");
      navigate(`/projects/${projectId}/look-dev/${id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-8 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Look development</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Character, location, prop and style sheets with locked reference images.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => setCreateOpen(true)}
        >
          New entity
        </Button>
      </div>

      {entities === undefined ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        SECTIONS.map(({ kind, label }) => {
          const list = byKind(kind);
          return (
            <section key={kind} className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                {label}
              </h3>
              {list.length === 0 ? (
                <p className="text-sm text-zinc-600">None yet</p>
              ) : (
                <ul className="divide-y divide-zinc-800 border border-zinc-800">
                  {list.map((entity) => (
                    <li key={entity._id}>
                      <Link
                        to={`/projects/${projectId}/look-dev/${entity._id}`}
                        className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-zinc-900/60"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-zinc-100">
                            {entity.name}
                          </p>
                          {entity.description ? (
                            <p className="truncate text-sm text-zinc-500">
                              {entity.description}
                            </p>
                          ) : null}
                        </div>
                        <span className="shrink-0 text-xs text-zinc-500">
                          {entity.lockedReferenceAssetIds.length > 0
                            ? `${entity.lockedReferenceAssetIds.length} locked`
                            : "No locks"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create entity</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="entity-kind">Kind</Label>
              <select
                id="entity-kind"
                className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
                value={createKind}
                onChange={(e) =>
                  setCreateKind(
                    e.target.value as
                      | "character"
                      | "creature"
                      | "location"
                      | "prop",
                  )
                }
              >
                <option value="character">Character</option>
                <option value="creature">Creature</option>
                <option value="location">Location</option>
                <option value="prop">Prop</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="entity-name">Name</Label>
              <Input
                id="entity-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!createName.trim() || creating}
              onClick={() => void handleCreate()}
            >
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
