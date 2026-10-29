import { RegistrationControls } from "./RegistrationControls";
import { useId, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@cinakey/backend";
import { useQuery, useMutation, useQueryStatus } from "@cinakey/api-client";
import { t, useLocale, I18nText } from "@cinakey/ui/i18n";
import { Permission } from "./Permissions";
import { Button } from "@cinakey/ui/button";
import { Input } from "@cinakey/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@cinakey/ui/select";
import {
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  UserCheck,
  Search,
  RefreshCw,
  Lock,
  Mail,
  Info,
} from "lucide-react";
type Status = "pending" | "approved" | "rejected";
type Request = FunctionReturnType<typeof api.earlyAccess.list>["page"][number];
const labels = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  queued: "Queued",
  sent: "Sent",
  failed: "Failed",
} as const;
function RequestDetails({
  row,
  busy,
  onDecide,
}: {
  row: Request;
  busy: boolean;
  onDecide: (
    row: Request,
    next: Status,
    reason: string,
    resend?: boolean,
  ) => Promise<boolean>;
}) {
  const locale = useLocale();
  const [reason, setReason] = useState("");
  const [invalidReason, setInvalidReason] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const reasonHelpId = useId();
  const reasonErrorId = useId();
  async function act(next: Status, resend = false) {
    if (reason.length > 2000) {
      setInvalidReason(true);
      reasonRef.current?.focus();
      return;
    }
    setInvalidReason(false);
    if (await onDecide(row, next, reason, resend)) setReason("");
  }
  return (
    <article className="admin-card waitlist-review space-y-4">
      <header>
        <h2>{row.name}</h2>
        <p>{row.email}</p>
        <span className="waitlist-badge" data-status={row.status}>
          {t(labels[row.status])}
        </span>
      </header>
      <h3>{t("Creative idea")}</h3>
      <p className="whitespace-pre-wrap break-words">{row.idea}</p>
      <p>
        {new Date(row.createdAt).toLocaleString(locale)} ·{" "}
        {t(labels[row.status])}
        {row.registeredUserId && (
          <>
            {" "}
            · <I18nText text="Registered" />
          </>
        )}
        {row.emailDelivery && (
          <>
            {" "}
            · <I18nText text="Approval email" />: {t(labels[row.emailDelivery])}
          </>
        )}
      </p>
      <h3>{t("Review history")}</h3>
      {!row.reviewedAt && <p>{t("No reviews yet.")}</p>}
      {row.reviewedAt && (
        <p>
          <I18nText text="Last reviewed" />:{" "}
          {new Date(row.reviewedAt).toLocaleString(locale)} ·{" "}
          {row.reviewerLabel ?? row.reviewedBy}
          <br />
          {row.reason}
        </p>
      )}
      <Permission permission="waitlist.manage">
        <div className="space-y-3">
          <label className="block">
            {t("Review reason (optional)")}
            <textarea
              className="provider-reason"
              ref={reasonRef}
              aria-invalid={!!invalidReason || undefined}
              aria-describedby={`${reasonHelpId}${invalidReason ? ` ${reasonErrorId}` : ""}`}
              maxLength={2000}
              disabled={busy}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (e.target.value.length <= 2000) setInvalidReason(false);
              }}
            />
          </label>
          <small>{reason.length.toLocaleString(locale)} / 2,000</small>
          <p id={reasonHelpId} className="waitlist-helper">
            {t("Optional for all waitlist review actions.")}
          </p>
          {invalidReason && (
            <p id={reasonErrorId} role="alert" className="text-red-400">
              {t("Review reason must be 2000 characters or fewer.")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || row.status === "approved"}
              onClick={() => void act("approved")}
            >
              <I18nText text="Approve" />
            </Button>
            <Button
              variant="outline"
              disabled={
                busy || !!row.registeredUserId || row.status === "rejected"
              }
              onClick={() => void act("rejected")}
            >
              <I18nText text="Reject" />
            </Button>
            <Button
              variant="outline"
              disabled={
                busy || !!row.registeredUserId || row.status === "pending"
              }
              onClick={() => void act("pending")}
            >
              <I18nText text="Return to pending" />
            </Button>
            {row.status === "approved" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act("approved", true)}
              >
                <I18nText text="Resend approval email" />
              </Button>
            )}
          </div>
          <p className="waitlist-helper">
            {t("Approving queues an approval email.")}
          </p>
        </div>
      </Permission>
    </article>
  );
}
export function WaitlistPage() {
  const locale = useLocale();
  const [tab, setTab] = useState("requests");
  const [status, setStatus] = useState<Status | "">("");
  const [email, setEmail] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState(false);
  const registration = useQuery(api.earlyAccess.settings, {});
  const registrationStatus = useQueryStatus(api.earlyAccess.settings, {});
  const counts = useQuery(api.earlyAccess.counts, {});
  const listArgs = {
    status: status || undefined,
    email: email || undefined,
    paginationOpts: { numItems: 25, cursor },
  };
  const rows = useQuery(api.earlyAccess.list, listArgs);
  const listStatus = useQueryStatus(api.earlyAccess.list, listArgs);
  const countStatus = useQueryStatus(api.earlyAccess.counts, {});
  const review = useMutation(api.earlyAccess.review);
  const row = rows?.page.find((row) => row._id === selected) ?? rows?.page[0];
  async function decide(
    row: Request,
    next: Status,
    reason: string,
    resend = false,
  ) {
    if (busy || reason.length > 2000) return false;
    setBusy(true);
    setError(false);
    setNotice(false);
    try {
      await review({
        id: row._id,
        status: next,
        revision: row.revision ?? 0,
        reason,
        requestId: crypto.randomUUID(),
        resend,
      });
      setNotice(true);
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="waitlist-page space-y-6">
      <div className="waitlist-heading">
        <div className="admin-page-heading">
          <h1>{t("Waitlist")}</h1>
          <p>
            {t("Review early-access requests and approve platform access.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void Promise.all([
                listStatus.retry(),
                countStatus.retry(),
                registrationStatus.retry(),
              ])
            }
          >
            <RefreshCw size={16} />
            {t("Refresh")}
          </Button>
          {registration && (
            <span className="waitlist-access-badge">
              <Lock size={15} />
              {registration.requireApproval
                ? t("Approval required")
                : t("Registration open")}
            </span>
          )}
        </div>
      </div>
      <nav className="admin-section-tabs" aria-label={t("Waitlist")}>
        <button
          disabled={busy}
          aria-current={tab === "requests" ? "page" : undefined}
          onClick={() => setTab("requests")}
        >
          {t("Requests")}
        </button>
        <Permission permission="waitlist.configure">
          <button
            disabled={busy}
            aria-current={tab === "access" ? "page" : undefined}
            onClick={() => setTab("access")}
          >
            {t("Registration access")}
          </button>
        </Permission>
      </nav>
      {error && (
        <p role="alert">
          {t(
            "Could not update the request. Refresh and try again. Existing accounts must be managed in Support.",
          )}
        </p>
      )}
      {notice && <p role="status">{t("Waitlist updated.")}</p>}
      <div hidden={tab !== "requests"} className="space-y-6">
        <div className="waitlist-summary">
          {(
            [
              { key: "total", label: "Total", Icon: Users },
              { key: "pending", label: "Pending", Icon: Clock },
              { key: "approved", label: "Approved", Icon: CheckCircle2 },
              { key: "rejected", label: "Rejected", Icon: XCircle },
              { key: "registered", label: "Registered", Icon: UserCheck },
            ] as const
          ).map(({ key, label, Icon }) => (
            <section className="admin-card" key={key}>
              <span>
                <Icon size={20} />
                {t(label)}
              </span>
              <strong>
                {counts ? counts[key].toLocaleString(locale) : "—"}
              </strong>
            </section>
          ))}
        </div>
        {!counts && <p role="status">{t("Loading…")}</p>}
        <div className="waitlist-workbench">
          <section className="admin-card waitlist-requests">
            <header>
              <h2>{t("Access requests")}</h2>
              <div className="waitlist-filters">
                <label className="admin-search">
                  <Search size={18} />
                  <Input
                    aria-label={t("Search exact email")}
                    placeholder={t("Search exact email")}
                    disabled={busy}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setCursor(null);
                      setSelected(null);
                    }}
                  />
                </label>
                <Select
                  disabled={busy}
                  value={status || "all"}
                  onValueChange={(value) => {
                    setStatus(value === "all" ? "" : (value as Status));
                    setCursor(null);
                    setSelected(null);
                  }}
                >
                  <SelectTrigger aria-label={t("Status")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("All statuses")}</SelectItem>
                    {(["pending", "approved", "rejected"] as const).map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(labels[s])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p>{t("Exact email match")}</p>
            </header>
            {!rows ? (
              <p role="status" className="p-5">
                {t("Loading…")}
              </p>
            ) : !rows.page.length ? (
              <p className="p-5">{t("No waitlist requests found.")}</p>
            ) : (
              <div className="overflow-auto">
                <table>
                  <caption className="sr-only">{t("Access requests")}</caption>
                  <thead>
                    <tr>
                      {[
                        "Applicant",
                        "Submitted",
                        "Status",
                        "Approval email",
                      ].map((label) => (
                        <th scope="col" key={label}>
                          {t(label)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.page.map((item) => (
                      <tr
                        key={item._id}
                        className={
                          item._id === row?._id
                            ? "waitlist-selected"
                            : undefined
                        }
                      >
                        <td>
                          <button
                            disabled={busy}
                            aria-label={t("Review {applicant}", {
                              applicant: item.email,
                            })}
                            aria-current={
                              item._id === row?._id ? "true" : undefined
                            }
                            onClick={() => {
                              setSelected(item._id);
                              setNotice(false);
                              setError(false);
                            }}
                          >
                            <strong>{item.name}</strong>
                            <small>{item.email}</small>
                            {item.registeredUserId && (
                              <span className="waitlist-badge">
                                {t("Registered")}
                              </span>
                            )}
                          </button>
                        </td>
                        <td>
                          {new Date(item.createdAt).toLocaleString(locale)}
                        </td>
                        <td>
                          <span
                            className="waitlist-badge"
                            data-status={item.status}
                          >
                            {t(labels[item.status])}
                          </span>
                        </td>
                        <td>
                          {item.emailDelivery ? (
                            <span
                              className="waitlist-badge"
                              data-status={item.emailDelivery}
                            >
                              {t(labels[item.emailDelivery])}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <footer>
              <span>{t("25 per page")}</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={busy || !cursor}
                  onClick={() => {
                    setCursor(null);
                    setSelected(null);
                  }}
                >
                  {t("First page")}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !rows || rows.isDone}
                  onClick={() => {
                    if (rows) {
                      setCursor(rows.continueCursor);
                      setSelected(null);
                    }
                  }}
                >
                  {t("Next page")}
                </Button>
              </div>
            </footer>
          </section>
          {row ? (
            <RequestDetails
              key={`${row._id}:${row.revision ?? 0}:${email}:${status}`}
              row={row}
              busy={busy}
              onDecide={decide}
            />
          ) : (
            <section className="admin-card waitlist-empty">
              <Users size={32} />
              <h2>{t("Request details")}</h2>
              <p>{t("Select an applicant to review their request.")}</p>
            </section>
          )}
        </div>
        <p className="admin-provider-note">
          <Info size={18} />
          {t("Existing accounts must be managed in Support.")}
        </p>
      </div>
      <Permission permission="waitlist.configure">
        <div hidden={tab !== "access"} className="space-y-6">
          <div className="waitlist-access-layout">
            {registration ? (
              <RegistrationControls
                key={registration.revision}
                {...registration}
              />
            ) : (
              <p role="status">{t("Loading…")}</p>
            )}
            <section className="admin-card waitlist-how">
              <h2>{t("How access works")}</h2>
              {[
                { Icon: Users, label: "Requests are reviewed manually." },
                {
                  Icon: Mail,
                  label: "Approved applicants receive an approval email.",
                },
                {
                  Icon: UserCheck,
                  label: "Existing accounts keep access in both modes.",
                },
              ].map(({ Icon, label }) => (
                <div key={label}>
                  <Icon size={22} />
                  <p>{t(label)}</p>
                </div>
              ))}
            </section>
          </div>
          <p className="admin-provider-note">
            <Info size={18} />
            {t("Changes require a reason and confirmation before saving.")}
          </p>
        </div>
      </Permission>
    </div>
  );
}
