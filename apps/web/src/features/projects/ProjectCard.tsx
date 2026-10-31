import { getLocale } from "@dirrio/ui/i18n";
import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import { api } from "@dirrio/backend";
import { useMutation } from "@/lib/api/hooks";
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

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  const relative = new Intl.RelativeTimeFormat(getLocale(), {
    numeric: "auto",
    style: "short",
  });
  if (mins < 1) return relative.format(0, "second");
  if (mins < 60) return relative.format(-mins, "minute");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return relative.format(-days, "day");
  return new Date(ts).toLocaleDateString(getLocale());
}

export function ProjectCard({
  projectId,
  title,
  thumbnailUrl,
  updatedAt,
  archived,
  layout = "grid",
}: {
  projectId: string;
  title: string;
  thumbnailUrl: string | null;
  updatedAt: number;
  archived?: boolean;
  layout?: "grid" | "list";
}) {
  useLocale();
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
      <article
        className={`group relative flex overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 transition-colors hover:border-zinc-600 ${layout === "list" ? "flex-row items-center" : "flex-col"}`}
      >
        <Link
          to={`/projects/${projectId}`}
          className={
            layout === "list" ? "block w-28 shrink-0 sm:w-48" : "block"
          }
        >
          <div className="aspect-video bg-zinc-950">
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                <I18nText text="No thumbnail" />
              </div>
            )}
          </div>
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <Link to={`/projects/${projectId}`} className="min-w-0 flex-1">
              <h2 className="truncate font-medium text-zinc-100">{title}</h2>
              <p className="text-xs text-zinc-500">
                <I18nText text="Edited" /> {formatRelative(updatedAt)}
                {archived ? " " + t("· Archived") : ""}
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
                  <span className="sr-only">
                    <I18nText text="Project actions" />
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => navigate(`/projects/${projectId}`)}
                >
                  <I18nText text="Open" />
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setNewTitle(title);
                    setRenameOpen(true);
                  }}
                >
                  <I18nText text="Rename" />
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void duplicate({ projectId: projectId as never }).then(
                      (id) => navigate(`/projects/${id}`),
                    );
                  }}
                >
                  <I18nText text="Duplicate" />
                </DropdownMenuItem>
                {archived ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      void unarchive({ projectId: projectId as never })
                    }
                  >
                    <I18nText text="Unarchive" />
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() =>
                      void archive({ projectId: projectId as never })
                    }
                  >
                    <I18nText text="Archive" />
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </article>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <form onSubmit={(e) => void onRename(e)}>
            <DialogHeader>
              <DialogTitle>
                <I18nText text="Rename project" />
              </DialogTitle>
            </DialogHeader>
            <div className="mt-4 grid gap-2">
              <Label htmlFor="rename">
                <I18nText text="Title" />
              </Label>
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
                <I18nText text="Cancel" />
              </Button>
              <Button type="submit" disabled={busy}>
                <I18nText text="Save" />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
