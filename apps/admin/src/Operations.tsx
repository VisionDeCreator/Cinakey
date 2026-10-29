import { Link } from "react-router-dom";
import { useRef, useState } from "react";
import { api, type Id } from "@cinakey/backend";
import { useMutation, useQuery, useQueryStatus } from "@cinakey/api-client";
import { Button } from "@cinakey/ui/button";
import { Input } from "@cinakey/ui/input";
import { getLocale, I18nText, t, useLocale } from "@cinakey/ui/i18n";
import { Permission } from "./Permissions";
const amount = (count: { value: number; capped: boolean }) =>
  `${count.value}${count.capped ? "+" : ""}`;
function Acknowledge({
  incidentId,
}: {
  incidentId: Id<"operationsIncidents">;
}) {
  const acknowledge = useMutation(api.adminOperations.acknowledge);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await acknowledge({ incidentId, reason });
        } catch (error) {
          setError(
            error instanceof Error ? error.message : t("Request failed"),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input
        aria-label={t("Acknowledgement reason")}
        required
        minLength={3}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={busy}
      />
      <Button disabled={busy || reason.trim().length < 3}>
        {t("Acknowledge")}
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
type Configuration = {
  enabled: boolean;
  expectedWorkers: number;
  staleAfterSec: number;
  backlogThreshold: number;
  overdueSec: number;
  generationFailureThreshold: number;
};
function ConfigurationForm({ initial }: { initial: Configuration }) {
  const [config, setConfig] = useState<Configuration>({
    generationFailureThreshold: initial.generationFailureThreshold,
    enabled: initial.enabled,
    expectedWorkers: initial.expectedWorkers,
    staleAfterSec: initial.staleAfterSec,
    backlogThreshold: initial.backlogThreshold,
    overdueSec: initial.overdueSec,
  });
  const configure = useMutation(api.adminOperations.configure);
  const requestId = useRef<string | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="admin-card p-5 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          await configure({
            ...config,
            reason,
            requestId: (requestId.current ??= crypto.randomUUID()),
          });
          requestId.current = null;
          setMessage(t("Monitoring settings saved."));
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : t("Request failed"),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>
        <I18nText text="Monitoring settings" />
      </h2>
      <fieldset disabled={busy} className="space-y-3">
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => {
              requestId.current = null;
              setConfig({ ...config, enabled: e.target.checked });
            }}
          />
          {t("Incident monitoring enabled")}
        </label>
        {(
          [
            [
              "generationFailureThreshold",
              "Hourly generation failure threshold",
              1,
              999,
            ],
            ["expectedWorkers", "Expected healthy workers", 0, 100],
            ["staleAfterSec", "Worker stale after (seconds)", 60, 3600],
            ["backlogThreshold", "Backlog warning threshold", 1, 999],
            ["overdueSec", "Overdue task threshold (seconds)", 60, 86400],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key} className="block">
            {t(label)}
            <Input
              type="number"
              required
              min={min}
              max={max}
              step={1}
              value={config[key]}
              onChange={(e) => {
                requestId.current = null;
                setConfig({ ...config, [key]: e.target.valueAsNumber });
              }}
            />
          </label>
        ))}
        <label className="block">
          {t("Reason")}
          <Input
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(e) => {
              requestId.current = null;
              setReason(e.target.value);
            }}
          />
        </label>
      </fieldset>
      <p>
        <I18nText text="Disabling monitoring pauses incident detection and recovery updates; existing incidents remain visible." />
      </p>
      <Button disabled={busy || reason.trim().length < 3}>
        {t("Save monitoring settings")}
      </Button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
export function OperationsPage() {
  useLocale();
  const overview = useQuery(api.adminOperations.overview, {});
  const status = useQueryStatus(api.adminOperations.overview, {});
  const incidents = useQuery(api.adminOperations.listIncidents, {});
  return (
    <>
      <div className="admin-page-heading">
        <h1>
          <I18nText text="Operations overview" />
        </h1>
        <p>
          <I18nText text="Service availability, background work, and incidents requiring attention." />
        </p>
      </div>
      {status.isReconnecting && (
        <p role="alert">
          <I18nText text="Operations data is unavailable or stale. Reconnecting…" />{" "}
          <Button onClick={() => void status.retry()}>
            {t("Retry connection")}
          </Button>
        </p>
      )}
      {!overview ? (
        <p role="status">
          <I18nText text="Loading operations…" />
        </p>
      ) : (
        <>
          <section className="admin-card p-5 space-y-3">
            <h2>
              <I18nText text="Service status" />
            </h2>
            <p>
              {t("API and database")}:{" "}
              {status.isReconnecting ? t("Unknown") : t("Reachable")} ·{" "}
              {t("Observed at")}:{" "}
              {new Date(overview.observedAt).toLocaleString(getLocale())}
            </p>
            <p>
              {t("Healthy workers")}: {overview.healthyWorkers} /{" "}
              {overview.config.expectedWorkers} {t("expected")}
            </p>
            {!overview.monitorLastEvaluatedAt && (
              <p>
                <I18nText text="Monitoring is awaiting its first scheduled evaluation." />
              </p>
            )}
            {overview.monitorLastEvaluatedAt && (
              <p>
                {t("Last monitoring evaluation")}:{" "}
                {new Date(overview.monitorLastEvaluatedAt).toLocaleString(
                  getLocale(),
                )}
              </p>
            )}
            {overview.monitorLastEvaluatedAt &&
              overview.observedAt - overview.monitorLastEvaluatedAt >
                180_000 && (
                <p role="alert">
                  <I18nText text="Scheduled monitoring is stale. Incident status may be out of date." />
                </p>
              )}
            {!overview.config.enabled && (
              <p role="status">
                <I18nText text="Incident monitoring is paused." />
              </p>
            )}
            <p>
              <I18nText text="The API liveness endpoint is /health; dependency readiness is /ready. Provider connectivity is not probed by this view." />
            </p>
          </section>
          <section className="admin-card p-5">
            <h2>
              <I18nText text="Work queue" />
            </h2>
            <p className="flex flex-wrap gap-3">
              <Link className="underline" to="/jobs?attention=uncertain">
                {t("Review provider submissions")}
              </Link>
              <Link className="underline" to="/jobs?attention=billing_review">
                {t("Review generation billing")}
              </Link>
              <Link className="underline" to="/jobs?attention=stalled">
                {t("Inspect stalled jobs")}
              </Link>
            </p>
            <dl className="grid gap-4 sm:grid-cols-3">
              {[
                ["Scheduled tasks", amount(overview.queue.scheduled)],
                ["Payment reviews", amount(overview.paymentReviews)],
                ["Ready to run", amount(overview.queue.due)],
                ["Running tasks", amount(overview.queue.running)],
                ["Failed tasks", amount(overview.queue.failed)],
                ["Expired leases", amount(overview.queue.expired)],
                ["Uncertain submissions", amount(overview.uncertain)],
                ["Billing reviews", amount(overview.billingReviews)],
                [
                  "Failed tasks in the last hour",
                  amount(overview.recentFailedTasks),
                ],
                [
                  "Failed generations in the last hour",
                  amount(overview.recentFailedGenerations),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{t(label!)}</dt>
                  <dd className="text-2xl">{value}</dd>
                </div>
              ))}
            </dl>
            <p>
              {t("Oldest ready task due at")}:{" "}
              {overview.queue.oldestDueAt === null
                ? "—"
                : new Date(overview.queue.oldestDueAt).toLocaleString(
                    getLocale(),
                  )}
            </p>
            <p>
              <I18nText text="Counts above 1,000 are marked with +. Older failures without recorded completion timestamps are excluded from hourly counts." />
            </p>
          </section>
          <section className="admin-card p-5 overflow-auto">
            <h2>
              <I18nText text="Worker instances" />
            </h2>
            {!overview.workers.length && (
              <p>
                <I18nText text="No worker heartbeat observed in the last 24 hours. Worker availability is unknown." />
              </p>
            )}
            <table className="w-full text-left">
              <caption className="sr-only">{t("Worker instances")}</caption>
              <thead>
                <tr>
                  {[
                    "Instance",
                    "Version",
                    "State",
                    "Active tasks",
                    "Last heartbeat",
                    "Last successful poll",
                  ].map((label) => (
                    <th key={label}>{t(label)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overview.workers.slice(0, 50).map((worker) => (
                  <tr key={worker.instanceId}>
                    <td>{worker.instanceId}</td>
                    <td>{worker.version}</td>
                    <td>{t(worker.state)}</td>
                    <td>{worker.activeTasks}</td>
                    <td>
                      {new Date(worker.lastSeenAt).toLocaleString(getLocale())}
                    </td>
                    <td>
                      {worker.lastPollAt
                        ? new Date(worker.lastPollAt).toLocaleString(
                            getLocale(),
                          )
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overview.workers.length > 50 && (
              <p>
                <I18nText text="Showing the 50 most recently observed workers." />
              </p>
            )}
          </section>
          <Permission permission="operations.configure">
            <ConfigurationForm initial={overview.config} />
          </Permission>
        </>
      )}
      <section className="admin-card p-5 space-y-4">
        <h2>
          <I18nText text="Active incidents" />
        </h2>
        {!incidents ? (
          <p role="status">
            <I18nText text="Loading incidents…" />
          </p>
        ) : (
          <>
            {!incidents.active.length && (
              <p>
                <I18nText text="No active incidents recorded." />
              </p>
            )}
            {incidents.active.map((incident) => (
              <article
                className="border-b border-zinc-700 pb-4 space-y-2"
                key={incident._id}
              >
                <h3>{t(incident.summary)}</h3>
                <p>
                  {t(incident.severity)} · {t(incident.status)} ·{" "}
                  {new Date(incident.openedAt).toLocaleString(getLocale())}
                </p>
                {incident.note && <p>{incident.note}</p>}
                {incident.status === "open" && (
                  <Permission permission="operations.manage">
                    <Acknowledge incidentId={incident._id} />
                  </Permission>
                )}
              </article>
            ))}
            <h2>
              <I18nText text="Recent recoveries" />
            </h2>
            {incidents.recentResolved.map((incident) => (
              <p key={incident._id}>
                {t(incident.summary)} ·{" "}
                {incident.resolvedAt
                  ? new Date(incident.resolvedAt).toLocaleString(getLocale())
                  : "—"}
              </p>
            ))}
            {incidents.capped && (
              <p>
                <I18nText text="Incident history is limited to 50 entries per status." />
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}
