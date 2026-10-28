import { Wallet, UserSearch, Info, Building2, Users, ReceiptText, ShieldCheck, Shield, FilePenLine, Quote, Check, X, LoaderCircle, Activity, Search, Box, Clock, BarChart3, CloudUpload, CalendarDays, Folder, ScrollText, UserRound, Terminal } from "lucide-react";
import { formatUsd, parseUsdToMicros } from "@cinakey/shared";
import { api } from "@cinakey/backend";
import { useMutation, useQuery } from "@cinakey/api-client";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@cinakey/ui/button";
import { Input } from "@cinakey/ui/input";
import { Label } from "@cinakey/ui/label";

export function StaffUsersPage() {
  const [email, setEmail] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const [amount, setAmount] = useState("10.00");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"grant" | "refund">("grant");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = useQuery(
    api.staff.lookupUser,
    lookupEmail.includes("@") ? { email: lookupEmail } : "skip",
  );
  const fundingRequest = useRef<string | null>(null);
  const grant = useMutation(api.staff.grantUsd);
  const refund = useMutation(api.staff.adjustUsd);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const fn = mode === "grant" ? grant : refund;
      const result = await fn({
        email: email.trim(),
        amount: parseUsdToMicros(amount),
        requestId: (fundingRequest.current ??= crypto.randomUUID()),
        reason: reason.trim(),
      });
      fundingRequest.current = null;
      setMessage(
        `${mode === "grant" ? "Granted" : "Adjusted"} ${amount} USD to ${result.email}. Balance ${formatUsd(result.balanceAfter)}.`,
      );
      setLookupEmail(email.trim());
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-funding-grid">
      <form className="admin-card admin-funding-form space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <header className="admin-funding-heading"><span><Wallet size={22} /></span><div><h2>Account lookup & usage funding</h2><p>Find an account by exact email to manage usage funds.</p></div></header>
        <div className="space-y-2">
          <Label htmlFor="staff-email">User email</Label>
          <Input
            placeholder="name@example.com"
            id="staff-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setLookupEmail(e.target.value);
            }}
            required
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            aria-pressed={mode === "grant"}
            variant={mode === "grant" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("grant")}
          >
            Grant
          </Button>
          <Button
            type="button"
            aria-pressed={mode === "refund"}
            variant={mode === "refund" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("refund")}
          >
            Adjustment
          </Button>
        </div>
        <div className="admin-funding-fields">
        <div className="space-y-2">
          <Label htmlFor="staff-amount">Amount</Label>
          <Input
            id="staff-amount"
            type="text"
            inputMode="decimal"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="staff-reason">Reason (required)</Label>
          <Input
            id="staff-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for this funding change"
            required
            minLength={3}
          />
        </div>
        </div>
        <Button type="submit" disabled={busy || !email.trim() || reason.trim().length < 3}>
          {busy ? "Working…" : mode === "grant" ? "Grant USD" : "Adjust USD"}
        </Button>
        <p className="admin-funding-note"><Info size={16} />Amounts are USD usage funds. Adjustments are not payment refunds.</p>
        {message ? <p role="status" className="text-sm text-emerald-400">{message}</p> : null}
        {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
      </form>

      <div className="admin-card admin-lookup space-y-3 text-sm">
        <h2>Account details</h2>
        {lookup === undefined ? (
          <div className="admin-lookup-empty"><UserSearch size={48} /><h3>{lookupEmail.includes("@") ? "Looking up account…" : "Look up an account"}</h3><p>{lookupEmail.includes("@") ? "Loading account details." : "Enter an exact email to view account details and available funding actions."}</p></div>
        ) : lookup === null ? (
          <p className="text-zinc-500">No user found.</p>
        ) : (
          <div className="space-y-2 text-zinc-300">
            <p>
              {lookup.email}
              {lookup.name ? ` · ${lookup.name}` : ""}
              {lookup.isStaff ? " · staff" : ""}
            </p>
            <Link className="underline" to={`/users/${lookup.userId}`}>
              Open account details
            </Link>
            <p>Balance: {formatUsd(lookup.balance)}</p>
            <ul className="max-h-64 space-y-1 overflow-auto text-xs text-zinc-500">
              {lookup.recentJobs.map((j) => (
                <li key={j._id}>
                  {j.model} · {j.status} · {formatUsd(j.estimatedCostUsdMicros)}{" "}
                  · {new Date(j.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function StaffModerationPage() {
  const queue = useQuery(api.staff.listModerationQueue, { limit: 50 });
  const resolve = useMutation(api.moderation.resolveFlag);
  const [reason, setReason] = useState("Reviewed");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(flagId: string, status: "resolved" | "dismissed") {
    if (busyId || !reason.trim()) return;
    setBusyId(flagId);
    setError(null);
    setMessage(null);
    try {
      await resolve({ flagId: flagId as never, status, reason: reason.trim() });
      setMessage(status === "resolved" ? "Flag resolved." : "Flag dismissed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this flag. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return <>
    <div className="admin-page-heading"><h1>Moderation</h1><p>Review open flags and record a reason for each decision.</p></div>
    <section className="admin-card admin-moderation-reason"><Label htmlFor="mod-reason"><FilePenLine size={20} />Resolution reason</Label><Input id="mod-reason" value={reason} disabled={busyId !== null} onChange={e => setReason(e.target.value)} aria-describedby="mod-reason-help" /><p id="mod-reason-help">This reason is recorded with your next Resolve or Dismiss action.</p></section>
    {error && <p role="alert" className="admin-moderation-error">{error}</p>}
    {message && <p role="status" className="admin-moderation-feedback">{message}</p>}
    <section className="admin-card admin-moderation-queue"><header><Shield size={24} /><h2>Open flags</h2>{queue && <span className="admin-count">{queue.length} {queue.length === 1 ? "flag" : "flags"}</span>}</header>
      {queue === undefined ? <p role="status" className="p-6 text-zinc-400">Loading queue…</p> : queue.length === 0 ? <div className="admin-moderation-empty"><ShieldCheck size={48} /><h3>No open flags</h3><p>There are no flagged items awaiting review.</p></div> : <ul>{queue.map(f => <li key={f._id} className="admin-flag"><div className="admin-flag-top"><div><div className="admin-flag-title"><h3>Flagged content</h3><span className="admin-role admin-role-staff">{f.verdict}</span></div><dl><div><dt>Stage</dt><dd>{f.stage}</dd></div><div><dt>Rule</dt><dd>{f.ruleId}</dd></div></dl></div><div className="admin-flag-actions"><Button disabled={busyId !== null || !reason.trim()} onClick={() => void act(f._id, "resolved")}>{busyId === f._id ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}Resolve</Button><Button variant="outline" disabled={busyId !== null || !reason.trim()} onClick={() => void act(f._id, "dismissed")}><X size={16} />Dismiss</Button></div></div>{f.snippet ? <blockquote><Quote size={18} /><p>{f.snippet}</p></blockquote> : <p className="admin-flag-no-excerpt">No content excerpt available.</p>}</li>)}</ul>}
    </section>
  </>;
}

export function StaffProvidersPage() {
  const health = useQuery(api.staff.providerHealth, {});
  const [search, setSearch] = useState("");
  const rows = health?.filter(row => row.model.toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <div className="admin-page-heading"><h1>Provider health</h1><p>Compare generation outcomes and response times by model.</p></div>
    <section className="admin-card admin-users-table admin-provider-table"><header><div><Activity size={24} className="admin-provider-accent" /><h2>Model performance</h2></div><label className="admin-search"><Search size={18} /><Input aria-label="Search models" placeholder="Search models…" value={search} onChange={e => setSearch(e.target.value)} /></label></header>
      {health === undefined ? <p role="status" className="p-6 text-zinc-400">Loading provider metrics…</p> : <><div className="overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Model performance</caption><thead><tr><th scope="col">Model</th><th scope="col">Sample size</th><th scope="col">Success rate</th><th scope="col">Median latency (p50)</th><th scope="col">Tail latency (p95)</th></tr></thead><tbody>{rows?.map(row => <tr key={row.model}><td><span className="admin-provider-model"><Box size={20} />{row.model}</span></td><td>{row.sampleSize}</td><td>{row.successRate === null ? "—" : <span className="admin-provider-success"><span>{Math.round(row.successRate * 100)}%</span><span aria-hidden="true" className="admin-provider-meter"><span style={{width:`${Math.max(0,Math.min(100,row.successRate * 100))}%`}} /></span></span>}</td><td>{row.latencyP50Ms === null ? "—" : `${Math.round(row.latencyP50Ms / 1000)}s`}</td><td>{row.latencyP95Ms === null ? "—" : `${Math.round(row.latencyP95Ms / 1000)}s`}</td></tr>)}</tbody></table>{rows?.length === 0 && <p role="status" className="p-6 text-zinc-400">{search.trim() ? "No models match your search." : "No provider metrics available yet."}</p>}</div><footer>Metrics reflect available job samples.</footer></>}
    </section>
    <div className="admin-provider-guide">{[{Icon:Box,title:"Sample size",description:"Number of jobs included in the metrics."},{Icon:Clock,title:"Median latency · p50",description:"Half of measured jobs completed within this time."},{Icon:BarChart3,title:"Tail latency · p95",description:"95% of measured jobs completed within this time."}].map(({Icon,title,description}) => <section className="admin-card" key={title}><Icon size={28} /><div><h2>{title}</h2><p>{description}</p></div></section>)}</div>
    <p className="admin-provider-note"><Info size={20} />A dash means there is not enough data for that metric.</p>
  </>;
}

function EgressRanking({ title, kind, rows }: { title: string; kind: "user" | "project"; rows: Array<{ id: string; bytes: number }> }) {
  const max = Math.max(0, ...rows.map(row => row.bytes));
  const Icon = kind === "user" ? Users : Folder;
  return <section className="admin-card admin-egress-ranking"><header><Icon size={26} /><h2>{title}</h2></header>{rows.length === 0 ? <p className="admin-egress-empty">No {kind} transfers recorded this month.</p> : <div className="admin-egress-scroll"><table><caption className="sr-only">{title}</caption><thead><tr><th scope="col">Rank</th><th scope="col">{kind === "user" ? "User ID" : "Project ID"}</th><th scope="col">Transferred</th></tr></thead><tbody>{rows.map((row,index) => <tr key={row.id}><td>{String(index + 1).padStart(2,"0")}</td><td className="admin-egress-id">{row.id}</td><td><div className="admin-egress-amount"><span className="admin-provider-meter" aria-hidden="true"><span style={{width:`${max > 0 ? Math.max(0,row.bytes / max * 100) : 0}%`}} /></span><span>{(row.bytes / (1024 * 1024)).toFixed(1)} MB</span></div></td></tr>)}</tbody></table></div>}</section>;
}

export function StaffEgressPage() {
  const now = new Date();
  const data = useQuery(api.staff.monthlyEgress, { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  const month = new Date(Date.UTC(data?.year ?? now.getUTCFullYear(), (data?.month ?? now.getUTCMonth() + 1) - 1, 1)).toLocaleDateString(undefined,{month:"long",year:"numeric",timeZone:"UTC"});
  return <>
    <div className="admin-egress-heading"><div className="admin-page-heading"><h1>Egress</h1><p>Monitor outbound data transfer for the current month.</p></div><span className="admin-egress-month"><CalendarDays size={18} />{month} · UTC</span></div>
    {data === undefined ? <p role="status" className="admin-card p-6 text-zinc-400">Loading transfer data…</p> : <><section className="admin-card admin-egress-summary"><span className="admin-egress-symbol"><CloudUpload size={40} /></span><div><h2>Monthly transfer</h2><strong>{(data.totalBytes / (1024 * 1024)).toFixed(1)} MB</strong><p>Total outbound data · {month}</p></div></section><div className="admin-egress-rankings"><EgressRanking title="Top users" kind="user" rows={data.topUsers.map(row => ({id:row.userId,bytes:row.bytes}))} /><EgressRanking title="Top projects" kind="project" rows={data.topProjects.map(row => ({id:row.projectId,bytes:row.bytes}))} /></div></>}
    <p className="admin-provider-note"><Info size={20} />Rankings show the largest transfers recorded this month. Amounts are displayed in MB.</p>
  </>;
}

export function StaffAuditPage() {
  const rows = useQuery(api.staff.listAuditLog, { limit: 100 });
  const [search, setSearch] = useState("");
  const matches = rows?.filter(row => `${row.action} ${row.reason || ""} ${row.actorType === "operator" ? "deployment operator" : row.actorUserId || ""} ${new Date(row.createdAt).toLocaleString()}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <div className="admin-page-heading"><h1>Audit log</h1><p>Review recorded administrative actions and their reasons.</p></div>
    <section className="admin-card admin-users-table admin-audit-table"><header><div><ScrollText size={24} className="admin-provider-accent" /><h2>Recent activity</h2>{rows && <span className="admin-count">{rows.length} {rows.length === 1 ? "entry" : "entries"}</span>}</div><label className="admin-search"><Search size={18} /><Input aria-label="Search recent audit entries" placeholder="Search these entries…" value={search} onChange={e => setSearch(e.target.value)} /></label></header><p className="admin-audit-limit">Showing up to 100 recent entries. Search applies to these entries.</p>
      {rows === undefined ? <p role="status" className="p-6 text-zinc-400">Loading audit log…</p> : <><div className="overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Recent administrative activity</caption><thead><tr><th scope="col">Action</th><th scope="col">Reason</th><th scope="col">Actor</th><th scope="col">Recorded at</th></tr></thead><tbody>{matches?.map(row => <tr key={row._id}><td><span className="admin-audit-action"><ScrollText size={18} />{row.action}</span></td><td>{row.reason || "—"}</td><td><span className="admin-audit-actor">{row.actorType === "operator" ? <Terminal size={18} /> : <UserRound size={18} />}<span>{row.actorType === "operator" ? "Deployment operator" : row.actorUserId || "Unknown actor"}</span></span></td><td><time dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString()}</time></td></tr>)}</tbody></table>{matches?.length === 0 && <p role="status" className="p-6 text-zinc-400">{search.trim() ? "No recent entries match your search." : "No audit entries recorded yet."}</p>}</div><footer><Info size={16} />A dash means no reason was recorded.</footer></>}
    </section>
    <section className="admin-card admin-audit-guide"><UserRound size={26} /><div><h2>Recorded actors</h2><p>Actions may be recorded against an administrator account or a deployment operator.</p></div></section>
  </>;
}

export function InternalWorkspaceForm() {
  const create = useMutation(api.staff.createInternalWorkspace);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [name, setName] = useState("Cinakey Internal");
  const [cap, setCap] = useState("100");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div className="admin-workspace-create-grid">
    <form
      className="admin-card admin-funding-form space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        void (async () => {
          try {
            await create({
              ownerEmail,
              name,
              monthlyCapUsdMicros: parseUsdToMicros(cap),
              reason,
            });
            setMessage(
              "Company-funded workspace created. The owner can select it from the workspace menu and invite the team.",
            );
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "Could not create workspace",
            );
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <header className="admin-funding-heading"><span><Building2 size={24} /></span><div><h2>Create company workspace</h2><p>Set up an internal workspace for an existing account.</p></div></header>
      <div className="admin-workspace-create-fields">
      <div>
      <Label htmlFor="internal-owner">Owner email (existing account)</Label>
      <Input
        placeholder="name@example.com"
        id="internal-owner"
        type="email"
        value={ownerEmail}
        onChange={(e) => setOwnerEmail(e.target.value)}
        required
      />
      </div><div>
      <Label htmlFor="internal-name">Workspace name</Label>
      <Input
        id="internal-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        required
      />
      </div><div>
      <Label htmlFor="internal-cap">Monthly company budget (USD)</Label>
      <Input
        id="internal-cap"
        value={cap}
        onChange={(e) => setCap(e.target.value)}
        inputMode="decimal"
        required
      />
      </div><div>
      <Label htmlFor="internal-reason">Reason for company funding</Label>
      <Input
        placeholder="Explain the business purpose"
        id="internal-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        minLength={3}
        required
      />
      </div></div>
      <Button disabled={busy || !ownerEmail.trim() || !name.trim() || !cap.trim() || reason.trim().length < 3}>
        {busy ? "Creating…" : "Create company workspace"}
      </Button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </form>
    <aside className="admin-card admin-company-guide"><h2><Info size={22} />Company funding</h2><div><Users /><section><h3>Free team seats</h3><p>Members keep their normal permissions.</p></section></div><div><ReceiptText /><section><h3>Metered generation</h3><p>Provider costs and standard prices are still tracked.</p></section></div><div><ShieldCheck /><section><h3>Monthly spending limit</h3><p>The budget limits company spending.</p></section></div><footer>Platform administrators only.</footer></aside>
    </div>
  );
}
