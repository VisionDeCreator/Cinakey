import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@cinakey/api-client";
import { formatUsd, parseUsdToMicros } from "@cinakey/shared";
import { Button } from "@cinakey/ui/button";
import { Input } from "@cinakey/ui/input";
import { Label } from "@cinakey/ui/label";
import {
  InternalWorkspaceForm,
  StaffUsersPage,
} from "./features/staff/StaffPages";
function Pagination({
  cursor,
  isDone,
  next,
  reset,
}: {
  cursor: string | null;
  isDone: boolean;
  next: () => void;
  reset: () => void;
}) {
  return (
    <div className="flex gap-2">
      <Button variant="outline" disabled={cursor === null} onClick={reset}>
        First page
      </Button>
      <Button variant="outline" disabled={isDone} onClick={next}>
        Next page
      </Button>
    </div>
  );
}
export function UsersPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const result = useQuery(api.staff.listUsers, { cursor });
  return (
    <>
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="text-sm text-zinc-400">
        Browse accounts or use an exact email below for lookup and funding
        actions. Amounts are USD usage funds; an adjustment is not a payment
        refund.
      </p>
      {!result ? (
        <p role="status">Loading users…</p>
      ) : (
        <>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">User accounts</caption>
              <thead>
                <tr>
                  <th className="p-3">Account</th>
                  <th>Name</th>
                  <th>Platform access</th>
                </tr>
              </thead>
              <tbody>
                {result.page.map((user) => (
                  <tr className="border-t border-zinc-800" key={user._id}>
                    <td className="p-3">
                      <Link className="underline" to={`/users/${user._id}`}>
                        {user.email || user._id}
                      </Link>
                    </td>
                    <td>{user.name || "—"}</td>
                    <td>{user.isStaff ? "Administrator" : "Member"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            cursor={cursor}
            isDone={result.isDone}
            next={() => setCursor(result.continueCursor)}
            reset={() => setCursor(null)}
          />
        </>
      )}
      <section className="space-y-4 rounded-xl border border-zinc-800 p-5">
        <h2 className="text-lg font-medium">
          Account lookup and usage funding
        </h2>
        <StaffUsersPage />
      </section>
    </>
  );
}
export function UserDetail() {
  const { userId } = useParams();
  const user = useQuery(api.staff.userDetail, {
    userId: userId as Id<"users">,
  });
  if (user === undefined) return <p role="status">Loading account…</p>;
  if (!user) return <p>Account not found.</p>;
  return (
    <>
      <Link className="text-sm underline" to="/users">
        All users
      </Link>
      <h1 className="text-2xl font-semibold">{user.email || "User account"}</h1>
      <dl className="grid gap-2 text-sm">
        <dt>User ID</dt>
        <dd className="break-all">{user._id}</dd>
        <dt>Name</dt>
        <dd>{user.name || "—"}</dd>
        <dt>Email verified</dt>
        <dd>{user.emailVerified ? "Yes" : "No"}</dd>
        <dt>Platform access</dt>
        <dd>{user.isStaff ? "Administrator" : "Member"}</dd>
        <dt>Created</dt>
        <dd>{new Date(user.createdAt).toLocaleString()}</dd>
      </dl>
      <h2 className="text-lg">Workspaces</h2>
      <ul className="space-y-3">
        {user.workspaces.map((w) => (
          <li key={w._id}>
            <Link className="underline" to={`/workspaces/${w._id}`}>
              {w.name}
            </Link>{" "}
            · {w.role} ·{" "}
            {w.billingMode === "internal"
              ? "Company-funded"
              : "Standard billing"}
          </li>
        ))}
      </ul>
      {!user.workspaces.length && <p>No workspace memberships.</p>}
    </>
  );
}
export function WorkspacesPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const result = useQuery(api.staff.listWorkspaces, { cursor });
  return (
    <>
      <h1 className="text-2xl font-semibold">Workspaces</h1>
      {!result ? (
        <p role="status">Loading workspaces…</p>
      ) : (
        <>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Workspaces</caption>
              <thead>
                <tr>
                  <th className="p-3">Workspace</th>
                  <th>Owner</th>
                  <th>Billing</th>
                </tr>
              </thead>
              <tbody>
                {result.page.map((w) => (
                  <tr key={w._id} className="border-t border-zinc-800">
                    <td className="p-3">
                      <Link className="underline" to={`/workspaces/${w._id}`}>
                        {w.name}
                      </Link>
                    </td>
                    <td>{w.ownerEmail || "—"}</td>
                    <td>
                      {w.billingMode === "internal"
                        ? "Company-funded"
                        : "Standard"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            cursor={cursor}
            isDone={result.isDone}
            next={() => setCursor(result.continueCursor)}
            reset={() => setCursor(null)}
          />
        </>
      )}
      <InternalWorkspaceForm />
    </>
  );
}
export function WorkspaceDetail() {
  const { workspaceId } = useParams();
  return (
    <WorkspaceRecord
      key={workspaceId}
      workspaceId={workspaceId as Id<"workspaces">}
    />
  );
}
function WorkspaceRecord({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const workspace = useQuery(api.staff.workspaceDetail, { workspaceId });
  const enable = useMutation(api.staff.enableInternalWorkspace);
  const [cap, setCap] = useState("100");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (workspace === undefined) return <p role="status">Loading workspace…</p>;
  if (!workspace) return <p>Workspace not found.</p>;
  const internal = workspace.billingMode === "internal";
  return (
    <>
      <Link className="text-sm underline" to="/workspaces">
        All workspaces
      </Link>
      <h1 className="text-2xl font-semibold">{workspace.name}</h1>
      <p className="break-all text-xs text-zinc-500">{workspace._id}</p>
      <p>
        {internal
          ? "Company-funded · Free seats · $0 payable"
          : `Standard billing · ${workspace.subscriptionStatus} · ${workspace.paidSeats} paid seats`}
      </p>
      <p className="text-sm text-zinc-400">
        {workspace.projectCount} projects · Created{" "}
        {new Date(workspace.createdAt).toLocaleString()}
      </p>
      <section className="space-y-2 rounded-xl border border-zinc-800 p-5">
        <h2 className="text-lg">Budget · {workspace.month} UTC</h2>
        <p>
          Spent: {formatUsd(workspace.budget.spentUsdMicros)} · Reserved:{" "}
          {formatUsd(workspace.budget.reservedUsdMicros)} · Cap:{" "}
          {workspace.budget.spendCapUsdMicros === null
            ? "No cap"
            : formatUsd(workspace.budget.spendCapUsdMicros)}
        </p>
        {internal ? (
          <>
            <p>
              Recorded provider cost:{" "}
              {formatUsd(workspace.budget.providerCostUsdMicros ?? 0)} ·
              Standard price:{" "}
              {formatUsd(workspace.budget.standardPriceUsdMicros ?? 0)}
            </p>
            <p className="text-sm text-zinc-400">
              Company budgets reserve the standard maximum and settle provider
              costs. Unknown costs retain conservative estimates or
              reconciliation holds.
            </p>
          </>
        ) : (
          <p>Usage balance: {formatUsd(workspace.balance)}</p>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg">Members and permissions</h2>
        <ul className="space-y-2">
          {workspace.members.map((m) => (
            <li key={m.userId}>
              <Link className="underline" to={`/users/${m.userId}`}>
                {m.email || m.userId}
              </Link>{" "}
              · {m.role}
            </li>
          ))}
        </ul>
      </section>
      {!internal && (
        <form
          className="space-y-3 rounded-xl border border-zinc-800 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            void (async () => {
              try {
                await enable({
                  workspaceId,
                  monthlyCapUsdMicros: parseUsdToMicros(cap),
                  reason,
                });
                setMessage("Company funding enabled.");
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : "Request failed",
                );
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <h2 className="text-lg">Enable company funding</h2>
          <p className="text-sm text-zinc-400">
            Only unused workspaces without payment or checkout history can be
            converted. Otherwise create a dedicated internal workspace. This
            grants free seats and company-funded usage.
          </p>
          <Label htmlFor="cap">Monthly budget (USD)</Label>
          <Input
            id="cap"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            inputMode="decimal"
            required
          />
          <Label htmlFor="reason">Audit reason</Label>
          <Input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
          />
          <Button disabled={busy}>
            {busy ? "Enabling…" : "Enable company funding"}
          </Button>
          {message && <p role="status">{message}</p>}
        </form>
      )}
    </>
  );
}
