import { I18nText, t, useLocale } from "@cinakey/ui/i18n";
import { api, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ResourceLibrary } from "./ResourceLibrary";

export function EpisodeSeriesPanel({
  projectId,
  seriesId,
}: {
  projectId: Id<"projects">;
  seriesId: Id<"series">;
}) {
  useLocale();
  const data = useQuery(api.series.forProject, { projectId });
  const defaults = useMutation(api.series.applyDefaults);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  if (!data) return null;
  const episode = data.episodes.find((e) => e._id === projectId);
  return (
    <div className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-6 py-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Link
          to={`/series/${seriesId}`}
          className="text-zinc-400 hover:underline"
        >
          {data.series.title}
        </Link>
        <Select
          value={projectId}
          onValueChange={(id) => void navigate(`/projects/${id}/video`)}
        >
          <SelectTrigger aria-label={t("Switch episode")} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.episodes.map((e) => (
              <SelectItem key={e._id} value={e._id}>
                <I18nText text="Ep" /> {e.episodeNumber}: {e.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>
          {open ? t("Close series library") : t("Series library")}
        </Button>
        {episode?.seriesSettingsVersion !== data.series.settingsVersion && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await defaults({ projectId });
                setMessage(
                  "Series style notes and rules adopted. Output format and existing work were kept.",
                );
              } catch (err) {
                setMessage(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            <I18nText text="Adopt latest style & rules" />
          </Button>
        )}
        {message && (
          <span role="status" className="text-zinc-400">
            {t(message ?? "")}
          </span>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>
              <I18nText text="Series library ·" /> {data.series.title}
            </DialogTitle>
            <DialogDescription>
              <I18nText text="Browse shared resources and choose a version for this episode." />
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto">
            <ResourceLibrary
              seriesId={seriesId}
              projectId={projectId}
              archived={!!data.series.archivedAt}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
