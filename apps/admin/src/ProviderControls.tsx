import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@cinakey/backend";
import { useMutation, useQuery } from "@cinakey/api-client";
import { parseUsdToMicros, usdInputValue } from "@cinakey/shared";
import { Button } from "@cinakey/ui/button";
import { Input } from "@cinakey/ui/input";
import { getLocale, formatUsd, I18nText, t, useLocale } from "@cinakey/ui/i18n";
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
      className="space-y-3"
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
      <Input
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
    <div className="space-y-3">
      <label>
        <input
          type="checkbox"
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
    <section className="admin-card p-5 space-y-4">
      <h2>{scope.key}</h2>
      <p>
        {t("Scope pause:")} {p?.paused ? t("Paused") : t("Off")} ·{" "}
        {t("Revision:")} {p?.revision ?? 0}
      </p>
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
      <Permission permission="providers.pause">
        {!p?.paused && (
          <Action
            label="Pause new paid work"
            run={(reason, requestId) =>
              pause({ key: scope.key, reason, requestId })
            }
          />
        )}
      </Permission>
      <Permission permission="providers.configure">
        <details>
          <summary>
            <I18nText text="Edit limits and pause state" />
          </summary>
          <LimitForm key={p?.revision ?? 0} scope={scope} />
        </details>
      </Permission>
    </section>
  );
}
export function ProviderControlsPage() {
  useLocale();
  const data = useOverview(),
    initialize = useMutation(api.adminProviders.initialize);
  if (!data)
    return (
      <p role="status">
        <I18nText text="Loading provider controls…" />
      </p>
    );
  return (
    <div className="space-y-6">
      <div className="admin-page-heading">
        <h1>
          <I18nText text="Provider and spend controls" />
        </h1>
        <p>
          <I18nText text="Global, provider, and model policies apply together. A parent pause cannot be overridden by a model setting. Operations may pause work; platform administrators manage limits and resumption." />
        </p>
        <Link className="underline" to="/providers">
          <I18nText text="Provider health and failures" />
        </Link>
      </div>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Accounting readiness" />
        </h2>
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
      </section>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Limit semantics" />
        </h2>
        <p>
          <I18nText text="USD limits use ledger retail amounts, including standard prices for company-funded work. Daily and monthly usage follows UTC settlement dates and includes all unresolved reservations, even from earlier periods. These are application admission limits; provider invoices may use different dates and amounts." />
        </p>
        <p>
          <I18nText text="An outstanding reservation includes queued jobs, running jobs, and unresolved billing reviews. Lowering a limit preserves admitted work. Pausing also stops proven unsubmitted video jobs and releases their reservation once; accepted jobs and admitted text analyses retain their reconciliation paths." />
        </p>
        <p>
          <I18nText text="Blank means unlimited. Zero blocks new admission. Settings do not rotate credentials, change provider routing, or rewrite purchased price snapshots." />
        </p>
      </section>
      {data.scopes.map((scope) => (
        <ScopeCard
          key={scope.key}
          scope={scope}
          day={data.day}
          month={data.month}
        />
      ))}
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Active model catalog" />
        </h2>
        {data.models.map((model) => {
          const keys = [
            "global",
            `provider:${model.provider}`,
            `model:${model.id}`,
          ];
          return (
            <p key={model.id}>
              {model.id} · {model.provider} · {model.kind} ·{" "}
              {data.scopes.some((s) => keys.includes(s.key) && s.policy?.paused)
                ? t("Paused by policy")
                : t("No pause policy")}
            </p>
          );
        })}
      </section>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Deployed pricing snapshots" />
        </h2>
        <p>
          {data.pricing.priceVersion} · {data.pricing.markupBps / 100}%{" "}
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
      </section>
    </div>
  );
}
