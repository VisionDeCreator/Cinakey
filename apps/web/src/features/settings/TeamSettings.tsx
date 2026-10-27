import { ConfirmContext } from "@/components/use-confirm";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { useContext, useEffect, useState } from "react";
import { api, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MemberRole = "admin" | "creator";
const selectClass =
  "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm";

export function TeamSettings() {
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
      <h2 className="text-sm font-semibold text-zinc-200">Workspace team</h2>
      {(invitations ?? []).map((i) => (
        <div
          className="flex items-center justify-between gap-3 rounded border border-zinc-700 p-3"
          key={i._id}
        >
          <span className="text-sm">
            {i.workspaceName} invited you as {i.role}
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
            Accept invitation
          </Button>
        </div>
      ))}
      {workspaces === undefined ? (
        <p className="text-sm text-zinc-500">Loading team…</p>
      ) : selected ? (
        <>
          <Label htmlFor="team-workspace">Workspace</Label>
          <select
            id="team-workspace"
            className={selectClass}
            value={selected.workspace._id}
            disabled={busy}
            onChange={(e) => {
              if (activeWorkspaceId)
                void switchWorkspace(e.target.value as Id<"workspaces">);
              else setWorkspaceId(e.target.value as Id<"workspaces">);
              setError(null);
              setMessage(null);
            }}
          >
            {workspaces.map((w) => (
              <option key={w.workspace._id} value={w.workspace._id}>
                {w.workspace.name} ({w.role})
              </option>
            ))}
          </select>
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
                  <Label htmlFor="team-email">Invite by email</Label>
                  <Input
                    id="team-email"
                    type="email"
                    required
                    value={email}
                    disabled={busy}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <select
                  aria-label="Invitation role"
                  className={selectClass}
                  disabled={busy}
                  value={role}
                  onChange={(e) => setRole(e.target.value as MemberRole)}
                >
                  <option value="creator">Creator</option>
                  <option value="admin">Admin</option>
                </select>
                <Button disabled={busy || !email.trim()} type="submit">
                  Invite
                </Button>
              </form>
              <p className="text-xs text-zinc-500">
                Creators need project or series assignments. Client sharing will
                use separate video links.
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
              Your role is {selected.role}. Ask an Owner or Admin to change your
              assignments.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-zinc-500">
          Your workspace will appear after you create your first project.
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-emerald-400">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
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
        <div className="space-y-2 rounded border border-zinc-800 p-3">
          <Label htmlFor="next-owner">Transfer ownership</Label>
          <p className="text-xs text-zinc-500">
            The new Owner controls this workspace. You will remain an Admin.
          </p>
          <select
            id="next-owner"
            className={selectClass}
            value={nextOwner}
            disabled={busy}
            onChange={(e) => setNextOwner(e.target.value as Id<"users">)}
          >
            <option value="">Choose a member</option>
            {(members ?? [])
              .filter((m) => m.role === "creator" || m.role === "admin")
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name || m.email}
                </option>
              ))}
          </select>
          <Button
            variant="outline"
            disabled={busy || !nextOwner || !confirm}
            onClick={async () => {
              if (!nextOwner || !confirm) return;
              const approved = await confirm({
                title: "Transfer workspace ownership?",
                description:
                  "The selected member will become Owner and you will become an Admin. You will no longer be able to transfer ownership or control workspace billing.",
                confirmLabel: "Transfer ownership",
              });
              if (approved)
                void run(
                  () => transfer({ workspaceId, newOwnerId: nextOwner }),
                  "Ownership transferred. You are now an Admin.",
                );
            }}
          >
            Transfer ownership
          </Button>
        </div>
      )}
      {(members ?? []).map((m) => (
        <div
          className="space-y-2 rounded border border-zinc-800 p-3"
          key={m.userId}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              {m.name || m.email}{" "}
              {m.name && <span className="text-zinc-500">({m.email})</span>}
            </span>
            {m.role === "owner" ? (
              <span className="text-xs text-zinc-500">Owner</span>
            ) : (
              <div className="flex gap-2">
                <select
                  aria-label={`Role for ${m.email}`}
                  className={selectClass}
                  value={m.role}
                  disabled={busy}
                  onChange={(e) =>
                    void run(() =>
                      change({
                        workspaceId,
                        userId: m.userId,
                        role: e.target.value as MemberRole,
                      }),
                    )
                  }
                >
                  <option value="admin">Admin</option>
                  <option value="creator">Creator</option>
                  {m.role === "reviewer" && (
                    <option value="reviewer" disabled>
                      Reviewer (reserved)
                    </option>
                  )}
                </select>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      change({ workspaceId, userId: m.userId, role: "remove" }),
                    )
                  }
                >
                  Remove
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
            {i.email} · {i.role} ·{" "}
            {i.emailDelivery === "sent"
              ? "email sent"
              : i.emailDelivery === "failed"
                ? "email delivery failed"
                : i.emailDelivery === "disabled"
                  ? "email delivery not configured"
                  : "email queued"}
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
            Resend email
          </Button>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => void run(() => revoke({ invitationId: i._id }))}
          >
            Revoke
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
  const assignments = useQuery(api.teams.assignments, { workspaceId, userId });
  const assign = useMutation(api.teams.assign);
  return (
    <fieldset
      className="space-y-1"
      disabled={busy || assignments === undefined}
    >
      <legend className="text-xs text-zinc-500">Production access</legend>
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
          Series: {s.title} (all episodes)
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
        <p className="text-xs text-zinc-500">Create a project to assign it.</p>
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
        <Label htmlFor="workspace-name">Workspace name</Label>
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
        Rename workspace
      </Button>
    </form>
  );
}
