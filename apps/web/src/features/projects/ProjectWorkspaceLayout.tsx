import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import { StoredExports } from "@/features/edit/StoredExports";
import { ProjectSettings } from "./ProjectSettings";
import { EpisodeSeriesPanel } from "@/features/series/EpisodeSeriesPanel";
import { useQuery } from "@/lib/api/hooks";
import { api } from "@dirrio/backend";
import { ArrowLeft, Clapperboard } from "lucide-react";
import {
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useParams,
} from "react-router-dom";

export function ProjectWorkspaceLayout() {
  useLocale();
  const { projectId } = useParams();
  const location = useLocation();
  const project = useQuery(
    api.projects.get,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const footage = useQuery(
    api.workspace.videos,
    project ? { projectId: project._id } : "skip",
  );
  const activeJobs = footage?.jobs.filter((job) =>
    ["queued", "submitted", "running"].includes(job.status),
  );
  if (!projectId) return <Navigate to="/projects" replace />;
  if (project === undefined)
    return (
      <p className="p-6 text-sm text-zinc-500">
        <I18nText text="Loading project…" />
      </p>
    );
  if (!project)
    return (
      <div className="p-6">
        <h1>
          <I18nText text="Project not found" />
        </h1>
        <NavLink to="/projects">
          <I18nText text="Back to projects" />
        </NavLink>
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
              {project.seriesId
                ? t("Episode {0} · ", { 0: project.episodeNumber })
                : ""}
              <I18nText text="Creative workspace" />
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <ProjectSettings key={project._id} project={project} />
          <StoredExports key={`exports-${project._id}`} projectId={projectId} />
          {!!activeJobs?.length && (
            <span className="text-zinc-400">
              {activeJobs.length} <I18nText text="generating" />
            </span>
          )}
          {auxiliary ? (
            <NavLink
              className="flex items-center gap-1 text-[var(--color-studio-accent)]"
              to={`/projects/${projectId}/studio${location.search}`}
            >
              <ArrowLeft size={14} />
              <I18nText text="Workspace" />
            </NavLink>
          ) : (
            <NavLink
              className="text-zinc-300 hover:text-[var(--color-studio-accent)]"
              to={`/projects/${projectId}/assets${location.search}`}
            >
              <I18nText text="Manage references" />
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
