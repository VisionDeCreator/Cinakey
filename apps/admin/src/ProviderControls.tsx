import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@cinakey/backend";
import { useMutation, useQuery } from "@cinakey/api-client";
import { parseUsdToMicros, usdInputValue } from "@cinakey/shared";
import { Button } from "@cinakey/ui/button";
import { Input } from "@cinakey/ui/input";
import { getLocale, formatUsd, I18nText, t, useLocale } from "@cinakey/ui/i18n";
import {
  Search,
  Wallet,
  CalendarDays,
  ListTodo,
  TriangleAlert,
} from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@cinakey/ui/select";
import { Permission } from "./Permissions";
const money = (n: number) => formatUsd(n);
function Action({
  label,
  run,
}: {
  label: string;
  run: (reason: string, requestId: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const request = useRef<string | null>(null);
  return (
    <form
      className="provider-action space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        request.current ??= crypto.randomUUID();
        try {
          await run(reason, request.current);
          setReason("");
          request.current = null;
          setMessage(t("Saved."));
        } catch (e) {
          setMessage(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <textarea
        className="provider-reason"
        aria-label={t("{action} reason", { action: t(label) })}
        placeholder={t("Reason and evidence (at least 10 characters)")}
        minLength={10}
        maxLength={500}
        required
        disabled={busy}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          request.current = null;
        }}
      />
      <Button disabled={busy} type="submit">
        <I18nText text={label} />
      </Button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
function useOverview() {
  return useQuery(api.adminProviders.overview, {});
}
type Scope = NonNullable<ReturnType<typeof useOverview>>["scopes"][number];
function LimitForm({ scope }: { scope: Scope }) {
  const configure = useMutation(api.adminProviders.configure),
    p = scope.policy;
  const [paused, setPaused] = useState(p?.paused ?? false),
    [values, setValues] = useState({
      maxRequest:
        p?.maxRequest === undefined ? "" : usdInputValue(p.maxRequest),
      dailyCap: p?.dailyCap === undefined ? "" : usdInputValue(p.dailyCap),
      monthlyCap:
        p?.monthlyCap === undefined ? "" : usdInputValue(p.monthlyCap),
      maxOutstanding:
        p?.maxOutstanding === undefined ? "" : String(p.maxOutstanding),
    });
  return (
    <div className="provider-limit-form space-y-3">
      <label className="provider-pause-toggle">
        <input
          type="checkbox"
          role="switch"
          checked={paused}
          onChange={(e) => setPaused(e.target.checked)}
        />
        <I18nText text="Scope paused" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["maxRequest", "Maximum request USD"],
            ["dailyCap", "UTC daily USD limit"],
            ["monthlyCap", "UTC monthly USD limit"],
            ["maxOutstanding", "Maximum outstanding reservations"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block">
            <I18nText text={label} />
            <Input
              aria-label={`${scope.key} ${t(label)}`}
              type="number"
              min="0"
              step={key === "maxOutstanding" ? "1" : "0.000001"}
              placeholder={t("Unlimited")}
              value={values[key]}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <Action
        key={`${paused}:${JSON.stringify(values)}`}
        label="Save provider controls"
        run={(reason, requestId) =>
          configure({
            key: scope.key,
            paused,
            maxRequest:
              values.maxRequest === ""
                ? null
                : parseUsdToMicros(values.maxRequest),
            dailyCap:
              values.dailyCap === "" ? null : parseUsdToMicros(values.dailyCap),
            monthlyCap:
              values.monthlyCap === ""
                ? null
                : parseUsdToMicros(values.monthlyCap),
            maxOutstanding:
              values.maxOutstanding === ""
                ? null
                : Number(values.maxOutstanding),
            expectedRevision: p?.revision ?? 0,
            reason,
            requestId,
          })
        }
      />
    </div>
  );
}
function ScopeCard({
  scope,
  day,
  month,
}: {
  scope: Scope;
  day: string;
  month: string;
}) {
  const pause = useMutation(api.adminProviders.pause),
    p = scope.policy,
    reserved = scope.all?.reserved ?? 0;
  return (
    <section
      className="admin-card provider-policy-editor p-5 space-y-4"
      aria-label={t("Edit limits and pause state")}
    >
      <h2>{scope.key === "global" ? t("Global policy") : scope.key}</h2>
      <p>
        {t("Scope pause:")} {p?.paused ? t("Paused") : t("Off")} ·{" "}
        {t("Revision:")} {p?.revision ?? 0}
      </p>
      <Permission permission="providers.configure">
        <LimitForm key={`${scope.key}:${p?.revision ?? 0}`} scope={scope} />
      </Permission>
      <details className="provider-disclosure">
        <summary>{t("Usage and current limits")}</summary>{" "}
        <div className="grid gap-3 sm:grid-cols-4">
          <p>
            <I18nText text="Outstanding reservations" />
            <br />
            {scope.all?.active ?? 0} · {money(reserved)}
          </p>
          <p>
            {day}
            <br />
            {money(scope.day?.spent ?? 0)} {t("settled")}
            <br />
            {t("Committed:")} {money((scope.day?.spent ?? 0) + reserved)}
          </p>
          <p>
            {month}
            <br />
            {money(scope.month?.spent ?? 0)} {t("settled")}
            <br />
            {t("Committed:")} {money((scope.month?.spent ?? 0) + reserved)}
          </p>
          <p>
            <I18nText text="All-time settled" />
            <br />
            {money(scope.all?.spent ?? 0)}
          </p>
        </div>
        <p>
          {t("Current limits:")} {t("Request")}{" "}
          {p?.maxRequest === undefined ? t("Unlimited") : money(p.maxRequest)} ·{" "}
          {t("Daily")}{" "}
          {p?.dailyCap === undefined ? t("Unlimited") : money(p.dailyCap)} ·{" "}
          {t("Monthly")}{" "}
          {p?.monthlyCap === undefined ? t("Unlimited") : money(p.monthlyCap)} ·{" "}
          {t("Outstanding")} {p?.maxOutstanding ?? t("Unlimited")}
        </p>
        {p && (
          <p>
            {p.reason} · {new Date(p.updatedAt).toLocaleString(getLocale())}
          </p>
        )}
      </details>
      <Permission permission="providers.pause">
        {!p?.paused && (
          <details className="provider-disclosure">
            <summary>{t("Quick pause")}</summary>
            <Action
              label="Pause new paid work"
              run={(reason, requestId) =>
                pause({ key: scope.key, reason, requestId })
              }
            />
          </details>
        )}
      </Permission>
    </section>
  );
}
export function ProviderControlsPage() {
  useLocale();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState("global");
  const data = useOverview(),
    initialize = useMutation(api.adminProviders.initialize);
  if (!data)
    return (
      <p role="status">
        <I18nText text="Loading provider controls…" />
      </p>
    );
  const global = data.scopes.find((scope) => scope.key === "global");
  const selected =
    data.scopes.find((scope) => scope.key === selectedKey) ?? data.scopes[0];
  const rows = data.scopes.filter(
    (scope) =>
      scope.key.toLowerCase().includes(search.trim().toLowerCase()) &&
      (filter === "all" ||
        (filter === "global"
          ? scope.key === "global"
          : scope.key.startsWith(`${filter}:`))),
  );
  return (
    <div className="provider-controls space-y-6">
      <h2 className="sr-only">{t("Provider and spend controls")}</h2>
      <div className="provider-summary">
        {[
          {
            Icon: Wallet,
            label: "Daily committed",
            value: money(
              (global?.day?.spent ?? 0) + (global?.all?.reserved ?? 0),
            ),
          },
          {
            Icon: CalendarDays,
            label: "Monthly committed",
            value: money(
              (global?.month?.spent ?? 0) + (global?.all?.reserved ?? 0),
            ),
          },
          {
            Icon: ListTodo,
            label: "Outstanding reservations",
            value: (global?.all?.active ?? 0).toLocaleString(getLocale()),
          },
        ].map(({ Icon, label, value }) => (
          <section className="admin-card provider-summary-card" key={label}>
            <Icon size={24} />
            <div>
              <span>{t(label)}</span>
              <strong>{value}</strong>
            </div>
          </section>
        ))}
      </div>
      <p className="provider-policy-note">
        {t(
          "Global, provider, and model policies apply together. A parent pause cannot be overridden by a model setting. Operations may pause work; platform administrators manage limits and resumption.",
        )}
      </p>
      <details
        className="admin-card provider-accounting p-5 space-y-3"
        open={data.accounting?.problemJobId ? true : undefined}
      >
        <summary>
          <TriangleAlert size={20} />
          <span>
            {t("Accounting readiness")} ·{" "}
            {data.accounting?.ready ? t("Ready") : t("Initialization required")}
          </span>
          <span className="provider-review-setup">{t("Review setup")}</span>
        </summary>
        <p>
          {data.accounting?.ready ? t("Ready") : t("Initialization required")} ·{" "}
          {t("Jobs examined:")} {data.accounting?.processed ?? 0} ·{" "}
          {data.accounting?.taskState ?? t("No active task")}
        </p>
        <p>
          <I18nText text="Initialize existing job accounting before enabling aggregate limits. Initialization uses bounded pages and can resume after a worker failure. Aggregate limits block new reservations while accounting is incomplete." />
        </p>
        {data.accounting?.problemJobId && (
          <p role="alert">
            <I18nText text="Initialization needs reservation evidence for this job:" />{" "}
            <Link
              className="underline"
              to={`/jobs/${data.accounting.problemJobId}`}
            >
              {data.accounting.problemJobId}
            </Link>
          </p>
        )}
        <Permission permission="providers.configure">
          <Action
            label="Initialize or resume accounting"
            run={(reason, requestId) => initialize({ reason, requestId })}
          />
        </Permission>
      </details>
      <div className="provider-policy-layout">
        <section className="admin-card admin-users-table provider-scope-table">
          <header>
            <h2>{t("Scope policies")}</h2>
            <div className="provider-filters">
              <label className="admin-search">
                <Search size={18} />
                <Input
                  aria-label={t("Search scopes")}
                  placeholder={t("Search scopes")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger aria-label={t("Filter scopes")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ["all", "All scopes"],
                    ["global", "Global"],
                    ["provider", "Providers"],
                    ["model", "Models"],
                  ].map(([value, label]) => (
                    <SelectItem key={value} value={value!}>
                      {t(label!)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </header>
          <div className="overflow-auto">
            <table>
              <caption className="sr-only">{t("Scope policies")}</caption>
              <thead>
                <tr>
                  {[
                    "Scope",
                    "Scope pause:",
                    "Daily committed",
                    "Monthly limit",
                    "Actions",
                  ].map((label) => (
                    <th key={label} scope="col">
                      {t(label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((scope) => (
                  <tr
                    key={scope.key}
                    className={
                      selected?.key === scope.key
                        ? "provider-scope-selected"
                        : undefined
                    }
                  >
                    <td>{scope.key === "global" ? t("Global") : scope.key}</td>
                    <td>
                      <span className="provider-status">
                        {scope.policy?.paused ? t("Paused") : t("Off")}
                      </span>
                    </td>
                    <td>
                      {money(
                        (scope.day?.spent ?? 0) + (scope.all?.reserved ?? 0),
                      )}
                    </td>
                    <td>
                      {scope.policy?.monthlyCap === undefined
                        ? t("Unlimited")
                        : money(scope.policy.monthlyCap)}
                    </td>
                    <td>
                      <button
                        className="provider-edit-button"
                        aria-label={t("Review {scope}", { scope: scope.key })}
                        aria-pressed={selected?.key === scope.key}
                        onClick={() => setSelectedKey(scope.key)}
                      >
                        {t("Edit")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <p role="status" className="p-5">
              {t("No scopes match your search.")}
            </p>
          )}
        </section>
        {selected && (
          <ScopeCard
            key={selected.key}
            scope={selected}
            day={data.day}
            month={data.month}
          />
        )}
      </div>
      <details className="admin-card provider-disclosure p-5 space-y-3">
        <summary>{t("Limit semantics")}</summary>
        <p>
          <I18nText text="USD limits use ledger retail amounts, including standard prices for company-funded work. Daily and monthly usage follows UTC settlement dates and includes all unresolved reservations, even from earlier periods. These are application admission limits; provider invoices may use different dates and amounts." />
        </p>
        <p>
          <I18nText text="An outstanding reservation includes queued jobs, running jobs, and unresolved billing reviews. Lowering a limit preserves admitted work. Pausing also stops proven unsubmitted video jobs and releases their reservation once; accepted jobs and admitted text analyses retain their reconciliation paths." />
        </p>
        <p>
          <I18nText text="Blank means unlimited. Zero blocks new admission. Settings do not rotate credentials, change provider routing, or rewrite purchased price snapshots." />
        </p>
      </details>
      <details className="admin-card provider-disclosure p-5 space-y-3">
        <summary>{t("Active model catalog")}</summary>
        {data.models.map((model) => {
          const keys = [
            "global",
            `provider:${model.provider}`,
            `model:${model.id}`,
          ];
          return (
            <p key={model.id}>
              {model.id} · {model.provider} · {t(model.kind)} ·{" "}
              {data.scopes.some((s) => keys.includes(s.key) && s.policy?.paused)
                ? t("Paused by policy")
                : t("No pause policy")}
            </p>
          );
        })}
      </details>
      <details className="admin-card provider-disclosure p-5 space-y-3">
        <summary>{t("Deployed pricing snapshots")}</summary>
        <p>
          {data.pricing.priceVersion} ·{" "}
          {(data.pricing.markupBps / 10000).toLocaleString(getLocale(), {
            style: "percent",
            maximumFractionDigits: 2,
          })}{" "}
          {t("markup")}
        </p>
        <p>
          <I18nText text="Read-only deployed rate card. Historical jobs retain their original price version and authorized maximum." />
        </p>
        {Object.entries(data.pricing.video).map(([model, rates]) => (
          <p key={model}>
            {model} · 720p: {money(rates["720p"])} · 1080p:{" "}
            {money(rates["1080p"])} {t("per second")}
          </p>
        ))}
        <p>
          {data.pricing.textModel} · {t("Retail USD per million tokens:")}{" "}
          {t("Input")} {money(data.pricing.tokens.input)} · {t("Cached input")}{" "}
          {money(data.pricing.tokens.cachedInput)} · {t("Output")}{" "}
          {money(data.pricing.tokens.output)}
        </p>
      </details>
    </div>
  );
}
