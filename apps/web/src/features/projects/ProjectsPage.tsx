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
      void navigate(`/projects/${id}/script`);
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
            disabled={starterBusy}
            onClick={() => void onStarter()}
          >
            {starterBusy ? "Starting…" : "Trailer template"}
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
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="border border-dashed border-zinc-700 px-6 py-16 text-center">
          <p className="text-sm text-zinc-500">No projects yet.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button disabled={starterBusy} onClick={() => void onStarter()}>
              {starterBusy ? "Starting…" : "Trailer template"}
            </Button>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              New project
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
