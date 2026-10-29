import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type Id } from "@dirrio/backend";
import { useAction, useMutation, useQuery } from "@dirrio/api-client";
import { getLocale, formatUsd, I18nText, t, useLocale } from "@dirrio/ui/i18n";
import { Button } from "@dirrio/ui/button";
import { Input } from "@dirrio/ui/input";
import { Permission } from "./Permissions";
const statuses = [
  "queued",
  "submitted",
  "running",
  "succeeded",
  "failed",
  "refunded",
] as const;
export function JobsPage() {
  useLocale();
  const [params] = useSearchParams();
  const empty = {
    attention: "",
    jobId: "",
    user: "",
    workspace: "",
    project: "",
    model: "",
    provider: "",
    status: "",
    from: "",
    to: "",
  };
  const initial = {
    ...empty,
    attention: ["uncertain", "billing_review", "stalled"].includes(
      params.get("attention") || "",
    )
      ? params.get("attention")!
      : "",
  };
  const [draft, setDraft] = useState(initial),
    [filters, setFilters] = useState(initial),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState("");
  const result = useQuery(api.adminJobs.list, {
    paginationOpts: { cursor, numItems: 25 },
    attention:
      (filters.attention as "uncertain" | "billing_review" | "stalled") ||
      undefined,
    jobId: filters.jobId || undefined,
    user: filters.user || undefined,
    workspace: filters.workspace || undefined,
    project: filters.project || undefined,
    model: filters.model || undefined,
    provider: (filters.provider as "sume" | "deepseek" | "legacy") || undefined,
    status: (filters.status as (typeof statuses)[number]) || undefined,
    from: filters.from ? new Date(filters.from).getTime() : undefined,
    to: filters.to ? new Date(filters.to).getTime() : undefined,
  });
  return (
    <>
      <div className="admin-page-heading">
        <h1>
          <I18nText text="Generation jobs" />
        </h1>
        <p>
          <I18nText text="Inspect production work and recover existing requests without submitting new paid work." />
        </p>
      </div>
      <form
        className="admin-card p-5 grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            draft.from &&
            draft.to &&
            new Date(draft.from) > new Date(draft.to)
          ) {
            setError(t("The start date must be before the end date."));
            return;
          }
          setError("");
          setCursor(null);
          setFilters(draft);
        }}
      >
        {(
          [
            ["jobId", "Job ID"],
            ["user", "Creator email or user ID"],
            ["workspace", "Workspace ID"],
            ["project", "Project ID"],
            ["model", "Model (exact)"],
            ["from", "Created from (local time)"],
            ["to", "Created to (local time)"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {t(label)}
            <Input
              type={key === "from" || key === "to" ? "datetime-local" : "text"}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
        <label>
          {t("Status")}
          <select
            className="w-full rounded border p-2 bg-zinc-900"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            <option value="">{t("All")}</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {t(status)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Model provider")}
          <select
            className="w-full rounded border p-2 bg-zinc-900"
            value={draft.provider}
            onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
          >
            <option value="">{t("All")}</option>
            {["sume", "deepseek", "legacy"].map((provider) => (
              <option key={provider}>{provider}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Needs attention")}
          <select
            className="w-full rounded border p-2 bg-zinc-900"
            value={draft.attention}
            onChange={(e) => setDraft({ ...draft, attention: e.target.value })}
          >
            <option value="">{t("All")}</option>
            <option value="uncertain">
              {t("Uncertain or in-flight submissions")}
            </option>
            <option value="billing_review">
              {t("Billing review required")}
            </option>
            <option value="stalled">
              {t("Active with no update for 15 minutes")}
            </option>
          </select>
        </label>
        <Button type="submit">{t("Apply filters")}</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDraft(empty);
            setFilters(empty);
            setCursor(null);
            setError("");
          }}
        >
          {t("Reset")}
        </Button>
      </form>
      {error && <p role="alert">{error}</p>}
      <section className="admin-card p-5 overflow-auto">
        {!result ? (
          <p role="status">
            <I18nText text="Loading jobs…" />
          </p>
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("Generation jobs")}</caption>
              <thead>
                <tr>
                  {[
                    "Job",
                    "Model",
                    "Status",
                    "Submission",
                    "Attempts",
                    "Created",
                  ].map((label) => (
                    <th key={label}>{t(label)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.page.map((job) => (
                  <tr key={job._id}>
                    <td>
                      <Link className="underline" to={`/jobs/${job._id}`}>
                        {job._id}
                      </Link>
                    </td>
                    <td>{job.model}</td>
                    <td>
                      {t(job.status)}
                      {job.attention.map((flag) => (
                        <span className="block text-amber-300" key={flag}>
                          {t(
                            (
                              {
                                uncertain: "Submission review",
                                billing_review: "Billing review",
                                stalled: "No update for 15 minutes",
                              } as Record<string, string>
                            )[flag]!,
                          )}
                        </span>
                      ))}
                    </td>
                    <td>
                      {job.submissionState ? t(job.submissionState) : "—"}
                    </td>
                    <td>{job.attempts}</td>
                    <td>
                      {new Date(job.createdAt).toLocaleString(getLocale())}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!result.page.length && (
              <p>
                <I18nText text="No matches in this batch. Continue to the next page if available." />
              </p>
            )}
            <p>
              <I18nText text="Search covers server records in bounded batches. Historical jobs may be missing from workspace-filtered results until indexing is complete. Provider labels describe the model family, not a verified historical supplier receipt." />
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                disabled={!cursor}
                onClick={() => setCursor(null)}
              >
                {t("First page")}
              </Button>
              <Button
                variant="outline"
                disabled={result.isDone}
                onClick={() => setCursor(result.continueCursor)}
              >
                {t("Next page")}
              </Button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
function RecoveryControls({
  jobId,
  availability,
}: {
  jobId: Id<"generationJobs">;
  availability: {
    cancel: string | null;
    resume: string | null;
    check: string | null;
  };
}) {
  const recover = useMutation(api.adminJobs.recover),
    check = useAction(api.adminJobs.checkProvider);
  const [action, setAction] = useState<"cancel" | "resume" | "review">(
      "review",
    ),
    [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const requestId = useRef<string | null>(null);
  return (
    <section className="admin-card p-5 space-y-4">
      <h2>
        <I18nText text="Controlled recovery" />
      </h2>
      <p>
        <I18nText text="Check provider status records evidence only. Resume tracking requires recent positive evidence and cannot resubmit this job. Cancellation is limited to unsubmitted work with no worker lease. Uncertain outcomes retain their reservation." />
      </p>
      <Button
        variant="outline"
        disabled={busy || !!availability.check}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            const result = await check({ jobId });
            setMessage(t("Provider observation") + ": " + t(result.status));
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : t("Request failed"),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Check provider status")}
      </Button>
      {availability.check && <p>{t(availability.check)}</p>}
      {availability.cancel && (
        <p>
          {t("Cancellation")}: {t(availability.cancel)}
        </p>
      )}
      {availability.resume && (
        <p>
          {t("Resume tracking")}: {t(availability.resume)}
        </p>
      )}
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!reviewed || busy) return;
          setBusy(true);
          setMessage("");
          try {
            await recover({
              jobId,
              action,
              reason,
              requestId: (requestId.current ??= crypto.randomUUID()),
            });
            requestId.current = null;
            setReviewed(false);
            setMessage(t("Administrative action recorded."));
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : t("Request failed"),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="space-y-3">
          <label className="block">
            {t("Recovery action")}
            <select
              className="block w-full rounded border p-2 bg-zinc-900"
              value={action}
              onChange={(e) => {
                requestId.current = null;
                setReviewed(false);
                setAction(e.target.value as typeof action);
              }}
            >
              <option value="review">{t("Record review note")}</option>
              <option value="resume" disabled={!!availability.resume}>
                {t("Resume tracking only")}
              </option>
              <option value="cancel" disabled={!!availability.cancel}>
                {t("Cancel before submission")}
              </option>
            </select>
          </label>
          <label className="block">
            {t("Reason / evidence reference")}
            <Input
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(e) => {
                requestId.current = null;
                setReviewed(false);
                setReason(e.target.value);
              }}
            />
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            {t("I have reviewed the job state and this action.")}
          </label>
        </fieldset>
        <Button disabled={busy || !reviewed || reason.trim().length < 3}>
          {t("Apply recovery action")}
        </Button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
function PrivateContent({ jobId }: { jobId: Id<"generationJobs"> }) {
  const read = useMutation(api.adminJobs.readContent);
  const [reason, setReason] = useState(""),
    [content, setContent] = useState<{
      prompt: string;
      errorMessage?: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="admin-card p-5 space-y-3">
      <h2>
        <I18nText text="Private prompt and error details" />
      </h2>
      <form
        className="flex gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            setContent(await read({ jobId, reason }));
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
          aria-label={t("Private content access reason")}
          required
          minLength={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button disabled={busy || reason.trim().length < 3}>
          {t("View and audit access")}
        </Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {content && (
        <>
          <pre className="whitespace-pre-wrap break-all">{content.prompt}</pre>
          {content.errorMessage && (
            <pre className="whitespace-pre-wrap break-all">
              {content.errorMessage}
            </pre>
          )}
          <Button variant="outline" onClick={() => setContent(null)}>
            {t("Hide private content")}
          </Button>
        </>
      )}
    </section>
  );
}
export function JobDetailPage() {
  const { jobId } = useParams();
  return <JobRecord key={jobId} jobId={jobId || ""} />;
}
function JobRecord({ jobId }: { jobId: string }) {
  useLocale();
  const data = useQuery(api.adminJobs.detail, { jobId });
  if (data === undefined)
    return (
      <p role="status">
        <I18nText text="Loading job…" />
      </p>
    );
  if (!data)
    return (
      <p>
        <I18nText text="Job not found." />
      </p>
    );
  const job = data.job;
  return (
    <>
      <Link className="underline" to="/jobs">
        {t("All jobs")}
      </Link>
      <div className="admin-page-heading">
        <h1>
          {job.model} · {t(job.status)}
        </h1>
        <p>{job._id}</p>
      </div>
      <section className="admin-card p-5 space-y-2">
        <h2>
          <I18nText text="Job details" />
        </h2>
        <p>
          {t("Creator")}:{" "}
          <Link className="underline" to={`/users/${job.createdBy}`}>
            {job.createdBy}
          </Link>
        </p>
        <p>
          {t("Project")}: {job.projectId}
        </p>
        <p>
          {t("Workspace")}:{" "}
          {job.workspaceId || t("Historical workspace index pending")}
        </p>
        <p>
          {t("Model version")}: {job.modelVersion || "—"}
        </p>
        <p>
          {t("Provider request ID")}: {job.providerJobId || "—"}
        </p>
        <p>
          {t("Submission state")}: {job.submissionState || "—"}
        </p>
        <p>
          {t("Attempts")}: {job.attempts}
        </p>
        <p>
          {t("Created")}: {new Date(job.createdAt).toLocaleString(getLocale())}
        </p>
        <p>
          {t("Updated")}: {new Date(job.updatedAt).toLocaleString(getLocale())}
        </p>
        {job.failureCategory && <p role="status">{t(job.failureCategory)}</p>}
        {job.preventAutomaticResubmission && (
          <p>
            <I18nText text="Automatic resubmission is disabled for this recovered job." />
          </p>
        )}
        {job.financial && (
          <dl>
            {[
              ["Reserved estimate", job.financial.estimated],
              ["Settled usage", job.financial.actual],
              ["Supplier charge", job.financial.supplierActual],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt>{t(String(label))}</dt>
                <dd>{typeof value === "number" ? formatUsd(value) : "—"}</dd>
              </div>
            ))}
            <dt>{t("Price version")}</dt>
            <dd>{job.financial.priceVersion || "—"}</dd>
          </dl>
        )}
      </section>
      <section className="admin-card p-5">
        <p>
          {t("Operation")}: {job.kind}
        </p>
        <p>
          {t("Input snapshot")}:{" "}
          {job.hasInputSnapshot ? t("Recorded") : t("Not recorded")}
        </p>
        <p>
          {t("Outputs")}: {job.outputCount}
        </p>
      </section>
      <Permission permission="jobs.manage">
        <RecoveryControls jobId={job._id} availability={data.availability} />
      </Permission>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Provider observations" />
        </h2>
        {data.observations.map((row) => (
          <p key={row._id}>
            {new Date(row.observedAt).toLocaleString(getLocale())} ·{" "}
            {t(row.status)} · {row.providerJobId}
          </p>
        ))}
        <h2>
          <I18nText text="Worker tasks" />
        </h2>
        {data.tasks.map((task) => (
          <p key={task._id}>
            {task.operation} · {t(task.state)} · {t("Attempts")}:{" "}
            {task.attempts} · {t("Lease until")}:{" "}
            {task.leaseUntil
              ? new Date(task.leaseUntil).toLocaleString(getLocale())
              : "—"}
          </p>
        ))}
      </section>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Lifecycle and administrative history" />
        </h2>
        <p>
          <I18nText text="Older jobs have partial lifecycle history. Each list shows the most recent recorded entries." />
        </p>
        <p>
          {new Date(job.createdAt).toLocaleString(getLocale())} ·{" "}
          {t("Job created")}
        </p>
        {data.events.map((event) => (
          <p key={event._id}>
            {new Date(event.createdAt).toLocaleString(getLocale())} ·{" "}
            {event.event}
          </p>
        ))}
        {data.actions.map((action) => (
          <p key={action._id}>
            {new Date(action.createdAt).toLocaleString(getLocale())} ·{" "}
            {action.action}
          </p>
        ))}
        {data.reviews.map((review) => (
          <p key={review._id}>
            {new Date(review.createdAt).toLocaleString(getLocale())} ·{" "}
            {review.note}
          </p>
        ))}
      </section>
      {!!data.ledger.length && (
        <section className="admin-card p-5">
          <h2>
            <I18nText text="Job ledger" />
          </h2>
          {data.ledger.map((entry) => (
            <p key={entry._id}>
              {new Date(entry.createdAt).toLocaleString(getLocale())} ·{" "}
              {entry.reason} · {formatUsd(entry.delta)}
            </p>
          ))}
        </section>
      )}
      <section className="admin-card p-5">
        <h2>
          <I18nText text="Output metadata" />
        </h2>
        <p>
          <I18nText text="This view does not retrieve private media or expose storage URLs." />
        </p>
        {data.outputs.map((asset) => (
          <p key={asset.assetId}>
            {asset.assetId} · {asset.type} · {asset.format || "—"} ·{" "}
            {asset.width || "—"} × {asset.height || "—"} ·{" "}
            {asset.durationSec ?? "—"}s
          </p>
        ))}
      </section>
      <Permission permission="jobs.content.read">
        <PrivateContent jobId={job._id} />
      </Permission>
    </>
  );
}
