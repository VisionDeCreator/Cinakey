import { api } from "@cinakey/backend";
import type { ProjectTab } from "@cinakey/shared";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { NavLink, Navigate, Outlet, useParams } from "react-router-dom";
import { CopilotPanel } from "@/features/copilot/CopilotPanel";
import {
  CopilotProvider,
  useCopilotContext,
} from "@/features/copilot/CopilotContext";
import { StageProgressBar } from "@/features/projects/StageProgress";
import { cn } from "@/lib/utils";

const TABS: { id: ProjectTab; label: string; path: string }[] = [
  { id: "script", label: "Script", path: "script" },
  { id: "look-dev", label: "Look Dev", path: "look-dev" },
  { id: "blockout", label: "Blockout", path: "blockout" },
  { id: "shots", label: "Shots", path: "shots" },
  { id: "edit", label: "Edit", path: "edit" },
  { id: "assets", label: "Assets", path: "assets" },
];

export function ProjectWorkspaceLayout() {
  return (
    <CopilotProvider>
      <ProjectWorkspaceInner />
    </CopilotProvider>
  );
}

function ProjectWorkspaceInner() {
  const { projectId } = useParams();
  const project = useQuery(
    api.projects.get,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const overview = useQuery(
    api.projects.getOverview,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const { setContext } = useCopilotContext();

  useEffect(() => {
    if (projectId) {
      setContext({ view: "overview", projectId, selectionIds: [] });
    }
  }, [projectId, setContext]);

  if (!projectId) {
    return <Navigate to="/projects" replace />;
  }

  if (project === undefined) {
    return <p className="text-sm text-zinc-500">Loading project…</p>;
  }

  const base = `/projects/${projectId}`;

  return (
    <div className="-m-6 flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-zinc-800 px-6 pt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-500">
                  Project
                </p>
                <h1 className="text-xl font-semibold tracking-tight">
                  {project.title}
                </h1>
              </div>
              {overview ? (
                <div className="w-48">
                  <StageProgressBar progress={overview.progress} />
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-1">
              <NavLink
                to={base}
                end
                className={({ isActive }) =>
                  cn(
                    "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100",
                    isActive && "border-zinc-100 text-zinc-50",
                  )
                }
              >
                Overview
              </NavLink>
              {TABS.map((tab) => (
                <NavLink
                  key={tab.id}
                  to={`${base}/${tab.path}`}
                  className={({ isActive }) =>
                    cn(
                      "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100",
                      isActive && "border-zinc-100 text-zinc-50",
                    )
                  }
                >
                  {tab.label}
                </NavLink>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-6">
            <Outlet />
          </div>
        </div>

        <aside className="hidden w-80 shrink-0 border-l border-zinc-800 bg-[var(--color-studio-panel)] lg:flex lg:flex-col">
          <div className="border-b border-zinc-800 px-4 py-3">
            <p className="text-sm font-medium text-zinc-200">AI copilot</p>
          </div>
          <div className="min-h-0 flex-1">
            <CopilotPanel projectId={projectId} />
          </div>
        </aside>
      </div>
    </div>
  );
}
