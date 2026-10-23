import { api, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ResourceLibrary } from "./ResourceLibrary";

export function EpisodeSeriesPanel({
  projectId,
  seriesId,
}: {
  projectId: Id<"projects">;
  seriesId: Id<"series">;
}) {
  const data = useQuery(api.series.get, { seriesId });
  const defaults = useMutation(api.series.applyDefaults);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  if (!data) return null;
  const episode = data.episodes.find((e) => e._id === projectId);
  return (
    <div className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-6 py-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Link
          to={`/series/${seriesId}`}
          className="text-zinc-400 hover:underline"
        >
          {data.series.title}
        </Link>
        <select
          aria-label="Switch episode"
          className="max-w-56 rounded border border-zinc-800 bg-zinc-950 p-1"
          value={projectId}
          onChange={(e) => void navigate(`/projects/${e.target.value}/video`)}
        >
          {data.episodes.map((e) => (
            <option key={e._id} value={e._id}>
              Ep {e.episodeNumber}: {e.title}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>
          {open ? "Close series library" : "Series library"}
        </Button>
        {episode?.seriesSettingsVersion !== data.series.settingsVersion && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await defaults({ projectId });
                setMessage(
                  "Series style notes and rules adopted. Output format and existing work were kept.",
                );
              } catch (err) {
                setMessage(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            Adopt latest style & rules
          </Button>
        )}
        {message && (
          <span role="status" className="text-zinc-400">
            {message}
          </span>
        )}
      </div>
      {open && (
        <div className="mt-3 max-h-[55vh] overflow-auto pb-3">
          <ResourceLibrary
            seriesId={seriesId}
            projectId={projectId}
            archived={!!data.series.archivedAt}
          />
        </div>
      )}
    </div>
  );
}
