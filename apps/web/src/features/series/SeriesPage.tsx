import { api, type Doc, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ResourceLibrary } from "./ResourceLibrary";

export function SeriesPage() {
  const { seriesId } = useParams();
  const data = useQuery(
    api.series.get,
    seriesId ? { seriesId: seriesId as Id<"series"> } : "skip",
  );
  if (!data) return <p>Loading series…</p>;
  return (
    <SeriesContent
      key={data.series._id}
      series={data.series}
      episodes={data.episodes}
    />
  );
}
function SeriesContent({
  series,
  episodes,
}: {
  series: Doc<"series">;
  episodes: Doc<"projects">[];
}) {
  const projects = useQuery(api.projects.listMine, {});
  const create = useMutation(api.series.createEpisode);
  const membership = useMutation(api.series.setMembership);
  const archive = useMutation(api.series.setArchived);
  const reorder = useMutation(api.series.reorderEpisodes);
  const archiveEpisode = useMutation(api.projects.archive);
  const restoreEpisode = useMutation(api.projects.unarchive);
  const navigate = useNavigate();
  const [tab, setTab] = useState<"episodes" | "library" | "settings">(
    "episodes",
  );
  const [name, setName] = useState("");
  const [existing, setExisting] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <Link to="/series" className="text-sm text-zinc-400 hover:underline">
        ← All series
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{series.title}</h1>
          <p className="text-sm text-zinc-400">
            {series.archivedAt
              ? "Archived · Existing episodes remain accessible"
              : series.description}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(() =>
              archive({ seriesId: series._id, archived: !series.archivedAt }),
            )
          }
        >
          {series.archivedAt ? "Restore series" : "Archive series"}
        </Button>
      </div>
      <nav className="flex gap-2" aria-label="Series sections">
        {(["episodes", "library", "settings"] as const).map((value) => (
          <Button
            key={value}
            variant={tab === value ? "default" : "outline"}
            onClick={() => setTab(value)}
          >
            {value === "library"
              ? "Shared library"
              : value === "episodes"
                ? "Episodes"
                : "Settings"}
          </Button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {tab === "library" ? (
        <ResourceLibrary seriesId={series._id} archived={!!series.archivedAt} />
      ) : tab === "settings" ? (
        <SeriesSettings key={series.settingsVersion} series={series} />
      ) : (
        <>
          {!series.archivedAt && (
            <div className="grid gap-4 md:grid-cols-2">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const id = await create({
                      seriesId: series._id,
                      title: name,
                    });
                    void navigate(`/projects/${id}/video`);
                  });
                }}
              >
                <Input
                  aria-label="Episode title"
                  placeholder="Episode title"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <Button disabled={busy || !name.trim()}>New episode</Button>
              </form>
              <div className="flex gap-2">
                <select
                  aria-label="Standalone project"
                  value={existing}
                  onChange={(e) => setExisting(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 text-sm"
                >
                  <option value="">Choose a standalone project</option>
                  {projects
                    ?.filter((p) => !p.project.seriesId)
                    .map(({ project }) => (
                      <option key={project._id} value={project._id}>
                        {project.title}
                      </option>
                    ))}
                </select>
                <Button
                  variant="outline"
                  disabled={busy || !existing}
                  onClick={() =>
                    void run(async () => {
                      await membership({
                        projectId: existing as Id<"projects">,
                        seriesId: series._id,
                      });
                      setExisting("");
                    })
                  }
                >
                  Attach project
                </Button>
              </div>
            </div>
          )}
          <p className="text-xs text-zinc-500">
            New episodes copy series defaults. Attaching a project keeps its
            settings and content.
          </p>
          {episodes.length === 0 && (
            <p className="text-sm text-zinc-400">No episodes yet.</p>
          )}
          <ul className="space-y-2">
            {episodes.map((episode, index) => (
              <li
                key={episode._id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 p-4"
              >
                <Link
                  to={`/projects/${episode._id}/video`}
                  className="min-w-0 flex-1"
                >
                  <span className="text-xs text-zinc-500">
                    EPISODE {episode.episodeNumber}
                  </span>
                  <h2 className="font-medium">
                    {episode.title}
                    {episode.archivedAt ? " · Archived" : ""}
                  </h2>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || index === 0}
                  onClick={() =>
                    void run(() => {
                      const ids = episodes.map((e) => e._id);
                      [ids[index - 1], ids[index]] = [
                        ids[index]!,
                        ids[index - 1]!,
                      ];
                      return reorder({ seriesId: series._id, projectIds: ids });
                    })
                  }
                >
                  Move up
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      episode.archivedAt
                        ? restoreEpisode({ projectId: episode._id })
                        : archiveEpisode({ projectId: episode._id }),
                    )
                  }
                >
                  {episode.archivedAt ? "Restore" : "Archive"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      membership({ projectId: episode._id, seriesId: null }),
                    )
                  }
                >
                  Make standalone
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
function SeriesSettings({ series }: { series: Doc<"series"> }) {
  const update = useMutation(api.series.update);
  const [title, setTitle] = useState(series.title);
  const [description, setDescription] = useState(series.description);
  const [style, setStyle] = useState(series.styleNotes);
  const [rules, setRules] = useState(series.rules.join("\n"));
  const [aspect, setAspect] = useState(series.aspectRatio);
  const [fps, setFps] = useState(series.fps);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid max-w-2xl gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          await update({
            seriesId: series._id,
            title,
            description,
            styleNotes: style,
            rules: rules
              .split("\n")
              .map((r) => r.trim())
              .filter(Boolean),
            aspectRatio: aspect as "16:9" | "9:16" | "1:1",
            fps,
          });
          setMessage("Defaults saved. Existing episodes keep their settings.");
        } catch (err) {
          setMessage(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="grid gap-1 text-sm">
        Series name
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label className="grid gap-1 text-sm">
        Description
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="flex gap-4">
        <label className="grid gap-1 text-sm">
          Aspect ratio
          <select
            className="rounded border border-zinc-700 bg-zinc-950 p-2"
            value={aspect}
            onChange={(e) => setAspect(e.target.value)}
          >
            {["16:9", "9:16", "1:1"].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Frame rate
          <select
            className="rounded border border-zinc-700 bg-zinc-950 p-2"
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
          >
            {[24, 25, 30, 60].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        Visual style
        <Textarea value={style} onChange={(e) => setStyle(e.target.value)} />
      </label>
      <label className="grid gap-1 text-sm">
        Production rules (one per line)
        <Textarea value={rules} onChange={(e) => setRules(e.target.value)} />
      </label>
      <p className="text-xs text-zinc-500">
        Output format defaults apply to new episodes. Existing episodes can
        explicitly adopt updated style notes and rules.
      </p>
      {message && (
        <p role="status" className="text-sm text-zinc-400">
          {message}
        </p>
      )}
      <Button disabled={busy}>Save defaults</Button>
    </form>
  );
}
