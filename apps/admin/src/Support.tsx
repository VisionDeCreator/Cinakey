import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@cinakey/api-client";
import { Button } from "@cinakey/ui/button";
import { Input } from "@cinakey/ui/input";
import { getLocale, I18nText, t, useLocale } from "@cinakey/ui/i18n";
import { Permission } from "./Permissions";
const statuses = ["open", "investigating", "waiting", "resolved"] as const;
function SupportAction({
  label,
  run,
}: {
  label: string;
  run: (reason: string, requestId: string) => Promise<unknown>;
}) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const request = useRef<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        request.current ??= crypto.randomUUID();
        setBusy(true);
        try {
          await run(text, request.current);
          setMessage(t("Saved."));
          setText("");
          request.current = null;
        } catch (e) {
          setMessage(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <textarea
        className="w-full rounded border bg-transparent p-3"
        aria-label={t("Internal reason or note")}
        placeholder={t(
          "Record the reason, evidence, and next steps. Do not include passwords, tokens, or payment details.",
        )}
        minLength={10}
        maxLength={2000}
        required
        disabled={busy}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
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
type Case = NonNullable<ReturnType<typeof useCases>>["page"][number];
function useCases(
  args: Parameters<typeof useQuery<typeof api.adminSupport.cases>>[1],
) {
  return useQuery(api.adminSupport.cases, args);
}
function CaseCard({ record }: { record: Case }) {
  const me = useQuery(api.users.viewer, {}),
    update = useMutation(api.adminSupport.updateCase);
  const [status, setStatus] = useState(record.status),
    [assignedTo, setAssignedTo] = useState(record.assignedTo ?? "");
  return (
    <article className="border-t py-4 space-y-3">
      <h3>{record.subject}</h3>
      <p>
        {record._id} · {t(record.status)} ·{" "}
        {new Date(record.updatedAt).toLocaleString(getLocale())}
      </p>
      <Link
        className="underline"
        to={`/support/${record.targetType}/${record.targetId}`}
      >
        {record.targetType}: {record.targetId}
      </Link>
      <p>
        <I18nText text="Assigned administrator:" />{" "}
        {record.assignedTo ?? t("Unassigned")}
      </p>
      <Permission permission="support.write">
        <div className="flex flex-wrap gap-3">
          <select
            className="rounded border bg-transparent p-2"
            aria-label={t("Case status")}
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </select>
          <Input
            aria-label={t("Assigned administrator ID")}
            value={assignedTo}
            placeholder={t("Leave blank to unassign")}
            onChange={(e) => setAssignedTo(e.target.value)}
          />
          <Button onClick={() => setAssignedTo(me?._id ?? "")}>
            <I18nText text="Assign to me" />
          </Button>
        </div>
        <SupportAction
          key={`${record.updatedAt}:${status}:${assignedTo}`}
          label="Update support case"
          run={(reason, requestId) =>
            update({
              caseId: record._id,
              status,
              assignedTo: (assignedTo as Id<"users">) || null,
              expectedUpdatedAt: record.updatedAt,
              reason,
              requestId,
            })
          }
        />
      </Permission>
    </article>
  );
}
export function SupportPage() {
  useLocale();
  const navigate = useNavigate();
  const [type, setType] = useState("user"),
    [id, setId] = useState(""),
    [status, setStatus] = useState<(typeof statuses)[number]>("open"),
    [cursor, setCursor] = useState<string | null>(null);
  const result = useCases({ status, paginationOpts: { cursor, numItems: 25 } });
  return (
    <div className="space-y-6">
      <div className="admin-page-heading">
        <h1>
          <I18nText text="Support" />
        </h1>
        <p>
          <I18nText text="Internal cases, account controls, and workspace support history." />
        </p>
      </div>
      <form
        className="admin-card p-5 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(`/support/${type}/${encodeURIComponent(id.trim())}`);
        }}
      >
        <select
          aria-label={t("Support target type")}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="user">{t("User")}</option>
          <option value="workspace">{t("Workspace")}</option>
        </select>
        <Input
          aria-label={t("User or workspace ID")}
          required
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <Button>
          <I18nText text="Open support history" />
        </Button>
      </form>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Support cases" />
        </h2>
        <select
          aria-label={t("Filter case status")}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setCursor(null);
          }}
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
        {result?.page.map((record) => (
          <CaseCard key={`${record._id}:${record.updatedAt}`} record={record} />
        ))}
        {result?.page.length === 0 && (
          <p>
            <I18nText text="No matching support cases." />
          </p>
        )}
        <Pages
          cursor={cursor}
          result={result}
          next={setCursor}
          reset={() => setCursor(null)}
        />
      </section>
    </div>
  );
}
export function SupportTargetPage() {
  useLocale();
  const params = useParams();
  if (params.targetType !== "user" && params.targetType !== "workspace")
    return (
      <p>
        <I18nText text="Invalid support target" />
      </p>
    );
  return (
    <SupportTarget
      key={`${params.targetType}:${params.targetId}`}
      targetType={params.targetType}
      targetId={params.targetId ?? ""}
    />
  );
}
function SupportTarget({
  targetType,
  targetId,
}: {
  targetType: "user" | "workspace";
  targetId: string;
}) {
  const args = { targetType, targetId };
  const detail = useQuery(api.adminSupport.detail, args);
  const [noteCursor, setNoteCursor] = useState<string | null>(null),
    [caseCursor, setCaseCursor] = useState<string | null>(null),
    [subject, setSubject] = useState(""),
    [control, setControl] = useState<
      "suspend" | "generation" | "production" | "revoke_sessions"
    >(targetType === "user" ? "generation" : "production"),
    [enabled, setEnabled] = useState(true);
  const notes = useQuery(
      api.adminSupport.notes,
      detail
        ? {
            ...args,
            paginationOpts: { cursor: noteCursor, numItems: 25 },
          }
        : "skip",
    ),
    cases = useCases({
      ...args,
      paginationOpts: { cursor: caseCursor, numItems: 25 },
    });
  const addNote = useMutation(api.adminSupport.addNote),
    createCase = useMutation(api.adminSupport.createCase),
    restrict = useMutation(api.adminSupport.restrict);
  if (detail === undefined)
    return (
      <p role="status">
        <I18nText text="Loading support history…" />
      </p>
    );
  if (!detail)
    return (
      <p>
        <I18nText text="Support target not found" />
      </p>
    );
  return (
    <div className="space-y-6">
      <div className="admin-page-heading">
        <h1>
          {detail.name ?? (detail.type === "user" ? detail.email : targetId)}
        </h1>
        <p>
          {t(targetType)}: {targetId}
        </p>
      </div>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Account and workspace status" />
        </h2>
        {detail.type === "user" ? (
          <>
            <p>{detail.email}</p>
            <p>
              <I18nText text="Account access:" />{" "}
              {detail.suspendedAt !== undefined ? t("Suspended") : t("Active")}{" "}
              · <I18nText text="Generation:" />{" "}
              {detail.generationPausedAt !== undefined
                ? t("Paused")
                : t("Allowed")}
            </p>
            <p>
              <I18nText text="Sessions revoked:" />{" "}
              {detail.sessionsRevokedAt
                ? new Date(detail.sessionsRevokedAt).toLocaleString(getLocale())
                : t("Never")}
            </p>
            {detail.workspaces.map((w) => (
              <p key={w.id}>
                <Link className="underline" to={`/support/workspace/${w.id}`}>
                  {w.name}
                </Link>{" "}
                · {t("Owner")}
              </p>
            ))}
            {detail.memberships.map((w) => (
              <p key={w.id}>
                <Link className="underline" to={`/support/workspace/${w.id}`}>
                  {w.id}
                </Link>{" "}
                · {t(w.role)}
              </p>
            ))}
          </>
        ) : (
          <>
            <p>{detail.ownerEmail}</p>
            <Link
              className="underline"
              to={`/support/user/${detail.ownerUserId}`}
            >
              <I18nText text="Workspace owner" />
            </Link>
            <p>
              <I18nText text="Production:" />{" "}
              {detail.productionPausedAt !== undefined
                ? t("Paused")
                : t("Allowed")}
            </p>
            {detail.members.map((m) => (
              <p key={m.id}>
                <Link className="underline" to={`/support/user/${m.id}`}>
                  {m.email ?? m.id}
                </Link>{" "}
                · {t(m.role)}
              </p>
            ))}
          </>
        )}
        {detail.truncated && (
          <p>
            <I18nText text="Showing the first 25 memberships. Use the directory for further investigation." />
          </p>
        )}
      </section>
      <Permission permission="accounts.manage">
        {!(detail.type === "user" && detail.isStaff) && (
          <section className="admin-card p-5 space-y-3">
            <h2>
              <I18nText text="Access controls" />
            </h2>
            <p>
              <I18nText text="Suspension blocks product access and sign-in. Generation pauses block new paid stages. Workspace production pauses also block new production writes and uploads. Existing submitted work continues reconciliation. Session revocation requires signing in again." />
            </p>
            <select
              aria-label={t("Account control")}
              value={control}
              onChange={(e) => setControl(e.target.value as typeof control)}
            >
              {targetType === "user" ? (
                <>
                  <option value="generation">{t("Pause generation")}</option>
                  <option value="suspend">{t("Suspend account")}</option>
                  <option value="revoke_sessions">
                    {t("Revoke sessions")}
                  </option>
                </>
              ) : (
                <option value="production">
                  {t("Pause workspace production")}
                </option>
              )}
            </select>
            {control !== "revoke_sessions" && (
              <label>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                <I18nText text="Restriction enabled" />
              </label>
            )}
            <SupportAction
              key={`${control}:${enabled}:${detail.supportRevision}`}
              label="Apply account control"
              run={(reason, requestId) =>
                restrict({
                  ...args,
                  control,
                  enabled: control === "revoke_sessions" ? true : enabled,
                  expectedRevision: detail.supportRevision,
                  reason,
                  requestId,
                })
              }
            />
          </section>
        )}
      </Permission>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Support cases" />
        </h2>
        {cases?.page.map((record) => (
          <CaseCard key={`${record._id}:${record.updatedAt}`} record={record} />
        ))}
        <Pages
          cursor={caseCursor}
          result={cases}
          next={setCaseCursor}
          reset={() => setCaseCursor(null)}
        />
        <Permission permission="support.write">
          <Input
            aria-label={t("Case subject")}
            placeholder={t("Case subject")}
            maxLength={160}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <SupportAction
            key={subject}
            label="Create support case"
            run={(reason, requestId) =>
              createCase({ ...args, subject, reason, requestId })
            }
          />
        </Permission>
      </section>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Internal support notes" />
        </h2>
        <p>
          <I18nText text="Notes are visible only to support administrators and remain in the history. Do not record credentials or payment details." />
        </p>
        <Permission permission="support.write">
          <SupportAction
            label="Add internal note"
            run={(reason, requestId) => addNote({ ...args, reason, requestId })}
          />
        </Permission>
        {notes?.page.map((note) => (
          <article className="border-t py-3" key={note._id}>
            <p>
              {note.authorEmail ?? note.createdBy} ·{" "}
              {new Date(note.createdAt).toLocaleString(getLocale())}{" "}
              {note.caseId && `· ${note.caseId}`}
            </p>
            <p className="whitespace-pre-wrap">{note.text}</p>
          </article>
        ))}
        <Pages
          cursor={noteCursor}
          result={notes}
          next={setNoteCursor}
          reset={() => setNoteCursor(null)}
        />
      </section>
    </div>
  );
}
