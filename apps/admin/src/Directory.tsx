import { Search, ChevronRight, Folder, ArrowLeft, Wallet, Clock, ShieldCheck, Info, UserRound, CircleCheck, CircleMinus } from "lucide-react";
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
  const [search, setSearch] = useState("");
  const result = useQuery(api.staff.listUsers, { cursor });
  const users = result?.page.filter(user => `${user.email || ""} ${user.name || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <div className="admin-page-heading"><h1>Users</h1><p>Manage accounts, platform access, and usage funds.</p></div>
    <section className="admin-card admin-users-table">
      <header><div><h2>User accounts</h2><span className="admin-count">{result ? `${result.page.length} on this page` : "Loading"}</span></div><label className="admin-search"><Search size={18} /><Input aria-label="Search accounts on this page" placeholder="Search accounts on this page…" value={search} onChange={e => setSearch(e.target.value)} /></label></header>
      {!result ? <p role="status" className="p-6">Loading users…</p> : <>
        <div className="overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">User accounts</caption><thead><tr><th>Account</th><th>Name</th><th>Platform access</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>
          {users?.map(user => <tr key={user._id}><td><Link className="admin-user-link" to={`/users/${user._id}`}><span aria-hidden="true" className="admin-avatar">{(user.name || user.email || "U").slice(0,2).toUpperCase()}</span><span>{user.email || user._id}</span></Link></td><td>{user.name || "—"}</td><td><span className={`admin-role ${user.isStaff ? "admin-role-staff" : ""}`}>{user.isStaff ? "Administrator" : "Member"}</span></td><td><Link aria-label={`View ${user.email || user._id}`} to={`/users/${user._id}`}><ChevronRight size={18} /></Link></td></tr>)}
        </tbody></table>{users?.length === 0 && <p role="status" className="p-6 text-zinc-400">{search ? "No accounts match this search on the current page." : "No user accounts yet."}</p>}</div>
        <footer><span>Showing {users?.length} accounts on this page</span><Pagination cursor={cursor} isDone={result.isDone} next={() => { setCursor(result.continueCursor); setSearch(""); }} reset={() => { setCursor(null); setSearch(""); }} /></footer>
      </>}
    </section>
    <StaffUsersPage />
  </>;
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
      <Link className="admin-back" to="/users"><ArrowLeft size={16} />All users</Link>
      <header className="admin-user-heading"><span aria-hidden="true" className="admin-avatar admin-profile-avatar">{(user.name || user.email || "U").slice(0,2).toUpperCase()}</span><div><h1>{user.name || user.email || "User account"}</h1><p>{user.email || "No email provided"}</p><div className="admin-platform-access"><span className={`admin-role ${user.isStaff ? "admin-role-staff" : ""}`}>{user.isStaff ? "Administrator" : "Member"}</span><span>Platform access</span></div></div></header>
      <section className="admin-card admin-account-information"><header><UserRound size={24} /><h2>Account information</h2></header><dl>
        <div><dt>Name</dt><dd>{user.name || "—"}</dd></div>
        <div><dt>Platform access</dt><dd>{user.isStaff ? "Administrator" : "Member"}</dd></div>
        <div><dt>Email</dt><dd>{user.email || "—"}</dd></div>
        <div><dt>Created</dt><dd>{new Date(user.createdAt).toLocaleString()}</dd></div>
        <div><dt>Email verification</dt><dd className="admin-verification">{user.emailVerified ? <CircleCheck size={18} /> : <CircleMinus size={18} />}{user.emailVerified ? "Verified" : "Not verified"}</dd></div>
        <div><dt>User ID</dt><dd className="admin-account-id">{user._id}</dd></div>
      </dl></section>
      <section className="admin-card admin-users-table"><header><div><Folder size={22} /><h2>Workspace memberships</h2><span className="admin-count">{user.workspaces.length} {user.workspaces.length === 1 ? "workspace" : "workspaces"}</span></div></header><div className="overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Workspace memberships</caption><thead><tr><th>Workspace</th><th>Workspace role</th><th>Billing</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{user.workspaces.map(w => <tr key={w._id}><td><Link className="admin-workspace-link" to={`/workspaces/${w._id}`}><Folder aria-hidden="true" size={20} />{w.name}</Link></td><td><span className="admin-role capitalize">{w.role}</span></td><td><span className={`admin-role ${w.billingMode === "internal" ? "admin-role-staff" : ""}`}>{w.billingMode === "internal" ? "Company-funded" : "Standard billing"}</span></td><td><Link aria-label={`View ${w.name}`} to={`/workspaces/${w._id}`}><ChevronRight size={18} /></Link></td></tr>)}</tbody></table>{!user.workspaces.length && <p className="p-5 text-zinc-400">No workspace memberships.</p>}</div><footer>Select a workspace to view its details.</footer></section>
    </>
  );
}
export function WorkspacesPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const result = useQuery(api.staff.listWorkspaces, { cursor });
  const workspaces = result?.page.filter(w => `${w.name} ${w.ownerEmail || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <div className="admin-page-heading"><h1>Workspaces</h1><p>Browse workspaces, owners, and billing arrangements.</p></div>
    <section className="admin-card admin-users-table admin-workspaces-table">
      <header><div><h2>Workspace directory</h2><span className="admin-count">{result ? `${result.page.length} on this page` : "Loading"}</span></div><label className="admin-search"><Search size={18} /><Input aria-label="Search workspaces on this page" placeholder="Search this page…" value={search} onChange={e => setSearch(e.target.value)} /></label></header>
      {!result ? <p role="status" className="p-6">Loading workspaces…</p> : <>
        <div className="overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Workspaces</caption><thead><tr><th>Workspace</th><th>Owner</th><th>Billing</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>
          {workspaces?.map(w => <tr key={w._id}><td><Link className="admin-workspace-link" to={`/workspaces/${w._id}`}><Folder aria-hidden="true" size={20} /><span>{w.name}</span></Link></td><td>{w.ownerEmail || "—"}</td><td><span className={`admin-role ${w.billingMode === "internal" ? "admin-role-staff" : ""}`}>{w.billingMode === "internal" ? "Company-funded" : "Standard"}</span></td><td><Link aria-label={`View ${w.name}`} to={`/workspaces/${w._id}`}><ChevronRight size={18} /></Link></td></tr>)}
        </tbody></table>{workspaces?.length === 0 && <p role="status" className="p-6 text-zinc-400">{search ? "No workspaces match this search on the current page." : "No workspaces yet."}</p>}</div>
        <footer><span>Showing {workspaces?.length} workspaces on this page</span><Pagination cursor={cursor} isDone={result.isDone} next={() => { setCursor(result.continueCursor); setSearch(""); }} reset={() => { setCursor(null); setSearch(""); }} /></footer>
      </>}
    </section>
    <InternalWorkspaceForm />
  </>;
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
  const committed = workspace.budget.spentUsdMicros + workspace.budget.reservedUsdMicros;
  const limit = workspace.budget.spendCapUsdMicros;
  const percent = limit !== null && limit > 0 ? Math.max(0, committed / limit * 100) : null;
  return (
    <>
      <Link className="admin-back" to="/workspaces"><ArrowLeft size={16} />All workspaces</Link>
      <header className="admin-workspace-heading"><span className="admin-workspace-symbol"><Folder size={32} /></span><div><div className="admin-workspace-title"><h1>{workspace.name}</h1><span className={`admin-role ${internal ? "admin-role-staff" : ""}`}>{internal ? "Company-funded" : "Standard billing"}</span></div><p>{workspace.projectCount} projects · Created {new Date(workspace.createdAt).toLocaleDateString()}</p><p className="admin-workspace-id">Workspace ID: {workspace._id}</p><div className="admin-workspace-pills">{internal ? <><span>Free team seats</span><span>$0 payable</span></> : <><span>{workspace.subscriptionStatus}</span><span>{workspace.paidSeats} paid seats</span></>}</div></div></header>
      <section className="admin-card admin-budget-card">
        <header><h2>Monthly budget</h2><span>{workspace.month} · UTC</span></header>
        <div className="admin-budget-stats">{[{label:"Spent",value:formatUsd(workspace.budget.spentUsdMicros),Icon:Wallet},{label:"Reserved",value:formatUsd(workspace.budget.reservedUsdMicros),Icon:Clock},{label:"Monthly cap",value:limit === null ? "No cap" : formatUsd(limit),Icon:ShieldCheck}].map(({label,value,Icon}) => <div key={label}><Icon size={30} /><div><span>{label}</span><strong>{value}</strong></div></div>)}</div>
        {percent !== null && <div className="admin-budget-progress"><div role="progressbar" aria-label="Monthly budget committed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100,percent)} aria-valuetext={`${formatUsd(committed)} committed of ${formatUsd(limit!)}`}><span style={{width:`${Math.min(100,percent)}%`}} /></div><p><span>{formatUsd(committed)} of {formatUsd(limit!)} committed</span><span>{Math.round(percent)}%</span></p></div>}
        {percent === null && <p className="admin-budget-uncapped">{formatUsd(committed)} committed{limit === null ? " · No monthly cap" : " · Monthly cap is zero"}</p>}
        <div className="admin-budget-costs">{internal ? <><div><span>Recorded provider cost</span><strong>{formatUsd(workspace.budget.providerCostUsdMicros ?? 0)}</strong></div><div><span>Standard usage price</span><strong>{formatUsd(workspace.budget.standardPriceUsdMicros ?? 0)}</strong></div></> : <div><span>Usage balance</span><strong>{formatUsd(workspace.balance)}</strong></div>}</div>
        {internal && <p className="admin-budget-note"><Info size={20} /><span>Company budgets reserve the standard maximum and settle provider costs. Unknown costs retain conservative estimates or reconciliation holds.</span></p>}
      </section>
      <section className="admin-card admin-users-table admin-members-table"><header><div><h2>Members & permissions</h2><span className="admin-count">{workspace.members.length} {workspace.members.length === 1 ? "member" : "members"}</span></div></header><div className="overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Workspace members</caption><thead><tr><th>Account</th><th>Workspace role</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{workspace.members.map(m => <tr key={m.userId}><td><Link className="admin-user-link" to={`/users/${m.userId}`}><span aria-hidden="true" className="admin-avatar">{(m.email || "U").slice(0,2).toUpperCase()}</span>{m.email || m.userId}</Link></td><td><span className="admin-role capitalize">{m.role}</span></td><td><Link aria-label={`View ${m.email || m.userId}`} to={`/users/${m.userId}`}><ChevronRight size={18} /></Link></td></tr>)}</tbody></table>{!workspace.members.length && <p className="p-5 text-zinc-400">No workspace members.</p>}</div><footer>Select an account to view its details.</footer></section>
      {!internal && (
        <form
          className="admin-card admin-funding-form space-y-3"
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
          <Button disabled={busy || reason.trim().length < 3 || !cap.trim()}>
            {busy ? "Enabling…" : "Enable company funding"}
          </Button>
          {message && <p role="status">{message}</p>}
        </form>
      )}
    </>
  );
}
