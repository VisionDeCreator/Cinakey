import { I18nText, t, useLocale } from "@cinakey/ui/i18n";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { api } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Archive,
  Layers,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function SeriesIndexPage() {
  useLocale();
  const { workspaceId, canManage, canWrite } = useWorkspace();
  const rows = useQuery(api.series.list, {
    includeArchived: true,
    ...(workspaceId ? { workspaceId } : {}),
  });
  const projects = useQuery(
    api.projects.listMine,
    workspaceId ? { workspaceId } : {},
  );
  const create = useMutation(api.series.create);
  const setArchived = useMutation(api.series.setArchived);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const search = (params.get("q") ?? "").trim().toLowerCase();
  const [tab, setTab] = useState<"all" | "archived">("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState("updated");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  const visible = rows
    ?.filter(
      (row) =>
        (tab === "all" || Boolean(row.archivedAt)) &&
        row.title.toLowerCase().includes(search),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : b.updatedAt - a.updatedAt,
    );
  const covers = new Map<string, string>();
  for (const { project, thumbnailUrl } of projects ?? []) {
    if (project.seriesId && thumbnailUrl && !covers.has(project.seriesId))
      covers.set(project.seriesId, thumbnailUrl);
  }
  return (
    <div className="mx-auto max-w-[1600px] space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            <I18nText text="Your series" />
          </h1>
          <p className="mt-2 text-sm text-zinc-400 sm:text-base">
            <I18nText text="Multiple episodes, one shared creative library." />
          </p>
        </div>
        {canManage && (
          <Button
            size="lg"
            disabled={canWrite === false}
            onClick={() => {
              setName("");
              setCreateError("");
              setOpen(true);
            }}
          >
            <Plus />
            <I18nText text="New series" />
          </Button>
        )}
      </div>
      <section aria-label={t("Series library")} className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800">
          <div className="flex gap-6" aria-label={t("Series category")}>
            {(["all", "archived"] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "border-b-2 px-1 pb-3 text-sm focus-visible:outline-[var(--color-studio-accent)]",
                  tab === value
                    ? "border-[var(--color-studio-accent)] text-zinc-100"
                    : "border-transparent text-zinc-400 hover:text-zinc-100",
                )}
              >
                {value === "all" ? t("All series") : t("Archived")}
              </button>
            ))}
          </div>
          <div className="mb-2 flex items-center gap-2">
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger
                aria-label={t("Sort series")}
                className="w-36 rounded-xl border-zinc-800 bg-transparent"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">
                  <I18nText text="Last edited" />
                </SelectItem>
                <SelectItem value="title">
                  <I18nText text="Name" />
                </SelectItem>
              </SelectContent>
            </Select>
            <div className="flex rounded-xl border border-zinc-800 p-0.5">
              {(["grid", "list"] as const).map((mode) => (
                <Button
                  key={mode}
                  size="icon"
                  variant="ghost"
                  aria-label={mode === "grid" ? t("Grid view") : t("List view")}
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
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {t(error ?? "")}
          </p>
        )}
        {rows === undefined ? (
          <p role="status" className="py-12 text-sm text-zinc-400">
            <I18nText text="Loading series…" />
          </p>
        ) : visible?.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-700 px-6 py-16 text-center">
            <Layers className="mx-auto mb-4 size-8 text-zinc-500" />
            <p className="text-sm text-zinc-400">
              {search
                ? t("No matching series.")
                : tab === "archived"
                  ? t("No archived series.")
                  : t(
                      "No series yet. Create a series to start building your episodic story.",
                    )}
            </p>
          </div>
        ) : (
          <div
            className={cn(
              "grid gap-5",
              view === "grid" ? "lg:grid-cols-2 xl:grid-cols-3" : "grid-cols-1",
            )}
          >
            {visible?.map((row) => (
              <article
                key={row._id}
                className={cn(
                  "group overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 transition-colors hover:border-zinc-600",
                  view === "list" && "flex items-center",
                )}
              >
                <Link
                  to={`/series/${row._id}`}
                  aria-label={t("Open {0}", { 0: row.title })}
                  className={cn(
                    "relative block",
                    view === "list" && "w-28 shrink-0 sm:w-56",
                  )}
                >
                  <div className="aspect-video overflow-hidden bg-[var(--color-studio-panel)]">
                    {covers.get(row._id) ? (
                      <img
                        src={covers.get(row._id)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--color-studio-accent-soft)] text-[var(--color-studio-accent)]">
                        <Layers className="size-10 opacity-60" />
                        <span className="px-3 text-center text-xs text-zinc-400">
                          <I18nText text="Series artwork appears from your episodes" />
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="absolute left-3 top-3 rounded-lg border border-white/10 bg-black/70 p-2 text-zinc-100">
                    <Layers className="size-4" />
                  </span>
                </Link>
                <div className="min-w-0 flex-1 space-y-3 p-4">
                  <Link to={`/series/${row._id}`} className="block">
                    <h2 className="truncate text-lg font-medium">
                      {row.title}
                    </h2>
                    <p className="mt-1 line-clamp-1 text-sm text-zinc-400">
                      {row.description ||
                        t("One series. A shared world of stories.")}
                    </p>
                  </Link>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-zinc-400">
                      {row.aspectRatio} · {row.fps} <I18nText text="fps" />
                      {row.archivedAt ? " " + t("· Archived") : ""}
                    </p>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("Actions for {0}", { 0: row.title })}
                          disabled={pending === row._id}
                          className="size-7"
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link to={`/series/${row._id}`}>
                            <I18nText text="Open series" />
                          </Link>
                        </DropdownMenuItem>
                        {canManage && (
                          <DropdownMenuItem
                            onSelect={() => {
                              setPending(row._id);
                              setError("");
                              void setArchived({
                                seriesId: row._id,
                                archived: !row.archivedAt,
                              })
                                .catch((err: unknown) =>
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : "Could not update series.",
                                  ),
                                )
                                .finally(() => setPending(null));
                            }}
                          >
                            <Archive className="mr-2 size-4" />
                            {row.archivedAt
                              ? t("Restore series")
                              : t("Archive series")}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <I18nText text="New series" />
            </DialogTitle>
            <DialogDescription>
              <I18nText text="Create a shared world for your episodes, assets, and creative direction." />
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim() || !canManage || canWrite === false) return;
              setBusy(true);
              setCreateError("");
              try {
                const id = await create({
                  title: name.trim(),
                  ...(workspaceId ? { workspaceId } : {}),
                });
                setOpen(false);
                void navigate(`/series/${id}`);
              } catch (err) {
                setCreateError(
                  err instanceof Error
                    ? err.message
                    : "Could not create series.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="series-name">
                <I18nText text="Series name" />
              </Label>
              <Input
                id="series-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                placeholder={t("Name your series")}
                required
                disabled={busy}
              />
            </div>
            {createError && (
              <p role="alert" className="text-sm text-red-400">
                {t(createError ?? "")}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                <I18nText text="Cancel" />
              </Button>
              <Button
                type="submit"
                disabled={
                  busy || !name.trim() || !canManage || canWrite === false
                }
              >
                {busy ? t("Creating…") : t("Create series")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
