import { useWorkspace } from "@/features/workspaces/workspace-context";
import { api } from "@cinakey/backend";
import { useQuery } from "@/lib/api/hooks";
import {
  ArrowRight,
  FolderOpen,
  LayoutGrid,
  Layers,
  List,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { NewProjectDialog } from "@/features/projects/NewProjectDialog";
import { ProjectCard } from "@/features/projects/ProjectCard";
import { cn } from "@/lib/utils";

export function ProjectsPage() {
  const { workspaceId, canCreate, canManage } = useWorkspace();
  const projects = useQuery(
    api.projects.listMine,
    workspaceId ? { workspaceId } : {},
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const search = searchParams.get("q") ?? "";
  const [tab, setTab] = useState<"projects" | "episodes">("projects");
  const [sort, setSort] = useState("updated");
  const [view, setView] = useState<"grid" | "list">("grid");
  const visible = projects
    ?.filter(
      ({ project }) =>
        (tab === "episodes" ? Boolean(project.seriesId) : !project.seriesId) &&
        project.title.toLowerCase().includes(search.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.project.title.localeCompare(b.project.title)
        : b.project.updatedAt - a.project.updatedAt,
    );
  const actionClass =
    "group flex min-h-24 items-center gap-4 rounded-2xl border border-zinc-800 bg-[var(--color-studio-bg)] p-5 text-left transition-colors hover:border-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-studio-accent)] disabled:opacity-50";
  const iconClass =
    "flex size-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-studio-accent-soft)] text-[var(--color-studio-accent)]";

  return (
    <div className="mx-auto max-w-[1600px] space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Your creative workspace
          </h1>
          <p className="mt-2 text-sm text-zinc-400 sm:text-base">
            Pick up where you left off, or start something new.
          </p>
        </div>
        <Button
          size="lg"
          disabled={!canCreate}
          onClick={() => setCreateOpen(true)}
        >
          <Plus />
          New project
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <button
          type="button"
          className={actionClass}
          disabled={!canCreate}
          onClick={() => setCreateOpen(true)}
        >
          <span className={iconClass}>
            <Plus className="size-6" />
          </span>
          <span className="flex-1">
            <span className="block font-medium">New project</span>
            <span className="mt-1 block text-sm text-zinc-400">
              Start with a blank canvas.
            </span>
          </span>
          <ArrowRight className="size-4 text-zinc-400" />
        </button>
        <Link to="/series" className={actionClass}>
          <span className={iconClass}>
            <Layers className="size-6" />
          </span>
          <span className="flex-1">
            <span className="block font-medium">
              {canManage ? "New series" : "Series"}
            </span>
            <span className="mt-1 block text-sm text-zinc-400">
              {canManage
                ? "Build an episodic story."
                : "Explore your episodic stories."}
            </span>
          </span>
          <ArrowRight className="size-4 text-zinc-400" />
        </Link>
      </div>
      <section aria-labelledby="recent-projects" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="recent-projects" className="text-xl font-semibold">
            Recent projects
          </h2>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <select
              aria-label="Sort projects"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="h-9 rounded-xl border border-zinc-800 bg-[var(--color-studio-bg)] px-3 text-sm focus-visible:outline-[var(--color-studio-accent)]"
            >
              <option value="updated">Last edited</option>
              <option value="title">Name</option>
            </select>
            <div className="flex rounded-xl border border-zinc-800 p-0.5">
              {(["grid", "list"] as const).map((mode) => (
                <Button
                  key={mode}
                  variant="ghost"
                  size="icon"
                  aria-label={`${mode === "grid" ? "Grid" : "List"} view`}
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                  className={cn(
                    "size-8 rounded-lg",
                    view === mode &&
                      "bg-[var(--color-studio-accent-soft)] text-[var(--color-studio-accent)]",
                  )}
                >
                  {mode === "grid" ? <LayoutGrid /> : <List />}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div
          className="flex gap-6 border-b border-zinc-800"
          aria-label="Project category"
        >
          {(["projects", "episodes"] as const).map((category) => (
            <button
              key={category}
              type="button"
              aria-pressed={tab === category}
              onClick={() => setTab(category)}
              className={cn(
                "border-b-2 px-1 pb-3 text-sm transition-colors focus-visible:outline-[var(--color-studio-accent)]",
                tab === category
                  ? "border-[var(--color-studio-accent)] text-zinc-100"
                  : "border-transparent text-zinc-400 hover:text-zinc-100",
              )}
            >
              {category === "projects" ? "All projects" : "Episodes"}
            </button>
          ))}
        </div>
        {projects === undefined ? (
          <p role="status" className="py-12 text-sm text-zinc-400">
            Loading projects…
          </p>
        ) : visible?.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-700 px-6 py-16 text-center">
            <FolderOpen className="mx-auto mb-4 size-8 text-zinc-500" />
            <p className="text-sm text-zinc-400">
              {search.trim()
                ? "No matching projects."
                : tab === "episodes"
                  ? "No episodes yet."
                  : "No projects yet."}
            </p>
            {!search.trim() && tab === "projects" && (
              <Button
                className="mt-4"
                disabled={!canCreate}
                onClick={() => setCreateOpen(true)}
              >
                <Plus />
                New project
              </Button>
            )}
          </div>
        ) : (
          <div
            className={cn(
              "grid gap-5",
              view === "grid" ? "sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-1",
            )}
          >
            {visible?.map(({ project, thumbnailUrl, progress }) => (
              <ProjectCard
                key={project._id}
                projectId={project._id}
                title={project.title}
                thumbnailUrl={thumbnailUrl}
                updatedAt={project.updatedAt}
                progress={progress}
                archived={project.archivedAt !== undefined}
                layout={view}
              />
            ))}
          </div>
        )}
      </section>
      <NewProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
