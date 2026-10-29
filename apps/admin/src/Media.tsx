import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type Id } from "@dirrio/backend";
import { useAction, useMutation, useQuery } from "@dirrio/api-client";
import { Button } from "@dirrio/ui/button";
import { Input } from "@dirrio/ui/input";
import { getLocale, I18nText, t, useLocale } from "@dirrio/ui/i18n";
import { Permission } from "./Permissions";
function ReasonForm({
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
          setMessage(t("Saved."));
          setReason("");
          request.current = null;
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
        required
        minLength={10}
        maxLength={1000}
        disabled={busy}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          request.current = null;
        }}
      />
      <Button type="submit" disabled={busy}>
        <I18nText text={label} />
      </Button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
function Pages({
  result,
  cursor,
  next,
  reset,
}: {
  cursor: string | null;
  result: { isDone: boolean; continueCursor: string } | undefined;
  next: (value: string) => void;
  reset: () => void;
}) {
  return (
    <div className="flex gap-3">
      <Button onClick={reset} disabled={!cursor}>
        <I18nText text="First page" />
      </Button>
      <Button
        disabled={!result || result.isDone}
        onClick={() => result && next(result.continueCursor)}
      >
        <I18nText text="Next page" />
      </Button>
    </div>
  );
}
function Evidence({ flagId }: { flagId: Id<"moderationFlags"> }) {
  const read = useMutation(api.adminMedia.evidence);
  const [evidence, setEvidence] = useState<Awaited<
    ReturnType<typeof read>
  > | null>(null);
  return (
    <Permission permission="moderation.content.read">
      <div className="space-y-3">
        <ReasonForm
          label="Read moderation evidence"
          run={async (reason, requestId) =>
            setEvidence(await read({ flagId, reason, requestId }))
          }
        />
        {evidence && (
          <div className="rounded border p-3 space-y-3">
            <pre className="whitespace-pre-wrap break-words">
              {evidence.prompt ??
                evidence.snippet ??
                t("No text evidence remains.")}
            </pre>
            {evidence.asset && (
              <Link
                className="underline"
                to={`/storage/files/${evidence.asset.storageId}`}
              >
                <I18nText text="Inspect media and retention controls" />
              </Link>
            )}
            <Button variant="outline" onClick={() => setEvidence(null)}>
              <I18nText text="Hide evidence" />
            </Button>
          </div>
        )}
      </div>
    </Permission>
  );
}
function useFlags(
  args: Parameters<typeof useQuery<typeof api.adminMedia.flags>>[1],
) {
  return useQuery(api.adminMedia.flags, args);
}
type Flag = NonNullable<ReturnType<typeof useFlags>>["page"][number];
function FlagCard({ flag }: { flag: Flag }) {
  const viewer = useQuery(api.users.viewer, {}),
    decide = useMutation(api.adminMedia.decide);
  const [status, setStatus] = useState(flag.status),
    [assignedTo, setAssignedTo] = useState(flag.assignedTo ?? "");
  return (
    <article className="admin-card p-5 space-y-3">
      <h2>
        {flag.ruleId} · {t(flag.verdict)} · {t(flag.stage)}
      </h2>
      <p>
        {flag._id} · {new Date(flag.createdAt).toLocaleString(getLocale())}
      </p>
      <p>
        {t("Status:")} {t(flag.status)} · {t("Assigned administrator:")}{" "}
        {flag.assignedTo ?? t("Unassigned")}
      </p>
      <div className="flex gap-4">
        <Link className="underline" to={`/users/${flag.userId}`}>
          <I18nText text="User account" />
        </Link>
        <Permission permission="jobs.read">
          {flag.jobId && (
            <Link className="underline" to={`/jobs/${flag.jobId}`}>
              <I18nText text="Generation job" />
            </Link>
          )}
        </Permission>
      </div>
      {flag.lastDecisionReason && <p>{flag.lastDecisionReason}</p>}
      <Evidence flagId={flag._id} />
      <div className="flex flex-wrap gap-3">
        <select
          aria-label={t("Moderation decision")}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="open">{t("Open / reopen")}</option>
          <option value="resolved">{t("Resolved")}</option>
          <option value="dismissed">{t("Dismissed")}</option>
        </select>
        <Input
          aria-label={t("Assigned moderator ID")}
          placeholder={t("Leave blank to unassign")}
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
        />
        <Button onClick={() => setAssignedTo(viewer?._id ?? "")}>
          <I18nText text="Assign to me" />
        </Button>
      </div>
      <ReasonForm
        key={`${status}:${assignedTo}:${flag.revision}`}
        label="Record moderation decision"
        run={(reason, requestId) =>
          decide({
            flagId: flag._id,
            status,
            assignedTo: (assignedTo as Id<"users">) || null,
            expectedRevision: flag.revision,
            reason,
            requestId,
          })
        }
      />
    </article>
  );
}
export function ModerationPage() {
  useLocale();
  const [status, setStatus] = useState<"open" | "resolved" | "dismissed">(
      "open",
    ),
    [stage, setStage] = useState(""),
    [verdict, setVerdict] = useState(""),
    [cursor, setCursor] = useState<string | null>(null);
  const result = useFlags({
    status,
    stage: (stage as "prompt" | "output") || undefined,
    verdict: (verdict as "flagged" | "blocked") || undefined,
    paginationOpts: { cursor, numItems: 25 },
  });
  return (
    <div className="space-y-6">
      <div className="admin-page-heading">
        <h1>
          <I18nText text="Moderation" />
        </h1>
        <p>
          <I18nText text="Review flags, inspect evidence with an audit reason, and record decisions. Resolving a flag does not resubmit a blocked generation or clear a media hold." />
        </p>
      </div>
      <section className="admin-card p-5 flex flex-wrap gap-3">
        <select
          aria-label={t("Flag status")}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setCursor(null);
          }}
        >
          {["open", "resolved", "dismissed"].map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("Flag stage")}
          value={stage}
          onChange={(e) => {
            setStage(e.target.value);
            setCursor(null);
          }}
        >
          <option value="">{t("All stages")}</option>
          <option value="prompt">{t("Prompt")}</option>
          <option value="output">{t("Output")}</option>
        </select>
        <select
          aria-label={t("Flag verdict")}
          value={verdict}
          onChange={(e) => {
            setVerdict(e.target.value);
            setCursor(null);
          }}
        >
          <option value="">{t("All verdicts")}</option>
          <option value="flagged">{t("Flagged")}</option>
          <option value="blocked">{t("Blocked")}</option>
        </select>
      </section>
      {!result && (
        <p role="status">
          <I18nText text="Loading moderation queue…" />
        </p>
      )}
      {result?.page.map((flag) => (
        <FlagCard key={`${flag._id}:${flag.revision}`} flag={flag} />
      ))}
      {result?.page.length === 0 && (
        <p>
          <I18nText text="No matching moderation flags on this page." />
        </p>
      )}
      <Pages
        cursor={cursor}
        result={result}
        next={setCursor}
        reset={() => setCursor(null)}
      />
    </div>
  );
}
export function StoragePage() {
  useLocale();
  const [params] = useSearchParams();
  const [source, setSource] = useState<"r2" | "convex">("r2"),
    [workspace, setWorkspace] = useState(params.get("workspace") ?? ""),
    [filter, setFilter] = useState(params.get("workspace") ?? ""),
    [cursor, setCursor] = useState<string | null>(null),
    [cleanupFile, setCleanupFile] = useState<string | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const result = useQuery(api.adminMedia.inventory, {
    source,
    workspaceId: (filter as Id<"workspaces">) || undefined,
    paginationOpts: { cursor, numItems: 25 },
  });
  const cleanup = useMutation(api.adminMedia.cleanup),
    retryCleanup = useMutation(api.adminMedia.retryCleanup);
  const [retryFile, setRetryFile] = useState<string | null>(null);
  const pageBytes = result?.page.reduce((sum, row) => sum + row.size, 0) ?? 0;
  return (
    <div className="space-y-6">
      <div className="admin-page-heading">
        <h1>
          <I18nText text="Storage inventory" />
        </h1>
        <p>
          <I18nText text="Inspect registered media, references, quarantine, and retention holds. Cleanup only removes unreferenced R2 files older than 48 hours." />
        </p>
        <Permission permission="operations.read">
          <Link className="underline" to="/egress">
            <I18nText text="Usage and egress reports" />
          </Link>
        </Permission>
      </div>
      <form
        className="admin-card p-5 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter(workspace.trim());
          setCursor(null);
        }}
      >
        <select
          aria-label={t("Storage provider")}
          value={source}
          onChange={(e) => {
            setSource(e.target.value as typeof source);
            setCursor(null);
          }}
        >
          <option value="r2">R2</option>
          <option value="convex">{t("Convex registered media")}</option>
        </select>
        <Input
          aria-label={t("Workspace ID")}
          placeholder={t("Workspace ID (optional)")}
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
        />
        <Button>
          <I18nText text="Apply filters" />
        </Button>
      </form>
      <section className="admin-card p-5 space-y-3">
        <p>
          {t("Bytes on this page:")} {pageBytes.toLocaleString(getLocale())} ·{" "}
          {t("Files on this page:")} {result?.page.length ?? 0}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>
                  <I18nText text="File and owner" />
                </th>
                <th>
                  <I18nText text="Size / type" />
                </th>
                <th>
                  <I18nText text="Status / references" />
                </th>
                <th>
                  <I18nText text="Action" />
                </th>
              </tr>
            </thead>
            <tbody>
              {result?.page.map((row) => (
                <tr className="border-t" key={row.id}>
                  <td>
                    {row.deletedAt === undefined ? (
                      <Link
                        className="underline"
                        to={`/storage/files/${row.id}`}
                      >
                        {row.id}
                      </Link>
                    ) : (
                      row.id
                    )}
                    <br />
                    {row.workspaceId ?? t("Unassigned workspace")}
                    <br />
                    {new Date(row.createdAt).toLocaleString(getLocale())}
                  </td>
                  <td>
                    {row.size.toLocaleString(getLocale())} {t("bytes")}
                    <br />
                    {row.contentType}
                  </td>
                  <td>
                    {row.cleanup?.taskState === "failed" && (
                      <p>
                        <I18nText text="Cleanup worker failed" />
                      </p>
                    )}
                    {row.deletedAt !== undefined
                      ? t("Deletion pending")
                      : row.control?.quarantined
                        ? t("Quarantined")
                        : t("Available")}{" "}
                    ·{" "}
                    {row.control?.retentionHold
                      ? t("Retention hold")
                      : t("No retention hold")}
                    <br />
                    {Object.entries(row.refs)
                      .filter(([, used]) => used)
                      .map(([key]) => key)
                      .join(", ") || t("No references")}
                  </td>
                  <td>
                    <Permission permission="storage.manage">
                      {row.cleanup?.state === "pending" &&
                        (!row.cleanup.taskState ||
                          row.cleanup.taskState === "failed") && (
                          <Button onClick={() => setRetryFile(row.id)}>
                            <I18nText text="Retry failed cleanup" />
                          </Button>
                        )}
                      {row.cleanupEligible && (
                        <Button
                          onClick={() => {
                            setCleanupFile(row.id);
                            setConfirmed(false);
                          }}
                        >
                          <I18nText text="Review orphan cleanup" />
                        </Button>
                      )}
                    </Permission>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pages
          cursor={cursor}
          result={result}
          next={setCursor}
          reset={() => setCursor(null)}
        />
      </section>
      <Permission permission="storage.manage">
        {retryFile && (
          <section className="admin-card p-5 space-y-3">
            <p>{retryFile}</p>
            <ReasonForm
              key={retryFile}
              label="Retry failed cleanup"
              run={(reason, requestId) =>
                retryCleanup({
                  fileId: retryFile as Id<"r2Files">,
                  reason,
                  requestId,
                })
              }
            />
          </section>
        )}
        {cleanupFile && (
          <section className="admin-card p-5 space-y-3">
            <h2>
              <I18nText text="Permanent orphan cleanup" />
            </h2>
            <p>{cleanupFile}</p>
            <p>
              <I18nText text="References and retention controls are checked again when this request commits and before the worker deletes the object." />
            </p>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <I18nText text="I reviewed this file and authorize permanent deletion." />
            </label>
            {confirmed && (
              <ReasonForm
                key={cleanupFile}
                label="Queue permanent cleanup"
                run={(reason, requestId) =>
                  cleanup({
                    fileId: cleanupFile as Id<"r2Files">,
                    reason,
                    requestId,
                  })
                }
              />
            )}
          </section>
        )}
      </Permission>
    </div>
  );
}
export function MediaDetailPage() {
  useLocale();
  const { storageId = "" } = useParams();
  return <MediaDetail key={storageId} storageId={storageId} />;
}
function MediaDetail({ storageId }: { storageId: string }) {
  const detail = useQuery(api.adminMedia.detail, { storageId }),
    control = useMutation(api.adminMedia.control),
    previewAction = useAction(api.adminMedia.preview);
  const [quarantined, setQuarantined] = useState(false),
    [hold, setHold] = useState(false),
    [preview, setPreview] = useState<{
      url: string | null;
      contentType: string;
    } | null>(null);
  useEffect(() => {
    if (detail) {
      setQuarantined(detail.control?.quarantined ?? false);
      setHold(detail.control?.retentionHold ?? false);
    }
  }, [detail?.control?.revision]);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(() => setPreview(null), 300000);
    return () => clearTimeout(timer);
  }, [preview]);
  if (detail === null)
    return (
      <p>
        <I18nText text="Media is missing or pending deletion" />
      </p>
    );
  if (detail === undefined)
    return (
      <p role="status">
        <I18nText text="Loading media metadata…" />
      </p>
    );
  return (
    <div className="space-y-6">
      <div className="admin-page-heading">
        <h1>
          <I18nText text="Media inspection" />
        </h1>
        <p>
          {storageId} · {detail.provider} · {detail.contentType} ·{" "}
          {detail.size.toLocaleString(getLocale())} {t("bytes")}
        </p>
      </div>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Ownership and references" />
        </h2>
        <p>{detail.workspaceId ?? t("Unassigned workspace")}</p>
        {detail.aliases.map((a) => (
          <p key={a.id}>
            {a.id} · {t(a.type)} · {a.projectId ?? a.workspaceId}
            <Permission permission="jobs.read">
              {a.jobId && (
                <Link className="underline ml-3" to={`/jobs/${a.jobId}`}>
                  <I18nText text="Generation job" />
                </Link>
              )}
            </Permission>
          </p>
        ))}
        {detail.publications.map((p) => (
          <p key={p.id}>
            {p.id} · {t(p.state)} · {p.projectId}
          </p>
        ))}
        {detail.truncated && (
          <p>
            <I18nText text="Showing the first 25 references in each category." />
          </p>
        )}
      </section>
      <Permission permission="moderation.manage">
        <section className="admin-card p-5 space-y-3">
          <h2>
            <I18nText text="Quarantine and retention" />
          </h2>
          <p>
            <I18nText text="Quarantine blocks new URL issuance and reference use across every alias. Existing direct URLs may remain usable. Quarantine and retention holds both prevent deletion; releasing a hold requires a separate audited decision." />
          </p>
          <label className="block">
            <input
              type="checkbox"
              checked={quarantined}
              onChange={(e) => setQuarantined(e.target.checked)}
            />
            <I18nText text="Media quarantined" />
          </label>
          <label className="block">
            <input
              type="checkbox"
              checked={hold}
              onChange={(e) => setHold(e.target.checked)}
            />
            <I18nText text="Retention hold" />
          </label>
          <ReasonForm
            key={`${quarantined}:${hold}:${detail.control?.revision ?? 0}`}
            label="Update media controls"
            run={(reason, requestId) =>
              control({
                storageId,
                quarantined,
                retentionHold: hold,
                expectedRevision: detail.control?.revision ?? 0,
                reason,
                requestId,
              })
            }
          />
        </section>
      </Permission>
      <Permission permission="moderation.content.read">
        <section className="admin-card p-5 space-y-3">
          <h2>
            <I18nText text="Audited media preview" />
          </h2>
          <p>
            <I18nText text="Opening this preview records your reason. The R2 preview link expires in five minutes." />
          </p>
          <ReasonForm
            label="Open media preview"
            run={async (reason, requestId) =>
              setPreview(await previewAction({ storageId, reason, requestId }))
            }
          />
          {preview?.url && (
            <div>
              {preview.contentType.startsWith("image/") ? (
                <img
                  className="max-h-96"
                  src={preview.url}
                  referrerPolicy="no-referrer"
                  alt={t("Moderation evidence")}
                />
              ) : preview.contentType.startsWith("video/") ? (
                <video
                  className="max-h-96"
                  controls
                  preload="none"
                  src={preview.url}
                />
              ) : (
                <audio controls preload="none" src={preview.url} />
              )}
              <Button onClick={() => setPreview(null)}>
                <I18nText text="Close preview" />
              </Button>
            </div>
          )}
        </section>
      </Permission>
    </div>
  );
}
