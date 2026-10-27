import { useWorkspace } from "@/features/workspaces/workspace-context";
import { api } from "@cinakey/backend";
import { useQuery } from "@/lib/api/hooks";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useCreateStarterProject } from "@/features/onboarding/useCreateStarterProject";
import { NewProjectDialog } from "@/features/projects/NewProjectDialog";
import { ProjectCard } from "@/features/projects/ProjectCard";

export function ProjectsPage() {
  const { workspaceId, canCreate, canManage } = useWorkspace();
  const projects = useQuery(
    api.projects.listMine,
    workspaceId ? { workspaceId } : {},
  );
  const [createOpen, setCreateOpen] = useState(false);
  const {
    run: createStarter,
    busy: starterBusy,
    error: starterError,
  } = useCreateStarterProject();
  const navigate = useNavigate();

  async function onStarter() {
    try {
      const id = await createStarter();
      void navigate(`/projects/${id}/video`);
    } catch {
      // error surfaced via starterError
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={starterBusy || !canCreate}
            onClick={() => void onStarter()}
          >
            {starterBusy ? "Starting…" : "Trailer template"}
          </Button>
          <Button variant="outline" asChild>
            <Link to="/series">
              {canManage ? "Series / New series" : "Series"}
            </Link>
          </Button>
          <Button disabled={!canCreate} onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New project
          </Button>
        </div>
      </div>

      {starterError ? (
        <p className="text-sm text-red-400">{starterError}</p>
      ) : null}

      {projects === undefined ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : projects.filter(({ project }) => !project.seriesId).length === 0 ? (
        <div className="border border-dashed border-zinc-700 px-6 py-16 text-center">
          <p className="text-sm text-zinc-500">No projects yet.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button
              disabled={starterBusy || !canCreate}
              onClick={() => void onStarter()}
            >
              {starterBusy ? "Starting…" : "Trailer template"}
            </Button>
            <Button
              disabled={!canCreate}
              variant="outline"
              onClick={() => setCreateOpen(true)}
            >
              New project
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects
            .filter(({ project }) => !project.seriesId)
            .map(({ project, thumbnailUrl, progress }) => (
              <ProjectCard
                key={project._id}
                projectId={project._id}
                title={project.title}
                thumbnailUrl={thumbnailUrl}
                updatedAt={project.updatedAt}
                progress={progress}
                archived={project.archivedAt !== undefined}
              />
            ))}
        </div>
      )}

      {projects?.some(({ project }) => project.seriesId) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-200">Episodes</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects
              .filter(({ project }) => project.seriesId)
              .map(({ project, thumbnailUrl, progress }) => (
                <ProjectCard
                  key={project._id}
                  projectId={project._id}
                  title={project.title}
                  thumbnailUrl={thumbnailUrl}
                  updatedAt={project.updatedAt}
                  progress={progress}
                  archived={project.archivedAt !== undefined}
                />
              ))}
          </div>
        </section>
      )}

      <NewProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
