import { I18nText, t, useLocale } from "@cinakey/ui/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmContext } from "@/components/use-confirm";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { useContext, useEffect, useState } from "react";
import { api, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MemberRole = "admin" | "creator";

export function TeamSettings() {
  useLocale();
  const {
    workspaceId: activeWorkspaceId,
    switchWorkspace,
    workspaces: availableWorkspaces,
  } = useWorkspace();
  const [acceptedWorkspaceId, setAcceptedWorkspaceId] =
    useState<Id<"workspaces"> | null>(null);
  const workspaces = useQuery(api.teams.list, {});
  const invitations = useQuery(api.teams.invitations, {});
  const invite = useMutation(api.teams.invite);
  const accept = useMutation(api.teams.accept);
  const [workspaceId, setWorkspaceId] = useState<Id<"workspaces"> | null>(null);
  const selected =
    workspaces?.find(
      (w) => w.workspace._id === (activeWorkspaceId ?? workspaceId),
    ) ?? workspaces?.[0];
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("creator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Team update failed");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      !acceptedWorkspaceId ||
      !workspaces?.some((w) => w.workspace._id === acceptedWorkspaceId)
    )
      return;
    // Wait for the provider's membership snapshot too; its switch guard rejects stale membership.
    if (
      availableWorkspaces.length &&
      !availableWorkspaces.some((w) => w.workspace._id === acceptedWorkspaceId)
    )
      return;
    let cancelled = false;
    void switchWorkspace(acceptedWorkspaceId)
      .then(() => {
        if (!cancelled) {
          setWorkspaceId(acceptedWorkspaceId);
          setAcceptedWorkspaceId(null);
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error
              ? err.message
              : "Could not open the invited workspace",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [acceptedWorkspaceId, workspaces, availableWorkspaces, switchWorkspace]);
  const manage = selected?.role === "owner" || selected?.role === "admin";
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-zinc-200">
        <I18nText text="Workspace team" />
      </h2>
      {(invitations ?? []).map((i) => (
        <div
          className="flex items-center justify-between gap-3 rounded border border-zinc-700 p-3"
          key={i._id}
        >
          <span className="text-sm">
            {i.workspaceName} <I18nText text="invited you as" />{" "}
            {t(i.role ?? "")}
          </span>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const joined = await accept({ invitationId: i._id });
                setAcceptedWorkspaceId(joined);
              }, "Invitation accepted. Shared productions are available in Projects.")
            }
          >
            <I18nText text="Accept invitation" />
          </Button>
        </div>
      ))}
      {workspaces === undefined ? (
        <p className="text-sm text-zinc-500">
          <I18nText text="Loading team…" />
        </p>
      ) : selected ? (
        <>
          <Label htmlFor="team-workspace">
            <I18nText text="Workspace" />
          </Label>
          <Select
            value={selected.workspace._id}
            disabled={busy}
            onValueChange={(value) => {
              setError(null);
              setMessage(null);
              if (activeWorkspaceId)
                void run(() => switchWorkspace(value as Id<"workspaces">));
              else setWorkspaceId(value as Id<"workspaces">);
            }}
          >
            <SelectTrigger
              id="team-workspace"
              aria-label={t("Workspace")}
              className="w-full max-w-sm rounded-xl bg-transparent"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-2xl bg-[var(--color-studio-panel)]">
              {workspaces.map((w) => (
                <SelectItem key={w.workspace._id} value={w.workspace._id}>
                  {w.workspace.name} ({t(w.role ?? "")})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {manage ? (
            <>
              <WorkspaceName
                workspaceId={selected.workspace._id}
                currentName={selected.workspace.name}
                busy={busy}
                run={run}
              />
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await invite({
                      workspaceId: selected.workspace._id,
                      email,
                      role,
                    });
                    setEmail("");
                  }, "Invitation created and queued for email delivery. The invited person can accept in Settings after verifying their email.");
                }}
              >
                <div className="space-y-1">
                  <Label htmlFor="team-email">
                    <I18nText text="Invite by email" />
                  </Label>
                  <Input
                    id="team-email"
                    type="email"
                    required
                    value={email}
                    disabled={busy}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <Select
                  disabled={busy}
                  value={role}
                  onValueChange={(value) => setRole(value as MemberRole)}
                >
                  <SelectTrigger
                    aria-label={t("Invitation role")}
                    className="w-36 rounded-xl bg-transparent"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="creator">
                      <I18nText text="Creator" />
                    </SelectItem>
                    <SelectItem value="admin">
                      <I18nText text="Admin" />
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button disabled={busy || !email.trim()} type="submit">
                  <I18nText text="Invite" />
                </Button>
              </form>
              <p className="text-xs text-zinc-500">
                <I18nText text="Creators need project or series assignments. Client sharing will use separate video links." />
              </p>
              <WorkspaceMembers
                key={selected.workspace._id}
                workspaceId={selected.workspace._id}
                owner={selected.role === "owner"}
                busy={busy}
                run={run}
              />
            </>
          ) : (
            <p className="text-sm text-zinc-500">
              <I18nText text="Your role is" /> {t(selected.role ?? "")}
              <I18nText text=". Ask an Owner or Admin to change your assignments." />
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-zinc-500">
          <I18nText text="Your workspace will appear after you create your first project." />
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-emerald-400">
          {t(message ?? "")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {t(error ?? "")}
        </p>
      )}
    </section>
  );
}

function WorkspaceMembers({
  workspaceId,
  owner,
  busy,
  run,
}: {
  workspaceId: Id<"workspaces">;
  owner: boolean;
  busy: boolean;
  run: (action: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  useLocale();
  const confirm = useContext(ConfirmContext);
  const transfer = useMutation(api.teams.transferOwnership);
  const [nextOwner, setNextOwner] = useState<Id<"users"> | "">("");
  const members = useQuery(api.teams.members, { workspaceId });
  const pending = useQuery(api.teams.pending, { workspaceId });
  const productions = useQuery(api.teams.productions, { workspaceId });
  const change = useMutation(api.teams.changeMember);
  const revoke = useMutation(api.teams.revoke);
  const resend = useMutation(api.teams.resendInvitation);
  return (
    <div className="space-y-3">
      {owner && (
        <div className="space-y-2 rounded-2xl border border-zinc-800 p-4">
          <Label htmlFor="next-owner">
            <I18nText text="Transfer ownership" />
          </Label>
          <p className="text-xs text-zinc-500">
            <I18nText text="The new Owner controls this workspace. You will remain an Admin." />
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={nextOwner || "none"}
              disabled={busy}
              onValueChange={(value) =>
                setNextOwner(value === "none" ? "" : (value as Id<"users">))
              }
            >
              <SelectTrigger
                id="next-owner"
                aria-label={t("Transfer ownership")}
                className="w-full max-w-xs rounded-xl bg-transparent"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <I18nText text="Choose a member" />
                </SelectItem>
                {(members ?? [])
                  .filter((m) => m.role === "creator" || m.role === "admin")
                  .map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name || m.email}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={busy || !nextOwner || !confirm}
              onClick={async () => {
                if (!nextOwner || !confirm) return;
                const approved = await confirm({
                  get title() {
                    return t("Transfer workspace ownership?");
                  },
                  get description() {
                    return t(
                      "The selected member will become Owner and you will become an Admin. You will no longer be able to transfer ownership or control workspace billing.",
                    );
                  },
                  confirmLabel: t("Transfer ownership"),
                });
                if (approved)
                  void run(
                    () => transfer({ workspaceId, newOwnerId: nextOwner }),
                    "Ownership transferred. You are now an Admin.",
                  );
              }}
            >
              <I18nText text="Transfer ownership" />
            </Button>
          </div>
        </div>
      )}
      {(members ?? []).map((m) => (
        <div
          className="space-y-2 rounded-2xl border border-zinc-800 p-4"
          key={m.userId}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              {m.name || m.email}{" "}
              {m.name && <span className="text-zinc-500">({m.email})</span>}
            </span>
            {m.role === "owner" ? (
              <span className="text-xs text-zinc-500">
                <I18nText text="Owner" />
              </span>
            ) : (
              <div className="flex gap-2">
                <Select
                  value={m.role}
                  disabled={busy}
                  onValueChange={(value) =>
                    void run(() =>
                      change({
                        workspaceId,
                        userId: m.userId,
                        role: value as MemberRole,
                      }),
                    )
                  }
                >
                  <SelectTrigger
                    aria-label={t("Role for {0}", { 0: m.email })}
                    className="w-36 rounded-xl bg-transparent"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">
                      <I18nText text="Admin" />
                    </SelectItem>
                    <SelectItem value="creator">
                      <I18nText text="Creator" />
                    </SelectItem>
                    {m.role === "reviewer" && (
                      <SelectItem value="reviewer" disabled>
                        <I18nText text="Reviewer (reserved)" />
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      change({ workspaceId, userId: m.userId, role: "remove" }),
                    )
                  }
                >
                  <I18nText text="Remove" />
                </Button>
              </div>
            )}
          </div>
          {m.role === "creator" && (
            <Assignments
              workspaceId={workspaceId}
              userId={m.userId}
              projects={productions?.projects ?? []}
              series={productions?.series ?? []}
              busy={busy}
              run={run}
            />
          )}
        </div>
      ))}
      {(pending ?? []).map((i) => (
        <div
          className="flex items-center justify-between gap-2 text-sm"
          key={i._id}
        >
          <span>
            {i.email} · {t(i.role ?? "")} ·{" "}
            {i.emailDelivery === "sent"
              ? t("email sent")
              : i.emailDelivery === "failed"
                ? t("email delivery failed")
                : i.emailDelivery === "disabled"
                  ? t("email delivery not configured")
                  : t("email queued")}
          </span>
          <Button
            disabled={busy || i.emailDelivery === "pending"}
            variant="outline"
            onClick={() =>
              void run(
                () => resend({ invitationId: i._id }),
                "Invitation queued for delivery.",
              )
            }
          >
            <I18nText text="Resend email" />
          </Button>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => void run(() => revoke({ invitationId: i._id }))}
          >
            <I18nText text="Revoke" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function Assignments({
  workspaceId,
  userId,
  projects,
  series,
  busy,
  run,
}: {
  workspaceId: Id<"workspaces">;
  userId: Id<"users">;
  projects: Array<{ _id: Id<"projects">; title: string }>;
  series: Array<{ _id: Id<"series">; title: string }>;
  busy: boolean;
  run: (action: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  useLocale();
  const assignments = useQuery(api.teams.assignments, { workspaceId, userId });
  const assign = useMutation(api.teams.assign);
  return (
    <fieldset
      className="space-y-1"
      disabled={busy || assignments === undefined}
    >
      <legend className="text-xs text-zinc-500">
        <I18nText text="Production access" />
      </legend>
      {series.map((s) => (
        <label className="flex items-center gap-2 text-sm" key={s._id}>
          <input
            type="checkbox"
            checked={assignments?.some((a) => a.seriesId === s._id) ?? false}
            onChange={(e) =>
              void run(() =>
                assign({
                  workspaceId,
                  userId,
                  seriesId: s._id,
                  enabled: e.target.checked,
                }),
              )
            }
          />
          <I18nText text="Series:" /> {s.title}{" "}
          <I18nText text="(all episodes)" />
        </label>
      ))}
      {projects.length ? (
        projects.map((p) => (
          <label className="flex items-center gap-2 text-sm" key={p._id}>
            <input
              type="checkbox"
              checked={assignments?.some((a) => a.projectId === p._id) ?? false}
              onChange={(e) =>
                void run(() =>
                  assign({
                    workspaceId,
                    userId,
                    projectId: p._id,
                    enabled: e.target.checked,
                  }),
                )
              }
            />
            {p.title}
          </label>
        ))
      ) : (
        <p className="text-xs text-zinc-500">
          <I18nText text="Create a project to assign it." />
        </p>
      )}
    </fieldset>
  );
}

function WorkspaceName({
  workspaceId,
  currentName,
  busy,
  run,
}: {
  workspaceId: Id<"workspaces">;
  currentName: string;
  busy: boolean;
  run: (action: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  useLocale();
  const rename = useMutation(api.teams.rename);
  const [name, setName] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await rename({ workspaceId, name });
          setName("");
        }, "Workspace renamed.");
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="workspace-name">
          <I18nText text="Workspace name" />
        </Label>
        <Input
          id="workspace-name"
          placeholder={currentName}
          value={name}
          maxLength={120}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" disabled={busy || !name.trim()}>
        <I18nText text="Rename workspace" />
      </Button>
    </form>
  );
}
