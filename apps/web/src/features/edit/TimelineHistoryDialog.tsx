import { getLocale } from "@dirrio/ui/i18n";
import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import { api } from "@dirrio/backend";
import { useQuery } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  tipId: string | null;
  onRestore: (versionId: string) => void;
  canRestore?: boolean;
};

export function TimelineHistoryDialog({
  open,
  onOpenChange,
  projectId,
  tipId,
  onRestore,
  canRestore = true,
}: Props) {
  useLocale();
  const versions = useQuery(
    api.timelineVersions.listForProject,
    open ? { projectId: projectId as never } : "skip",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            <I18nText text="Timeline versions" />
          </DialogTitle>
          <DialogDescription>
            <I18nText text="Restoring loads a past version into the editor and saves it as a new tip (history is never overwritten)." />
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
          {(versions ?? []).map((v) => (
            <li
              key={v._id}
              className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 px-2 py-1.5"
            >
              <div className="min-w-0">
                <p className="truncate text-zinc-200">
                  {v.label ?? t("Untitled")}
                  {v._id === tipId ? " " + t("· tip") : ""}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {new Date(v.createdAt).toLocaleString(getLocale())} ·{" "}
                  {v.createdByName}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canRestore || v._id === tipId}
                onClick={() => {
                  onRestore(v._id);
                  onOpenChange(false);
                }}
              >
                <I18nText text="Restore" />
              </Button>
            </li>
          ))}
          {versions?.length === 0 && (
            <li className="text-xs text-zinc-500">
              <I18nText text="No versions yet." />
            </li>
          )}
        </ul>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            <I18nText text="Close" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
