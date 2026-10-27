import { useWorkspace } from "@/features/workspaces/workspace-context";
import { api } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SeriesIndexPage() {
  const { workspaceId, canManage } = useWorkspace();
  const rows = useQuery(api.series.list, {
    includeArchived: true,
    ...(workspaceId ? { workspaceId } : {}),
  });
  const create = useMutation(api.series.create);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Series</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Multiple episodes, one shared creative library.
        </p>
      </div>
      {canManage && (
        <form
          className="flex max-w-xl gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const id = await create({
                title: name,
                ...(workspaceId ? { workspaceId } : {}),
              });
              void navigate(`/series/${id}`);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input
            aria-label="Series name"
            placeholder="Series name"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Button disabled={busy || !name.trim()}>New series</Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {rows === undefined ? (
        <p>Loading series…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No series yet. Standalone projects are available in{" "}
          <Link to="/projects" className="underline">
            Projects
          </Link>
          .
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <Link
              key={row._id}
              to={`/series/${row._id}`}
              className="rounded-lg border border-zinc-800 p-5 hover:border-zinc-600"
            >
              <h2 className="font-medium">
                {row.title}
                {row.archivedAt ? " · Archived" : ""}
              </h2>
              <p className="mt-2 line-clamp-2 text-sm text-zinc-400">
                {row.description || `${row.aspectRatio} · ${row.fps} fps`}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
