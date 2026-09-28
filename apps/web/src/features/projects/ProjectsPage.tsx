import { api } from "@cinakey/backend";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useCreateStarterProject } from "@/features/onboarding/useCreateStarterProject";
import { NewProjectDialog } from "@/features/projects/NewProjectDialog";
import { ProjectCard } from "@/features/projects/ProjectCard";

export function ProjectsPage() {
  const projects = useQuery(api.projects.listMine, {});
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
      void navigate(`/projects/${id}`);
    } catch {
      // error surfaced via starterError
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Create a project from a brief and move it through the pipeline.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={starterBusy}
            onClick={() => void onStarter()}
          >
            {starterBusy ? "Starting…" : "Start with trailer template"}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New project
          </Button>
        </div>
      </div>

      {starterError ? (
        <p className="text-sm text-red-400">{starterError}</p>
      ) : null}

      {projects === undefined ? (
        <p className="text-sm text-zinc-500">Loading projects…</p>
      ) : projects.length === 0 ? (
        <div className="border border-dashed border-zinc-700 px-6 py-16 text-center">
          <p className="text-sm text-zinc-300">No projects yet</p>
          <p className="mt-1 text-sm text-zinc-500">
            Start with the 30-second trailer template (script, characters,
            sample clips) or create a blank project from a brief.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button disabled={starterBusy} onClick={() => void onStarter()}>
              {starterBusy ? "Starting…" : "Start with trailer template"}
            </Button>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              Create blank project
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map(({ project, thumbnailUrl, progress }) => (
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

      <NewProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
