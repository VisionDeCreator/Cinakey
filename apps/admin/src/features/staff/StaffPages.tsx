import { formatUsd } from "@cinakey/ui/i18n";
import { getLocale } from "@cinakey/ui/i18n";
import { I18nText, t, useLocale } from "@cinakey/ui/i18n";
import {
  Wallet,
  UserSearch,
  Info,
  Building2,
  Users,
  ReceiptText,
  ShieldCheck,
  Activity,
  Search,
  Box,
  Clock,
  BarChart3,
  CloudUpload,
  CalendarDays,
  Folder,
} from "lucide-react";
import { parseUsdToMicros } from "@cinakey/shared";
import { api } from "@cinakey/backend";
import { useMutation, useQuery } from "@cinakey/api-client";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@cinakey/ui/button";
import { Input } from "@cinakey/ui/input";
import { Label } from "@cinakey/ui/label";

export function StaffUsersPage() {
  useLocale();
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
        t(
          mode === "grant"
            ? "Granted {0} USD to {1}. Balance {2}."
            : "Adjusted {0} USD to {1}. Balance {2}.",
          { 0: amount, 1: result.email, 2: formatUsd(result.balanceAfter) },
        ),
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
      <form
        className="admin-card admin-funding-form space-y-4"
        onSubmit={(e) => void onSubmit(e)}
      >
        <header className="admin-funding-heading">
          <span>
            <Wallet size={22} />
          </span>
          <div>
            <h2>
              <I18nText text="Account lookup & usage funding" />
            </h2>
            <p>
              <I18nText text="Find an account by exact email to manage usage funds." />
            </p>
          </div>
        </header>
        <div className="space-y-2">
          <Label htmlFor="staff-email">
            <I18nText text="User email" />
          </Label>
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
            <I18nText text="Grant" />
          </Button>
          <Button
            type="button"
            aria-pressed={mode === "refund"}
            variant={mode === "refund" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("refund")}
          >
            <I18nText text="Adjustment" />
          </Button>
        </div>
        <div className="admin-funding-fields">
          <div className="space-y-2">
            <Label htmlFor="staff-amount">
              <I18nText text="Amount" />
            </Label>
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
            <Label htmlFor="staff-reason">
              <I18nText text="Reason (required)" />
            </Label>
            <Input
              id="staff-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("Reason for this funding change")}
              required
              minLength={3}
            />
          </div>
        </div>
        <Button
          type="submit"
          disabled={busy || !email.trim() || reason.trim().length < 3}
        >
          {busy
            ? t("Working…")
            : mode === "grant"
              ? t("Grant USD")
              : t("Adjust USD")}
        </Button>
        <p className="admin-funding-note">
          <Info size={16} />
          <I18nText text="Amounts are USD usage funds. Adjustments are not payment refunds." />
        </p>
        {message ? (
          <p role="status" className="text-sm text-emerald-400">
            {t(message ?? "")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-red-400">
            {t(error ?? "")}
          </p>
        ) : null}
      </form>

      <div className="admin-card admin-lookup space-y-3 text-sm">
        <h2>
          <I18nText text="Account details" />
        </h2>
        {lookup === undefined ? (
          <div className="admin-lookup-empty">
            <UserSearch size={48} />
            <h3>
              {lookupEmail.includes("@")
                ? t("Looking up account…")
                : t("Look up an account")}
            </h3>
            <p>
              {lookupEmail.includes("@")
                ? t("Loading account details.")
                : t(
                    "Enter an exact email to view account details and available funding actions.",
                  )}
            </p>
          </div>
        ) : lookup === null ? (
          <p className="text-zinc-500">
            <I18nText text="No user found." />
          </p>
        ) : (
          <div className="space-y-2 text-zinc-300">
            <p>
              {lookup.email}
              {lookup.name ? ` · ${lookup.name}` : ""}
              {lookup.isStaff ? " " + t("· staff") : ""}
            </p>
            <Link className="underline" to={`/users/${lookup.userId}`}>
              <I18nText text="Open account details" />
            </Link>
            <p>
              <I18nText text="Balance:" /> {formatUsd(lookup.balance)}
            </p>
            <ul className="max-h-64 space-y-1 overflow-auto text-xs text-zinc-500">
              {lookup.recentJobs.map((j) => (
                <li key={j._id}>
                  {j.model} · {t(j.status ?? "")} ·{" "}
                  {formatUsd(j.estimatedCostUsdMicros)} ·{" "}
                  {new Date(j.createdAt).toLocaleString(getLocale())}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function StaffProvidersPage() {
  useLocale();
  const health = useQuery(api.staff.providerHealth, {});
  const [search, setSearch] = useState("");
  const rows = health?.filter((row) =>
    row.model.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <div className="admin-page-heading">
        <h1>
          <I18nText text="Provider health" />
        </h1>
        <p>
          <I18nText text="Compare generation outcomes and response times by model." />
        </p>
      </div>
      <section className="admin-card admin-users-table admin-provider-table">
        <header>
          <div>
            <Activity size={24} className="admin-provider-accent" />
            <h2>
              <I18nText text="Model performance" />
            </h2>
          </div>
          <label className="admin-search">
            <Search size={18} />
            <Input
              aria-label={t("Search models")}
              placeholder={t("Search models…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </header>
        {health === undefined ? (
          <p role="status" className="p-6 text-zinc-400">
            <I18nText text="Loading provider metrics…" />
          </p>
        ) : (
          <>
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  <I18nText text="Model performance" />
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <I18nText text="Model" />
                    </th>
                    <th scope="col">
                      <I18nText text="Sample size" />
                    </th>
                    <th scope="col">
                      <I18nText text="Success rate" />
                    </th>
                    <th scope="col">
                      <I18nText text="Median latency (p50)" />
                    </th>
                    <th scope="col">
                      <I18nText text="Tail latency (p95)" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows?.map((row) => (
                    <tr key={row.model}>
                      <td>
                        <span className="admin-provider-model">
                          <Box size={20} />
                          {row.model}
                        </span>
                      </td>
                      <td>{row.sampleSize}</td>
                      <td>
                        {row.successRate === null ? (
                          "—"
                        ) : (
                          <span className="admin-provider-success">
                            <span>{Math.round(row.successRate * 100)}%</span>
                            <span
                              aria-hidden="true"
                              className="admin-provider-meter"
                            >
                              <span
                                style={{
                                  width: `${Math.max(0, Math.min(100, row.successRate * 100))}%`,
                                }}
                              />
                            </span>
                          </span>
                        )}
                      </td>
                      <td>
                        {row.latencyP50Ms === null
                          ? "—"
                          : `${Math.round(row.latencyP50Ms / 1000)}s`}
                      </td>
                      <td>
                        {row.latencyP95Ms === null
                          ? "—"
                          : `${Math.round(row.latencyP95Ms / 1000)}s`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows?.length === 0 && (
                <p role="status" className="p-6 text-zinc-400">
                  {search.trim()
                    ? t("No models match your search.")
                    : t("No provider metrics available yet.")}
                </p>
              )}
            </div>
            <footer>
              <I18nText text="Metrics reflect available job samples." />
            </footer>
          </>
        )}
      </section>
      <div className="admin-provider-guide">
        {[
          {
            Icon: Box,
            get title() {
              return t("Sample size");
            },
            get description() {
              return t("Number of jobs included in the metrics.");
            },
          },
          {
            Icon: Clock,
            get title() {
              return t("Median latency · p50");
            },
            get description() {
              return t("Half of measured jobs completed within this time.");
            },
          },
          {
            Icon: BarChart3,
            get title() {
              return t("Tail latency · p95");
            },
            get description() {
              return t("95% of measured jobs completed within this time.");
            },
          },
        ].map(({ Icon, title, description }) => (
          <section className="admin-card" key={title}>
            <Icon size={28} />
            <div>
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
          </section>
        ))}
      </div>
      <p className="admin-provider-note">
        <Info size={20} />
        <I18nText text="A dash means there is not enough data for that metric." />
      </p>
    </>
  );
}

function EgressRanking({
  title,
  kind,
  rows,
}: {
  title: string;
  kind: "user" | "project";
  rows: Array<{ id: string; bytes: number }>;
}) {
  useLocale();
  const max = Math.max(0, ...rows.map((row) => row.bytes));
  const Icon = kind === "user" ? Users : Folder;
  return (
    <section className="admin-card admin-egress-ranking">
      <header>
        <Icon size={26} />
        <h2>{title}</h2>
      </header>
      {rows.length === 0 ? (
        <p className="admin-egress-empty">
          <I18nText text="No" /> {t(kind ?? "")}{" "}
          <I18nText text="transfers recorded this month." />
        </p>
      ) : (
        <div className="admin-egress-scroll">
          <table>
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">
                  <I18nText text="Rank" />
                </th>
                <th scope="col">
                  {kind === "user" ? t("User ID") : t("Project ID")}
                </th>
                <th scope="col">
                  <I18nText text="Transferred" />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <td>{String(index + 1).padStart(2, "0")}</td>
                  <td className="admin-egress-id">{row.id}</td>
                  <td>
                    <div className="admin-egress-amount">
                      <span className="admin-provider-meter" aria-hidden="true">
                        <span
                          style={{
                            width: `${max > 0 ? Math.max(0, (row.bytes / max) * 100) : 0}%`,
                          }}
                        />
                      </span>
                      <span>{(row.bytes / (1024 * 1024)).toFixed(1)} MB</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function StaffEgressPage() {
  useLocale();
  const now = new Date();
  const data = useQuery(api.staff.monthlyEgress, {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  });
  const month = new Date(
    Date.UTC(
      data?.year ?? now.getUTCFullYear(),
      (data?.month ?? now.getUTCMonth() + 1) - 1,
      1,
    ),
  ).toLocaleDateString(getLocale(), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <>
      <div className="admin-egress-heading">
        <div className="admin-page-heading">
          <h1>
            <I18nText text="Egress" />
          </h1>
          <p>
            <I18nText text="Monitor outbound data transfer for the current month." />
          </p>
        </div>
        <span className="admin-egress-month">
          <CalendarDays size={18} />
          {month} <I18nText text="· UTC" />
        </span>
      </div>
      {data === undefined ? (
        <p role="status" className="admin-card p-6 text-zinc-400">
          <I18nText text="Loading transfer data…" />
        </p>
      ) : (
        <>
          <section className="admin-card admin-egress-summary">
            <span className="admin-egress-symbol">
              <CloudUpload size={40} />
            </span>
            <div>
              <h2>
                <I18nText text="Monthly transfer" />
              </h2>
              <strong>{(data.totalBytes / (1024 * 1024)).toFixed(1)} MB</strong>
              <p>
                <I18nText text="Total outbound data ·" /> {month}
              </p>
            </div>
          </section>
          <div className="admin-egress-rankings">
            <EgressRanking
              title={t("Top users")}
              kind="user"
              rows={data.topUsers.map((row) => ({
                id: row.userId,
                bytes: row.bytes,
              }))}
            />
            <EgressRanking
              title={t("Top projects")}
              kind="project"
              rows={data.topProjects.map((row) => ({
                id: row.projectId,
                bytes: row.bytes,
              }))}
            />
          </div>
        </>
      )}
      <p className="admin-provider-note">
        <Info size={20} />
        <I18nText text="Rankings show the largest transfers recorded this month. Amounts are displayed in MB." />
      </p>
    </>
  );
}

export function InternalWorkspaceForm() {
  useLocale();
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
        <header className="admin-funding-heading">
          <span>
            <Building2 size={24} />
          </span>
          <div>
            <h2>
              <I18nText text="Create company workspace" />
            </h2>
            <p>
              <I18nText text="Set up an internal workspace for an existing account." />
            </p>
          </div>
        </header>
        <div className="admin-workspace-create-fields">
          <div>
            <Label htmlFor="internal-owner">
              <I18nText text="Owner email (existing account)" />
            </Label>
            <Input
              placeholder="name@example.com"
              id="internal-owner"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="internal-name">
              <I18nText text="Workspace name" />
            </Label>
            <Input
              id="internal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </div>
          <div>
            <Label htmlFor="internal-cap">
              <I18nText text="Monthly company budget (USD)" />
            </Label>
            <Input
              id="internal-cap"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              inputMode="decimal"
              required
            />
          </div>
          <div>
            <Label htmlFor="internal-reason">
              <I18nText text="Reason for company funding" />
            </Label>
            <Input
              placeholder={t("Explain the business purpose")}
              id="internal-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={3}
              required
            />
          </div>
        </div>
        <Button
          disabled={
            busy ||
            !ownerEmail.trim() ||
            !name.trim() ||
            !cap.trim() ||
            reason.trim().length < 3
          }
        >
          {busy ? t("Creating…") : t("Create company workspace")}
        </Button>
        {message && (
          <p role="status" className="text-sm">
            {t(message ?? "")}
          </p>
        )}
      </form>
      <aside className="admin-card admin-company-guide">
        <h2>
          <Info size={22} />
          <I18nText text="Company funding" />
        </h2>
        <div>
          <Users />
          <section>
            <h3>
              <I18nText text="Free team seats" />
            </h3>
            <p>
              <I18nText text="Members keep their normal permissions." />
            </p>
          </section>
        </div>
        <div>
          <ReceiptText />
          <section>
            <h3>
              <I18nText text="Metered generation" />
            </h3>
            <p>
              <I18nText text="Provider costs and standard prices are still tracked." />
            </p>
          </section>
        </div>
        <div>
          <ShieldCheck />
          <section>
            <h3>
              <I18nText text="Monthly spending limit" />
            </h3>
            <p>
              <I18nText text="The budget limits company spending." />
            </p>
          </section>
        </div>
        <footer>
          <I18nText text="Platform administrators only." />
        </footer>
      </aside>
    </div>
  );
}
