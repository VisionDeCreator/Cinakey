import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const PLACEHOLDER_PROJECTS = [
  {
    id: "demo",
    title: "Demo Project",
    summary: "Placeholder project to explore the studio shell.",
  },
] as const;

export function ProjectsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Your films live here. Real project records arrive in a later phase.
        </p>
      </div>

      <ul className="divide-y divide-zinc-800 border-y border-zinc-800">
        {PLACEHOLDER_PROJECTS.map((project) => (
          <li
            key={project.id}
            className="flex items-center justify-between gap-4 py-4"
          >
            <div>
              <p className="font-medium">{project.title}</p>
              <p className="text-sm text-zinc-400">{project.summary}</p>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link to={`/projects/${project.id}/script`}>Open</Link>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
