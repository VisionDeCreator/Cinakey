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
    <div className="grid gap-8 lg:grid-cols-2">
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <div className="space-y-2">
          <Label htmlFor="staff-email">User email</Label>
          <Input
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
            variant={mode === "grant" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("grant")}
          >
            Grant
          </Button>
          <Button
            type="button"
            variant={mode === "refund" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("refund")}
          >
            Adjustment
          </Button>
        </div>
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
            placeholder="Launch support / refund failed job"
            required
            minLength={3}
          />
        </div>
        <Button type="submit" disabled={busy || reason.trim().length < 3}>
          {busy ? "Working…" : mode === "grant" ? "Grant USD" : "Adjust USD"}
        </Button>
        {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </form>

      <div className="space-y-3 text-sm">
        <h2 className="font-medium text-zinc-200">Lookup</h2>
        {lookup === undefined ? (
          <p className="text-zinc-500">Type an email to look up…</p>
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

  async function act(flagId: string, status: "resolved" | "dismissed") {
    setBusyId(flagId);
    try {
      await resolve({
        flagId: flagId as never,
        status,
        reason,
      });
    } finally {
      setBusyId(null);
    }
  }

  if (queue === undefined) {
    return <p className="text-sm text-zinc-500">Loading queue…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="mod-reason">Resolution reason</Label>
        <Input
          id="mod-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {queue.length === 0 ? (
        <p className="text-sm text-zinc-500">No open flags.</p>
      ) : (
        <ul className="space-y-3">
          {queue.map((f) => (
            <li
              key={f._id}
              className="border border-zinc-800 p-3 text-sm text-zinc-300"
            >
              <p>
                <span className="text-amber-400">{f.verdict}</span> · {f.stage}{" "}
                · {f.ruleId}
              </p>
              {f.snippet ? (
                <p className="mt-1 text-xs text-zinc-500">“{f.snippet}”</p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={busyId === f._id}
                  onClick={() => void act(f._id, "resolved")}
                >
                  Resolve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === f._id}
                  onClick={() => void act(f._id, "dismissed")}
                >
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StaffProvidersPage() {
  const health = useQuery(api.staff.providerHealth, {});
  if (health === undefined) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-zinc-500">
          <tr>
            <th className="py-2 pr-4">Model</th>
            <th className="py-2 pr-4">Sample</th>
            <th className="py-2 pr-4">Success</th>
            <th className="py-2 pr-4">p50</th>
            <th className="py-2 pr-4">p95</th>
          </tr>
        </thead>
        <tbody>
          {health.map((row) => (
            <tr
              key={row.model}
              className="border-t border-zinc-800 text-zinc-300"
            >
              <td className="py-2 pr-4">{row.model}</td>
              <td className="py-2 pr-4">{row.sampleSize}</td>
              <td className="py-2 pr-4">
                {row.successRate === null
                  ? "—"
                  : `${Math.round(row.successRate * 100)}%`}
              </td>
              <td className="py-2 pr-4">
                {row.latencyP50Ms === null
                  ? "—"
                  : `${Math.round(row.latencyP50Ms / 1000)}s`}
              </td>
              <td className="py-2 pr-4">
                {row.latencyP95Ms === null
                  ? "—"
                  : `${Math.round(row.latencyP95Ms / 1000)}s`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StaffEgressPage() {
  const now = new Date();
  const data = useQuery(api.staff.monthlyEgress, {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  });
  if (data === undefined) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }
  return (
    <div className="space-y-4 text-sm text-zinc-300">
      <p>
        {data.year}-{String(data.month).padStart(2, "0")} total:{" "}
        {(data.totalBytes / (1024 * 1024)).toFixed(1)} MB
      </p>
      <div>
        <h3 className="font-medium text-zinc-200">Top users</h3>
        <ul className="mt-2 space-y-1 text-xs text-zinc-500">
          {data.topUsers.map((u) => (
            <li key={u.userId}>
              {u.userId} · {(u.bytes / (1024 * 1024)).toFixed(1)} MB
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-medium text-zinc-200">Top projects</h3>
        <ul className="mt-2 space-y-1 text-xs text-zinc-500">
          {data.topProjects.map((p) => (
            <li key={p.projectId}>
              {p.projectId} · {(p.bytes / (1024 * 1024)).toFixed(1)} MB
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function StaffAuditPage() {
  const rows = useQuery(api.staff.listAuditLog, { limit: 100 });
  if (rows === undefined) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }
  return (
    <ul className="space-y-2 text-xs text-zinc-400">
      {rows.map((r) => (
        <li key={r._id} className="border-b border-zinc-900 pb-2">
          <span className="text-zinc-200">{r.action}</span>
          {r.reason ? ` — ${r.reason}` : ""}
          <div className="text-zinc-600">
            {new Date(r.createdAt).toLocaleString()} · actor{" "}
            {r.actorType === "operator" ? "deployment operator" : r.actorUserId}
          </div>
        </li>
      ))}
    </ul>
  );
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
    <form
      className="space-y-3 rounded-xl border border-zinc-800 p-5 lg:col-span-2"
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
      <h2 className="font-medium">Create internal company workspace</h2>
      <p className="text-sm text-zinc-400">
        Platform administrators only. Free seats and full access with normal
        permissions. Provider costs and standard prices remain metered; the
        monthly budget limits company spending.
      </p>
      <Label htmlFor="internal-owner">Owner email (existing account)</Label>
      <Input
        id="internal-owner"
        type="email"
        value={ownerEmail}
        onChange={(e) => setOwnerEmail(e.target.value)}
        required
      />
      <Label htmlFor="internal-name">Workspace name</Label>
      <Input
        id="internal-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        required
      />
      <Label htmlFor="internal-cap">Monthly company budget (USD)</Label>
      <Input
        id="internal-cap"
        value={cap}
        onChange={(e) => setCap(e.target.value)}
        inputMode="decimal"
        required
      />
      <Label htmlFor="internal-reason">Reason for company funding</Label>
      <Input
        id="internal-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        minLength={3}
        required
      />
      <Button disabled={busy}>
        {busy ? "Creating…" : "Create company workspace"}
      </Button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </form>
  );
}
