import { SupportWorkspace } from "@dirrio/ui/support";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Id } from "@dirrio/backend";
import { useMutation, useQuery } from "@dirrio/api-client";
import { Button } from "@dirrio/ui/button";
import { Input } from "@dirrio/ui/input";
import { getLocale, I18nText, t, useLocale } from "@dirrio/ui/i18n";
import {
  FolderOpen,
  History,
  ExternalLink,
  UserRound,
  Clock3,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dirrio/ui/select";
import { Permission } from "./Permissions";
const caseLabels = {
  open: "Open",
  investigating: "Investigating",
  waiting: "Waiting",
  resolved: "Resolved",
} as const;
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
        className="provider-reason"
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
      <Button disabled={busy || text.trim().length < 10} type="submit">
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
      <Button variant="outline" onClick={reset} disabled={!cursor}>
        <I18nText text="First page" />
      </Button>
      <Button
        variant="outline"
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
    <article className="admin-card support-case-card space-y-4">
      <header>
        <h3>
          <FolderOpen size={20} />
          {record.subject}
        </h3>
        <span className="support-case-status" data-status={record.status}>
          {t(caseLabels[record.status])}
        </span>
      </header>
      <p className="support-case-meta">
        <Clock3 size={14} />
        {record._id} · {new Date(record.updatedAt).toLocaleString(getLocale())}
      </p>
      <Link
        className="support-case-link"
        to={`/support/${record.targetType}/${record.targetId}`}
      >
        <UserRound size={15} />
        {t(record.targetType === "user" ? "User" : "Workspace")}:{" "}
        {record.targetId}
      </Link>
      {record.conversationId && (
        <Link
          className="support-case-link"
          to={`/support?conversation=${record.conversationId}`}
        >
          <ExternalLink size={15} />
          <I18nText text="Open conversation" />
        </Link>
      )}
      <p>
        <I18nText text="Assigned administrator:" />{" "}
        {record.assignedTo ?? t("Unassigned")}
      </p>
      <Permission permission="support.write">
        <div className="support-case-fields">
          <label>
            {t("Case status")}
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as typeof status)}
            >
              <SelectTrigger aria-label={t("Case status")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(caseLabels[s])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label>
            {t("Assigned administrator ID")}
            <Input
              aria-label={t("Assigned administrator ID")}
              value={assignedTo}
              placeholder={t("Leave blank to unassign")}
              onChange={(e) => setAssignedTo(e.target.value)}
            />
          </label>
          <Button
            variant="outline"
            onClick={() => setAssignedTo(me?._id ?? "")}
          >
            <I18nText text="Assign to me" />
          </Button>
        </div>
        <div className="support-case-reason">
          <h4>{t("Internal reason or note")}</h4>
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
        </div>
      </Permission>
    </article>
  );
}
export function SupportPage() {
  useLocale();
  const navigate = useNavigate();
  const [section, setSection] = useState("inbox");
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
      <nav className="admin-section-tabs" aria-label={t("Support navigation")}>
        {[
          ["inbox", "Inbox"],
          ["help", "Knowledge base"],
          ["cases", "Support cases"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-current={section === key ? "page" : undefined}
            onClick={() => setSection(key!)}
          >
            {t(label!)}
          </button>
        ))}
      </nav>
      <section
        hidden={section === "cases"}
        className="admin-card admin-support-inbox"
      >
        <SupportWorkspace staff view={section === "help" ? "help" : "chats"} />
      </section>
      <div
        hidden={section !== "cases"}
        className="support-cases-page space-y-6"
      >
        <form
          className="admin-card support-case-lookup"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(`/support/${type}/${encodeURIComponent(id.trim())}`);
          }}
        >
          <header>
            <History size={22} />
            <div>
              <h2>{t("Open support history")}</h2>
              <p>
                {t(
                  "Internal cases, account controls, and workspace support history.",
                )}
              </p>
            </div>
          </header>
          <label>
            {t("Support target type")}
            <Select value={type} onValueChange={setType}>
              <SelectTrigger aria-label={t("Support target type")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">{t("User")}</SelectItem>
                <SelectItem value="workspace">{t("Workspace")}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label>
            {t("User or workspace ID")}
            <Input
              aria-label={t("User or workspace ID")}
              required
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </label>
          <Button>
            <I18nText text="Open support history" />
          </Button>
        </form>
        <section className="support-cases-list space-y-4">
          <header>
            <h2>
              <I18nText text="Support cases" />
            </h2>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value as typeof status);
                setCursor(null);
              }}
            >
              <SelectTrigger aria-label={t("Filter case status")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(caseLabels[s])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </header>
          {result === undefined && (
            <p role="status" className="admin-card p-6">
              {t("Loading…")}
            </p>
          )}
          {result?.page.map((record) => (
            <CaseCard
              key={`${record._id}:${record.updatedAt}`}
              record={record}
            />
          ))}
          {result?.page.length === 0 && (
            <div className="admin-card support-cases-empty">
              <FolderOpen size={28} />
              <p>
                <I18nText text="No matching support cases." />
              </p>
            </div>
          )}
          <Pages
            cursor={cursor}
            result={result}
            next={setCursor}
            reset={() => setCursor(null)}
          />
        </section>
      </div>
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
