import { useState } from "react";
import { api, type Doc } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { BudgetSettings } from "@/features/settings/BudgetSettings";
import { TeamSettings } from "@/features/settings/TeamSettings";
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
import { formatUsd } from "@cinakey/shared";

export function ProjectSettings({ project }: { project: Doc<"projects"> }) {
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
        Settings & budgets
      </Button>
      <span className="text-xs text-zinc-400">
        {project.seriesId ? "Episode" : "Video"} budget:{" "}
        {spend === undefined
          ? "Loading…"
          : spend?.remaining == null
            ? "No cap"
            : `${formatUsd(spend.remaining)} remaining`}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {project.seriesId ? "Episode" : "Project"} settings
            </DialogTitle>
            <DialogDescription>
              {project.title} · Your workspace role: {role ?? "member"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 border-b border-zinc-800 pb-3">
            {[
              { id: "settings", label: "Settings", Icon: Settings },
              { id: "budgets", label: "Budgets & usage", Icon: Wallet },
              { id: "roles", label: "Roles & access", Icon: Users },
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
                  Name
                  <Input
                    value={title}
                    maxLength={200}
                    onChange={(event) => setTitle(event.target.value)}
                    disabled={canWrite === false}
                  />
                </label>
                <label className="block space-y-2 text-sm">
                  Style notes
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    disabled={canWrite === false}
                  />
                </label>
                <p className="text-xs text-zinc-400">
                  Output: {project.aspectRatio} · {project.fps} fps. Changing
                  settings keeps existing timeline edits and exports.
                </p>
                <Button disabled={busy || canWrite === false || !title.trim()}>
                  Save settings
                </Button>
                {message && (
                  <p role="status" className="text-sm">
                    {message}
                  </p>
                )}
              </form>
            )}
            {tab === "budgets" && (
              <>
                <div className="rounded-2xl border border-zinc-800 p-4 text-sm">
                  Spent: {formatUsd(spend?.spentUsdMicros ?? 0)} · Reserved:{" "}
                  {formatUsd(spend?.reservedUsdMicros ?? 0)}
                </div>
                {canManage ? (
                  <BudgetSettings
                    projectId={project._id}
                    seriesId={project.seriesId}
                  />
                ) : (
                  <p className="text-sm text-zinc-400">
                    Ask a workspace owner or admin to manage series and episode
                    budgets.
                  </p>
                )}
              </>
            )}
            {tab === "roles" && (
              <>
                <p className="text-sm text-zinc-400">
                  Owners and admins manage the production. Creators need an
                  assignment to this episode or its series. Manage those
                  assignments in each member’s access controls below.
                </p>
                {canManage ? (
                  <TeamSettings />
                ) : (
                  <p className="text-sm">
                    Your role: {role}. Ask an owner or admin to change
                    production access.
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
