import { useTrialConfirmation } from "@/features/workspaces/useTrialConfirmation";
import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { api } from "@dirrio/backend";
import type { AspectRatio } from "@dirrio/shared";
import { useMutation } from "@/lib/api/hooks";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useLocale();
  const confirmTrial = useTrialConfirmation();
  const { workspaceId, canCreate } = useWorkspace();
  const create = useMutation(api.projects.create);
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setAspectRatio("16:9");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Name is required.");
      return;
    }
    if (!(await confirmTrial())) return;
    setBusy(true);
    setError(null);
    try {
      const id = await create({
        ...(workspaceId ? { workspaceId } : {}),
        title: title.trim(),
        aspectRatio,
        fps: 24,
      });
      reset();
      onOpenChange(false);
      void navigate(`/projects/${id}/studio`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          if (!next) reset();
          onOpenChange(next);
        }
      }}
    >
      <DialogContent>
        <form onSubmit={(e) => void onSubmit(e)}>
          <DialogHeader>
            <DialogTitle>
              <I18nText text="New project" />
            </DialogTitle>
          </DialogHeader>

          <div className="mt-4 grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="title">
                <I18nText text="Name" />
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("Project name")}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>
                <I18nText text="Aspect ratio" />
              </Label>
              <Select
                value={aspectRatio}
                onValueChange={(v) => setAspectRatio(v as AspectRatio)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9</SelectItem>
                  <SelectItem value="9:16">9:16</SelectItem>
                  <SelectItem value="1:1">1:1</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error ? (
              <p className="text-sm text-red-400">{t(error ?? "")}</p>
            ) : null}
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              <I18nText text="Cancel" />
            </Button>
            <Button type="submit" disabled={busy || !canCreate}>
              {busy ? t("Creating…") : t("Create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
