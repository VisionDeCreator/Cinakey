import { api } from "@cinakey/backend";
import type { PipelineProgress } from "@cinakey/shared";
import { useMutation } from "convex/react";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StageProgressBar } from "@/features/projects/StageProgress";

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function ProjectCard({
  projectId,
  title,
  thumbnailUrl,
  updatedAt,
  progress,
  archived,
}: {
  projectId: string;
  title: string;
  thumbnailUrl: string | null;
  updatedAt: number;
  progress: PipelineProgress;
  archived?: boolean;
}) {
  const navigate = useNavigate();
  const update = useMutation(api.projects.update);
  const archive = useMutation(api.projects.archive);
  const unarchive = useMutation(api.projects.unarchive);
  const duplicate = useMutation(api.projects.duplicate);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newTitle, setNewTitle] = useState(title);
  const [busy, setBusy] = useState(false);

  async function onRename(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setBusy(true);
    try {
      await update({
        projectId: projectId as never,
        title: newTitle.trim(),
      });
      setRenameOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <article className="group relative flex flex-col overflow-hidden border border-zinc-800 bg-zinc-900/40 transition-colors hover:border-zinc-600">
        <Link to={`/projects/${projectId}`} className="block">
          <div className="aspect-video bg-zinc-950">
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                No thumbnail
              </div>
            )}
          </div>
        </Link>
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <Link to={`/projects/${projectId}`} className="min-w-0 flex-1">
              <h2 className="truncate font-medium text-zinc-100">{title}</h2>
              <p className="text-xs text-zinc-500">
                Edited {formatRelative(updatedAt)}
                {archived ? " · Archived" : ""}
              </p>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 opacity-70 group-hover:opacity-100"
                >
                  <MoreHorizontal className="size-4" />
                  <span className="sr-only">Project actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => navigate(`/projects/${projectId}`)}
                >
                  Open
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setNewTitle(title);
                    setRenameOpen(true);
                  }}
                >
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void duplicate({ projectId: projectId as never }).then(
                      (id) => navigate(`/projects/${id}`),
                    );
                  }}
                >
                  Duplicate
                </DropdownMenuItem>
                {archived ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      void unarchive({ projectId: projectId as never })
                    }
                  >
                    Unarchive
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() =>
                      void archive({ projectId: projectId as never })
                    }
                  >
                    Archive
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <StageProgressBar progress={progress} size="sm" />
        </div>
      </article>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <form onSubmit={(e) => void onRename(e)}>
            <DialogHeader>
              <DialogTitle>Rename project</DialogTitle>
            </DialogHeader>
            <div className="mt-4 grid gap-2">
              <Label htmlFor="rename">Title</Label>
              <Input
                id="rename"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
