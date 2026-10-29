import { getLocale, formatUsd, I18nText, t, useLocale } from "@cinakey/ui/i18n";
import { useRef, useState } from "react";
import { api, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@cinakey/api-client";
import {
  ANALYTICS_METRICS,
  ANALYTICS_DIMENSIONS,
  ANALYTICS_FINANCIAL_METRICS,
  type AnalyticsMetric,
  type AnalyticsDimension,
} from "@cinakey/shared";
import { Button } from "@cinakey/ui/button";
import { Input } from "@cinakey/ui/input";
import { Permission } from "./Permissions";
const day = 86400000;
const date = (time: number) => new Date(time).toISOString().slice(0, 10);
const display = (key: string, value: number) =>
  key.endsWith("Micros") ? formatUsd(value) : value.toLocaleString(getLocale());
function Report({ reportId }: { reportId: Id<"analyticsReports"> }) {
  useLocale();
  const report = useQuery(api.adminAnalytics.detail, { reportId });
  const [dimension, setDimension] = useState<AnalyticsDimension>("day"),
    [cursor, setCursor] = useState<string | null>(null),
    [metric, setMetric] = useState<AnalyticsMetric>("jobs"),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const rows = useQuery(
    api.adminAnalytics.rows,
    report?.status === "completed"
      ? { reportId, dimension, paginationOpts: { numItems: 25, cursor } }
      : "skip",
  );
  const cancel = useMutation(api.adminAnalytics.cancel),
    resume = useMutation(api.adminAnalytics.resume),
    remove = useMutation(api.adminAnalytics.remove),
    exportCsv = useMutation(api.adminAnalytics.exportCsv);
  async function action(run: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await run();
      setMessage(t("Done."));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  if (report === undefined)
    return (
      <p role="status">
        <I18nText text="Loading report…" />
      </p>
    );
  if (!report)
    return (
      <p>
        <I18nText text="Report removed." />
      </p>
    );
  const args = { reportId, reason, requestId: crypto.randomUUID() };
  const m = report.metrics ?? {};
  return (
    <section className="space-y-4 rounded border border-zinc-700 p-4">
      <h2 className="text-xl">
        {t("{from} to {to} (end exclusive, UTC)", {
          from: date(report.from),
          to: date(report.to),
        })}
      </h2>
      <p>
        {t(
          "Status: {status}; scanned records: {count}; stage: {stage}; worker: {worker}.",
          {
            status: t(report.status),
            count: report.processed.toLocaleString(getLocale()),
            stage: t(report.stageName),
            worker: t(report.taskState ?? "none"),
          },
        )}
      </p>
      <p>
        {t("Scope: {scope}. Requested {requested}.", {
          scope: report.workspaceId ?? t("All workspaces"),
          requested: new Date(report.createdAt).toISOString(),
        })}{" "}
        {report.completedAt &&
          t("Completed {completed}.", {
            completed: new Date(report.completedAt).toISOString(),
          })}
      </p>
      {report.status === "completed" && (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            {Object.entries(m).map(([key, value]) => (
              <div key={key}>
                <dt className="text-sm text-zinc-400">
                  {t(
                    ANALYTICS_METRICS[key as AnalyticsMetric].replace(
                      " (USD micros)",
                      " (USD)",
                    ),
                  )}
                </dt>
                <dd>{display(key, value)}</dd>
              </div>
            ))}
          </dl>
          <p>
            {m.priorActiveAccounts
              ? t(
                  "Returning active accounts: {percent}% of the previous equal-length window.",
                  {
                    percent: (
                      ((m.returningAccounts ?? 0) / m.priorActiveAccounts) *
                      100
                    ).toFixed(1),
                  },
                )
              : t("No previous-window baseline")}
          </p>
          {report.financial && (
            <p>
              {t(
                "Supplier cost evidence: {known} known / {total} settlements. Matched customer charge less matched supplier cost: {spread}. This excludes missing costs and operating expenses.",
                {
                  known: m.supplierKnownSettlements ?? 0,
                  total: m.usageSettlements ?? 0,
                  spread: display(
                    "spreadMicros",
                    (m.matchedCustomerMicros ?? 0) -
                      (m.matchedCustomerCostMicros ?? 0),
                  ),
                },
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <label>
              <I18nText text="Group" />{" "}
              <select
                value={dimension}
                onChange={(e) => {
                  setDimension(e.target.value as AnalyticsDimension);
                  setCursor(null);
                }}
              >
                {ANALYTICS_DIMENSIONS.map((d) => (
                  <option key={d} value={d}>
                    {t(d)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <I18nText text="Metric" />{" "}
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as AnalyticsMetric)}
              >
                {Object.entries(ANALYTICS_METRICS)
                  .filter(
                    ([key]) =>
                      report.financial ||
                      !ANALYTICS_FINANCIAL_METRICS.has(key as AnalyticsMetric),
                  )
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {t(label.replace(" (USD micros)", " (USD)"))}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>{t(dimension)}</th>
                <th>
                  {t(
                    ANALYTICS_METRICS[metric].replace(
                      " (USD micros)",
                      " (USD)",
                    ),
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows?.page.map((row) => (
                <tr key={row.key}>
                  <td>{row.key}</td>
                  <td>{display(metric, row.metrics[metric] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows?.page.length === 0 && (
            <p>
              <I18nText text="No recorded data for this grouping." />
            </p>
          )}
          <Button disabled={!cursor} onClick={() => setCursor(null)}>
            <I18nText text="First page" />
          </Button>{" "}
          <Button
            disabled={!rows || rows.isDone}
            onClick={() => rows && setCursor(rows.continueCursor)}
          >
            <I18nText text="Next page" />
          </Button>
        </>
      )}
      <Input
        aria-label={t("Report action reason")}
        placeholder={t("Reason for report action (10–500 characters)")}
        minLength={10}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex flex-wrap gap-3">
        <Permission permission="analytics.run">
          {report.status === "running" && (
            <>
              <Button
                disabled={busy || reason.trim().length < 10}
                onClick={() => void action(() => cancel(args))}
              >
                <I18nText text="Cancel report" />
              </Button>
              <Button
                disabled={
                  busy ||
                  reason.trim().length < 10 ||
                  (report.taskState !== "failed" && report.taskState !== null)
                }
                onClick={() => void action(() => resume(args))}
              >
                <I18nText text="Resume failed report" />
              </Button>
            </>
          )}
          <Button
            disabled={
              busy || reason.trim().length < 10 || report.status === "deleting"
            }
            onClick={() => void action(() => remove(args))}
          >
            <I18nText text="Delete report (owner or platform administrator)" />
          </Button>
        </Permission>
        <Permission permission="analytics.export">
          {report.status === "completed" && (
            <Button
              disabled={busy || reason.trim().length < 10}
              onClick={() =>
                void action(async () => {
                  const result = await exportCsv({ ...args, dimension });
                  const url = URL.createObjectURL(
                    new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = result.filename;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
              }
            >
              <I18nText text="Export grouping CSV" />
            </Button>
          )}
        </Permission>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
export function AnalyticsPage() {
  useLocale();
  const today = Math.floor(Date.now() / day) * day;
  const [from, setFrom] = useState(date(today - 30 * day)),
    [to, setTo] = useState(date(today)),
    [workspace, setWorkspace] = useState(""),
    [reason, setReason] = useState(""),
    [selected, setSelected] = useState<Id<"analyticsReports"> | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const reports = useQuery(api.adminAnalytics.list, {
    paginationOpts: { numItems: 20, cursor },
  });
  const request = useMutation(api.adminAnalytics.request);
  return (
    <main className="space-y-6">
      <h1 className="text-2xl">
        <I18nText text="Analytics and reporting" />
      </h1>
      <p>
        <I18nText text="Reports use 1–90 completed UTC days. Activity means generation jobs or recorded starter/export activity, excluding accounts currently marked staff or anonymous. Returning accounts compare equal-length activity windows; this is not signup cohort retention. New accounts count surviving account records globally; workspace reports omit that denominator." />
      </p>
      <details>
        <summary>
          <I18nText text="Definitions and data coverage" />
        </summary>
        <div className="space-y-2 p-3">
          <p>
            <I18nText text="Job results and durations describe jobs created in the selected window, observed during the report build. Missing completion timestamps are counted separately. Starter/export events depend on recorded telemetry; they do not establish a complete conversion funnel." />
          </p>
          <p>
            <I18nText text="Usage comes from ledger settlements in the selected window. Manual credits are excluded. Company-funded usage is separate. Supplier costs include only recorded evidence; missing evidence is counted. Financial figures are USD and do not represent gross profit." />
          </p>
          <p>
            <I18nText text="Payment metrics group orders created in the window, with cumulative refunds observed during the build. Production and sandbox remain separate. These are not cash-period revenue, recognized revenue, MRR, or ARR." />
          </p>
          <p>
            <I18nText text="Storage is surviving registered bytes observed during the build, regardless of the selected date range. Egress is recorded estimates, with storage writes and local exports separate from transfers. It is not a provider invoice." />
          </p>
          <p>
            <I18nText text="Sources created after the report cutoff are excluded. Mutable states are observed between request and completion; this is not a transactionally consistent historical snapshot. Only completed aggregates are shown. Reports expire after 30 days. CSV exports are audited and limited to 1,000 rows and 1 MB; larger groups must be narrowed by date or workspace." />
          </p>
        </div>
      </details>
      <Permission permission="analytics.run">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            requestId.current ??= crypto.randomUUID();
            try {
              const id = await request({
                from: Date.parse(`${from}T00:00:00Z`),
                to: Date.parse(`${to}T00:00:00Z`),
                workspaceId: workspace.trim()
                  ? (workspace.trim() as Id<"workspaces">)
                  : undefined,
                reason,
                requestId: requestId.current,
              });
              setSelected(id);
              requestId.current = null;
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
          onChange={() => {
            requestId.current = null;
          }}
        >
          <label>
            <I18nText text="From (inclusive)" />
            <Input
              required
              type="date"
              value={from}
              max={date(today - day)}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            <I18nText text="To (exclusive)" />
            <Input
              required
              type="date"
              value={to}
              max={date(today)}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <Input
            aria-label={t("Workspace ID")}
            placeholder={t("Workspace ID (optional)")}
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
          />
          <Input
            required
            aria-label={t("Report reason")}
            placeholder={t("Reason for report (10–500 characters)")}
            minLength={10}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button disabled={busy}>
            <I18nText text="Build report" />
          </Button>
        </form>
      </Permission>
      {error && <p role="alert">{error}</p>}
      <section className="space-y-2">
        <h2>
          <I18nText text="Report history" />
        </h2>
        {reports?.page.map((report) => (
          <div key={report._id}>
            <button
              className="underline"
              onClick={() => setSelected(report._id)}
            >
              {date(report.from)} → {date(report.to)} ·{" "}
              {report.workspaceId ?? t("All workspaces")} · {t(report.status)}
            </button>
          </div>
        ))}
        <Button disabled={!cursor} onClick={() => setCursor(null)}>
          <I18nText text="First page" />
        </Button>{" "}
        <Button
          disabled={!reports || reports.isDone}
          onClick={() => reports && setCursor(reports.continueCursor)}
        >
          <I18nText text="Older reports" />
        </Button>
      </section>
      {selected && <Report key={selected} reportId={selected} />}
    </main>
  );
}
