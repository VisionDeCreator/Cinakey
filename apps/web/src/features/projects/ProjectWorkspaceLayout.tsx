import { EpisodeSeriesPanel } from "@/features/series/EpisodeSeriesPanel";
import { api } from "@cinakey/backend";
import { useQuery } from "@/lib/api/hooks";
import {
  NavLink,
  Navigate,
  Outlet,
  useParams,
  useLocation,
} from "react-router-dom";
import { ArrowLeft, Clapperboard } from "lucide-react";

export function ProjectWorkspaceLayout() {
  const { projectId } = useParams();
  const location = useLocation();
  const project = useQuery(
    api.projects.get,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const activeJobs = useQuery(
    api.shotGeneration.listActiveJobsForProject,
    projectId ? { projectId: projectId as never } : "skip",
  );
  if (!projectId) return <Navigate to="/projects" replace />;
  if (project === undefined)
    return <p className="p-6 text-sm text-zinc-500">Loading project…</p>;
  if (!project)
    return (
      <div className="p-6">
        <h1>Project not found</h1>
        <NavLink to="/projects">Back to projects</NavLink>
      </div>
    );
  const auxiliary = /\/(assets|blockout)(\/|$)/.test(location.pathname);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {project.seriesId && (
        <EpisodeSeriesPanel
          key={projectId}
          projectId={project._id}
          seriesId={project.seriesId}
        />
      )}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-[var(--color-studio-panel)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Clapperboard className="size-5 shrink-0 text-[var(--color-studio-accent)]" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{project.title}</h1>
            <p className="text-xs text-zinc-400">
              {project.seriesId ? `Episode ${project.episodeNumber} · ` : ""}
              Creative workspace
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-zinc-400">
            {activeJobs?.length
              ? `${activeJobs.length} generating`
              : "Script · References · Generations · Edit"}
          </span>
          {auxiliary ? (
            <NavLink
              className="flex items-center gap-1 text-[#80cfff]"
              to={`/projects/${projectId}/studio${location.search}`}
            >
              <ArrowLeft size={14} />
              Workspace
            </NavLink>
          ) : (
            <NavLink
              className="text-zinc-300 hover:text-[#80cfff]"
              to={`/projects/${projectId}/assets${location.search}`}
            >
              Manage references
            </NavLink>
          )}
        </div>
      </header>
      <div
        className={
          auxiliary
            ? "min-h-0 flex-1 overflow-auto p-4"
            : "flex min-h-0 flex-1 flex-col overflow-hidden"
        }
      >
        <Outlet />
      </div>
    </div>
  );
}
