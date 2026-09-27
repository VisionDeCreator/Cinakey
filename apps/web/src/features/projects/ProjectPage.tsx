import { NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { ProjectTab } from "@cinakey/shared";

const TABS: { id: ProjectTab; label: string; path: string }[] = [
  { id: "script", label: "Script", path: "script" },
  { id: "look-dev", label: "Look Dev", path: "look-dev" },
  { id: "blockout", label: "Blockout", path: "blockout" },
  { id: "shots", label: "Shots", path: "shots" },
  { id: "edit", label: "Edit", path: "edit" },
  { id: "assets", label: "Assets", path: "assets" },
];

function ProjectTabPlaceholder({ label }: { label: string }) {
  const { projectId } = useParams();
  return (
    <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-8">
      <p className="text-sm text-zinc-400">
        {label} for project{" "}
        <span className="font-mono text-zinc-200">{projectId}</span> — coming
        soon.
      </p>
    </div>
  );
}

export function ProjectPage() {
  const { projectId } = useParams();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider text-zinc-500">
          Project
        </p>
        <h1 className="text-xl font-semibold tracking-tight">
          {projectId === "demo" ? "Demo Project" : projectId}
        </h1>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-zinc-800 pb-px">
        {TABS.map((tab) => (
          <NavLink
            key={tab.id}
            to={tab.path}
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

      <Routes>
        <Route index element={<Navigate to="script" replace />} />
        {TABS.map((tab) => (
          <Route
            key={tab.id}
            path={tab.path}
            element={<ProjectTabPlaceholder label={tab.label} />}
          />
        ))}
        <Route path="*" element={<Navigate to="script" replace />} />
      </Routes>
    </div>
  );
}
