import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import { useState } from "react";
import { api, type Doc } from "@dirrio/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { BudgetSettings } from "@/features/settings/BudgetSettings";
import { ProjectAccess } from "./ProjectAccess";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Settings, Wallet, Users } from "lucide-react";
import { formatUsd } from "@dirrio/ui/i18n";

export function ProjectSettings({ project }: { project: Doc<"projects"> }) {
  useLocale();
  const { canManage, canWrite, role } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("settings");
  const [title, setTitle] = useState(project.title);
  const [notes, setNotes] = useState(project.styleNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const save = useMutation(api.projects.update);
  const spend = useQuery(api.workspace.spend, { projectId: project._id });
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setTitle(project.title);
          setNotes(project.styleNotes ?? "");
          setOpen(true);
        }}
      >
        <Settings size={14} />
        <I18nText text="Settings & budgets" />
      </Button>
      <span className="text-xs text-zinc-400">
        {project.seriesId ? t("Episode") : t("Video")}{" "}
        <I18nText text="budget:" />{" "}
        {spend === undefined
          ? t("Loading…")
          : spend?.remaining == null
            ? t("No cap")
            : t("{0} remaining", { 0: formatUsd(spend.remaining) })}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {project.seriesId ? t("Episode") : t("Project")}{" "}
              <I18nText text="settings" />
            </DialogTitle>
            <DialogDescription>
              {project.title} <I18nText text="· Your workspace role:" />{" "}
              {role ?? t("member")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 border-b border-zinc-800 pb-3">
            {[
              {
                id: "settings",
                get label() {
                  return t("Settings");
                },
                Icon: Settings,
              },
              {
                id: "budgets",
                get label() {
                  return t("Budgets & usage");
                },
                Icon: Wallet,
              },
              {
                id: "roles",
                get label() {
                  return t("Project access");
                },
                Icon: Users,
              },
            ].map(({ id, label, Icon }) => (
              <Button
                key={id}
                variant={tab === id ? "default" : "ghost"}
                size="sm"
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                <Icon size={14} />
                {label}
              </Button>
            ))}
          </div>
          <div className="min-h-0 overflow-y-auto space-y-4">
            {tab === "settings" && (
              <form
                className="space-y-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy(true);
                  setMessage("");
                  try {
                    await save({
                      projectId: project._id,
                      title: title.trim(),
                      styleNotes: notes,
                    });
                    setMessage("Settings saved.");
                  } catch (error) {
                    setMessage(
                      error instanceof Error ? error.message : "Could not save",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="block space-y-2 text-sm">
                  <I18nText text="Name" />
                  <Input
                    value={title}
                    maxLength={200}
                    onChange={(event) => setTitle(event.target.value)}
                    disabled={canWrite === false}
                  />
                </label>
                <label className="block space-y-2 text-sm">
                  <I18nText text="Style notes" />
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    disabled={canWrite === false}
                  />
                </label>
                <p className="text-xs text-zinc-400">
                  <I18nText text="Output:" /> {project.aspectRatio} ·{" "}
                  {project.fps}{" "}
                  <I18nText text="fps. Changing settings keeps existing timeline edits and exports." />
                </p>
                <Button disabled={busy || canWrite === false || !title.trim()}>
                  <I18nText text="Save settings" />
                </Button>
                {message && (
                  <p role="status" className="text-sm">
                    {t(message ?? "")}
                  </p>
                )}
              </form>
            )}
            {tab === "budgets" && (
              <>
                <div className="rounded-2xl border border-zinc-800 p-4 text-sm">
                  <I18nText text="Spent:" />{" "}
                  {formatUsd(spend?.spentUsdMicros ?? 0)}{" "}
                  <I18nText text="· Reserved:" />{" "}
                  {formatUsd(spend?.reservedUsdMicros ?? 0)}
                </div>
                {canManage ? (
                  <BudgetSettings
                    projectId={project._id}
                    seriesId={project.seriesId}
                  />
                ) : (
                  <p className="text-sm text-zinc-400">
                    <I18nText text="Ask a workspace owner or admin to manage series and episode budgets." />
                  </p>
                )}
              </>
            )}
            {tab === "roles" && (
              <>
                {canManage ? (
                  <ProjectAccess project={project} />
                ) : (
                  <p className="text-sm">
                    <I18nText text="Your role:" /> {t(role ?? "")}
                    <I18nText text=". Ask an owner or admin to change production access." />
                  </p>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
