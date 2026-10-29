import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import { BudgetSettings } from "@/features/settings/BudgetSettings";
import { api, type Doc, type Id } from "@dirrio/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Archive,
  ArrowLeft,
  Clapperboard,
  Layers,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { cn } from "@/lib/utils";
import { ResourceLibrary } from "./ResourceLibrary";

export function SeriesPage() {
  useLocale();
  const { seriesId } = useParams();
  const data = useQuery(
    api.series.get,
    seriesId ? { seriesId: seriesId as Id<"series"> } : "skip",
  );
  if (data === undefined)
    return (
      <p role="status" className="text-sm text-zinc-400">
        <I18nText text="Loading series…" />
      </p>
    );
  if (!data)
    return (
      <p role="alert">
        <I18nText text="Series not found." />
      </p>
    );
  return (
    <SeriesContent
      key={data.series._id}
      series={data.series}
      episodes={data.episodes}
    />
  );
}
function SeriesContent({
  series,
  episodes,
}: {
  series: Doc<"series">;
  episodes: Doc<"projects">[];
}) {
  useLocale();
  const { canManage, canWrite } = useWorkspace();
  const writable = canManage && canWrite !== false;
  const projects = useQuery(api.projects.listMine, {
    workspaceId: series.workspaceId,
  });
  const create = useMutation(api.series.createEpisode);
  const membership = useMutation(api.series.setMembership);
  const archive = useMutation(api.series.setArchived);
  const reorder = useMutation(api.series.reorderEpisodes);
  const archiveEpisode = useMutation(api.projects.archive);
  const restoreEpisode = useMutation(api.projects.unarchive);
  const navigate = useNavigate();
  const [tab, setTab] = useState<
    "episodes" | "library" | "settings" | "budgets"
  >("episodes");
  const [name, setName] = useState("");
  const [existing, setExisting] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  const standalone =
    projects?.filter(
      ({ project }) => !project.seriesId && !project.archivedAt,
    ) ?? [];
  const selected = standalone.some(({ project }) => project._id === existing)
    ? existing
    : "";
  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <Link
        to="/series"
        className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100"
      >
        <ArrowLeft className="size-4" />
        <I18nText text="All series" />
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">
            {series.title}
          </h1>
          <p className="mt-2 text-sm text-zinc-400 sm:text-base">
            {series.archivedAt
              ? t("Archived · Existing episodes remain accessible")
              : series.description ||
                t("One series. A shared world of stories.")}
          </p>
          <p className="mt-3 text-sm text-zinc-400">
            {series.aspectRatio} · {series.fps} <I18nText text="fps" />
          </p>
        </div>
        {writable && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(() =>
                archive({ seriesId: series._id, archived: !series.archivedAt }),
              )
            }
          >
            <Archive />
            {series.archivedAt ? t("Restore series") : t("Archive series")}
          </Button>
        )}
      </div>
      <nav
        className="flex gap-6 border-b border-zinc-800"
        aria-label={t("Series sections")}
      >
        {(
          [
            "episodes",
            "library",
            "settings",
            ...(canManage ? ["budgets" as const] : []),
          ] as const
        ).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "border-b-2 px-1 pb-3 text-sm focus-visible:outline-[var(--color-studio-accent)]",
              tab === value
                ? "border-[var(--color-studio-accent)] text-zinc-100"
                : "border-transparent text-zinc-400 hover:text-zinc-100",
            )}
          >
            {value === "library"
              ? t("Shared library")
              : value === "episodes"
                ? t("Episodes")
                : value === "budgets"
                  ? t("Budgets")
                  : t("Settings")}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {t(error ?? "")}
        </p>
      )}
      {tab === "library" ? (
        <ResourceLibrary
          seriesId={series._id}
          archived={!!series.archivedAt || !writable}
        />
      ) : tab === "budgets" ? (
        <BudgetSettings seriesId={series._id} />
      ) : tab === "settings" ? (
        <SeriesSettings
          key={series._id}
          series={series}
          disabled={!writable || !!series.archivedAt}
        />
      ) : (
        <>
          {!series.archivedAt && writable && (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                <form
                  className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!name.trim()) return;
                    void run(async () => {
                      const id = await create({
                        seriesId: series._id,
                        title: name.trim(),
                      });
                      void navigate(`/projects/${id}/video`);
                    });
                  }}
                >
                  <h2 className="font-medium">
                    <I18nText text="Create an episode" />
                  </h2>
                  <div className="flex flex-wrap gap-3">
                    <Input
                      aria-label={t("Episode title")}
                      placeholder={t("Episode title")}
                      value={name}
                      maxLength={200}
                      onChange={(e) => setName(e.target.value)}
                      required
                      disabled={busy}
                      className="min-w-40 flex-1 bg-transparent"
                    />
                    <Button disabled={busy || !name.trim()}>
                      <Plus />
                      <I18nText text="New episode" />
                    </Button>
                  </div>
                </form>
                <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                  <h2 className="font-medium">
                    <I18nText text="Attach an existing project" />
                  </h2>
                  <div className="flex flex-wrap gap-3">
                    <Select
                      value={selected}
                      onValueChange={setExisting}
                      disabled={busy || !standalone.length}
                    >
                      <SelectTrigger
                        aria-label={t("Standalone project")}
                        className="min-w-0 flex-1 basis-48 rounded-xl border-zinc-700 bg-transparent [&>span]:truncate"
                      >
                        <SelectValue
                          placeholder={
                            projects === undefined
                              ? t("Loading projects…")
                              : standalone.length
                                ? t("Choose a standalone project")
                                : t("No standalone projects available")
                          }
                        />
                      </SelectTrigger>
                      <SelectContent className="max-w-[calc(100vw-2rem)] rounded-2xl border-zinc-800 bg-[var(--color-studio-panel)] p-1.5">
                        {standalone.map(({ project }) => (
                          <SelectItem
                            key={project._id}
                            value={project._id}
                            className="rounded-xl py-2.5 focus:bg-zinc-800 data-[state=checked]:text-[var(--color-studio-accent)]"
                          >
                            {project.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      disabled={busy || !selected}
                      onClick={() =>
                        void run(async () => {
                          await membership({
                            projectId: selected as Id<"projects">,
                            seriesId: series._id,
                          });
                          setExisting("");
                        })
                      }
                    >
                      <I18nText text="Attach project" />
                    </Button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-zinc-400">
                <I18nText text="New episodes use series defaults. Attached projects keep their existing settings." />
              </p>
            </>
          )}
          <section aria-labelledby="episodes-heading" className="space-y-4">
            <div className="flex items-center gap-4">
              <h2 id="episodes-heading" className="text-xl font-semibold">
                <I18nText text="Episodes" />
              </h2>
              <span className="text-xs text-zinc-400">
                {episodes.length}{" "}
                {episodes.length === 1 ? t("episode") : t("episodes")}
              </span>
            </div>
            {episodes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 px-6 py-12 text-center">
                <Clapperboard className="mx-auto mb-3 size-8 text-zinc-500" />
                <p className="text-sm text-zinc-400">
                  <I18nText text="No episodes yet." />
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {episodes.map((episode, index) => {
                  const cover = projects?.find(
                    ({ project }) => project._id === episode._id,
                  )?.thumbnailUrl;
                  return (
                    <li
                      key={episode._id}
                      className="flex flex-wrap items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3"
                    >
                      <Link
                        to={`/projects/${episode._id}/video`}
                        aria-label={t("Open {0}", { 0: episode.title })}
                        className="block w-28 shrink-0 overflow-hidden rounded-xl sm:w-48"
                      >
                        <div className="flex aspect-video items-center justify-center bg-[var(--color-studio-panel)]">
                          {cover ? (
                            <img
                              src={cover}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Clapperboard className="size-8 text-[var(--color-studio-accent)] opacity-60" />
                          )}
                        </div>
                      </Link>
                      <Link
                        to={`/projects/${episode._id}/video`}
                        className="min-w-0 flex-1"
                      >
                        <p className="text-[10px] tracking-widest text-zinc-400">
                          <I18nText text="EPISODE" />{" "}
                          {String(episode.episodeNumber ?? index + 1).padStart(
                            2,
                            "0",
                          )}
                        </p>
                        <h3 className="mt-1 truncate text-lg font-medium">
                          {episode.title}
                        </h3>
                        {episode.archivedAt && (
                          <p className="text-xs text-zinc-400">
                            <I18nText text="Archived" />
                          </p>
                        )}
                      </Link>
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/projects/${episode._id}/video`}>
                          <I18nText text="Open episode" />
                        </Link>
                      </Button>
                      {writable && !series.archivedAt && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("Actions for {0}", {
                                0: episode.title,
                              })}
                              disabled={busy}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={index === 0}
                              onSelect={() =>
                                void run(() => {
                                  const ids = episodes.map((e) => e._id);
                                  [ids[index - 1], ids[index]] = [
                                    ids[index]!,
                                    ids[index - 1]!,
                                  ];
                                  return reorder({
                                    seriesId: series._id,
                                    projectIds: ids,
                                  });
                                })
                              }
                            >
                              <I18nText text="Move up" />
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                void run(() =>
                                  episode.archivedAt
                                    ? restoreEpisode({ projectId: episode._id })
                                    : archiveEpisode({
                                        projectId: episode._id,
                                      }),
                                )
                              }
                            >
                              {episode.archivedAt
                                ? t("Restore episode")
                                : t("Archive episode")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                void run(() =>
                                  membership({
                                    projectId: episode._id,
                                    seriesId: null,
                                  }),
                                )
                              }
                            >
                              <I18nText text="Make standalone" />
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SeriesSettings({
  series,
  disabled,
}: {
  series: Doc<"series">;
  disabled: boolean;
}) {
  useLocale();
  const update = useMutation(api.series.update);
  const [title, setTitle] = useState(series.title);
  const [description, setDescription] = useState(series.description);
  const [style, setStyle] = useState(series.styleNotes);
  const [rules, setRules] = useState(series.rules.join("\n"));
  const [aspect, setAspect] = useState(series.aspectRatio);
  const [fps, setFps] = useState(series.fps);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || disabled || !title.trim()) return;
        setBusy(true);
        setMessage("");
        try {
          await update({
            seriesId: series._id,
            title: title.trim(),
            description,
            styleNotes: style,
            rules: rules
              .split("\n")
              .map((r) => r.trim())
              .filter(Boolean),
            aspectRatio: aspect as "16:9" | "9:16" | "1:1",
            fps,
          });
          setMessage("Defaults saved. Existing episodes keep their settings.");
        } catch (err) {
          setMessage(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h2 className="text-xl font-semibold">
          <I18nText text="Series settings" />
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          <I18nText text="Shape the defaults for your shared story." />
        </p>
      </div>
      <fieldset
        disabled={disabled || busy}
        className="grid min-w-0 gap-4 lg:grid-cols-[1.4fr_1fr]"
      >
        <section className="min-w-0 space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 className="text-lg font-semibold">
            <I18nText text="Series details" />
          </h3>
          <label className="grid gap-2 text-sm">
            <I18nText text="Series name" />
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              className="bg-transparent"
            />
          </label>
          <label className="grid gap-2 text-sm">
            <I18nText text="Description" />
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={10000}
              rows={3}
              className="bg-transparent"
            />
          </label>
        </section>
        <section className="min-w-0 space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 className="text-lg font-semibold">
            <I18nText text="Output defaults" />
          </h3>
          <label className="grid gap-2 text-sm">
            <I18nText text="Aspect ratio" />
            <Select
              disabled={disabled || busy}
              value={aspect}
              onValueChange={(value) => setAspect(value as typeof aspect)}
            >
              <SelectTrigger
                aria-label={t("Aspect ratio")}
                className="w-full bg-transparent"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["16:9", "9:16", "1:1"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-2 text-sm">
            <I18nText text="Frame rate" />
            <Select
              disabled={disabled || busy}
              value={String(fps)}
              onValueChange={(value) => setFps(Number(value))}
            >
              <SelectTrigger
                aria-label={t("Frame rate")}
                className="w-full bg-transparent"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[24, 25, 30, 60].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value} <I18nText text="fps" />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <p className="text-xs text-zinc-400">
            <I18nText text="Applied to new episodes." />
          </p>
        </section>
        <section className="min-w-0 space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 className="text-lg font-semibold">
            <I18nText text="Visual style" />
          </h3>
          <label className="grid gap-2 text-sm">
            <I18nText text="Style notes" />
            <Textarea
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              maxLength={20000}
              rows={4}
              placeholder={t("Describe the visual direction for this series")}
              className="bg-transparent"
            />
          </label>
        </section>
        <section className="min-w-0 space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 className="text-lg font-semibold">
            <I18nText text="Production rules" />
          </h3>
          <label className="grid gap-2 text-sm">
            <I18nText text="One rule per line." />
            <Textarea
              aria-label={t("Production rules")}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={4}
              placeholder={t("Keep characters and world details consistent")}
              className="bg-transparent"
            />
          </label>
        </section>
      </fieldset>
      {message && (
        <p role="status" className="text-sm text-zinc-400">
          {t(message ?? "")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-xs text-zinc-400">
          <Layers className="size-4 shrink-0" />
          <p>
            <I18nText text="New episodes use these defaults. Existing episodes keep their settings and can adopt updated style notes and rules." />
          </p>
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={disabled || busy || !title.trim()}
        >
          {busy ? t("Saving…") : t("Save defaults")}
        </Button>
      </div>
    </form>
  );
}
