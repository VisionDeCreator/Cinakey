import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Id } from "@cinakey/backend";
import { useAction, useMutation, useQuery } from "@cinakey/api-client";
import { getLocale, formatUsd, I18nText, t, useLocale } from "@cinakey/ui/i18n";
import { Button } from "@cinakey/ui/button";
import { Input } from "@cinakey/ui/input";
import { Permission } from "./Permissions";
const balanceLabels = {
  available: "Available",
  reserved: "Reserved",
  spent: "Spent",
  funded: "Funded",
} as const;
function usd(value: number) {
  return `${value < 0 ? "−" : ""}${formatUsd(Math.abs(value))}`;
}
function time(value: number | undefined) {
  return value ? new Date(value).toLocaleString(getLocale()) : "—";
}
function ActionForm({
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
      className="flex flex-wrap gap-3 items-center"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setMessage("");
        request.current ??= crypto.randomUUID();
        try {
          const result = await run(reason, request.current);
          setMessage(
            result && typeof result === "object" && "status" in result
              ? String(result.status)
              : "Completed",
          );
          request.current = null;
          setReason("");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
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
        value={reason}
        disabled={busy}
        onChange={(e) => {
          setReason(e.target.value);
          request.current = null;
        }}
      />
      <Button disabled={busy} type="submit">
        <I18nText text={label} />
      </Button>
      {message && <p role="status">{t(message)}</p>}
    </form>
  );
}
function Pager({
  result,
  cursor,
  next,
  reset,
}: {
  cursor: string | null;
  result: { isDone: boolean; continueCursor: string } | undefined;
  next: (cursor: string) => void;
  reset: () => void;
}) {
  return (
    <div className="flex gap-3 mt-3">
      <Button onClick={reset} disabled={!cursor}>
        <I18nText text="First page" />
      </Button>
      <Button
        disabled={!result || result.isDone}
        onClick={() => result && next(result.continueCursor)}
      >
        {" "}
        <I18nText text="Next page" />{" "}
      </Button>
    </div>
  );
}
export function BillingPage() {
  useLocale();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState(""),
    [pending, setPending] = useState(true),
    [cursor, setCursor] = useState<string | null>(null),
    [reviewCursor, setReviewCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<Id<"paymentEvents"> | null>(null);
  const events = useQuery(api.adminBilling.events, {
    pending,
    paginationOpts: { numItems: 25, cursor },
  });
  const reviews = useQuery(api.adminBilling.reviews, {
    paginationOpts: { numItems: 25, cursor: reviewCursor },
  });
  const reprocess = useMutation(api.adminBilling.reprocess);
  return (
    <div className="space-y-6">
      <div className="admin-page-heading">
        <h1>
          <I18nText text="Billing and reconciliation" />
        </h1>
        <p>
          {" "}
          <I18nText text="Payment environment:" />{" "}
          <strong>{t(events?.environment ?? "Loading…")}</strong>
          <I18nText text=". Amounts in USD." />{" "}
        </p>
      </div>
      <form
        className="admin-card p-5 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(`/billing/${encodeURIComponent(workspace.trim())}`);
        }}
      >
        <Input
          aria-label={t("Workspace ID")}
          placeholder={t("Workspace ID")}
          required
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
        />
        <Button>
          <I18nText text="Open finances" />
        </Button>
      </form>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Payment reviews" />
        </h2>
        {reviews?.page.length === 0 && (
          <p>
            <I18nText text="No payment reviews." />
          </p>
        )}
        {reviews?.page.map((row) => (
          <div key={row._id}>
            <Link className="underline" to={`/billing/${row.workspaceId}`}>
              {row.workspaceId}
            </Link>{" "}
            · {t(row.environment)} · {row.reviewReason}
          </div>
        ))}
        <Pager
          cursor={reviewCursor}
          result={reviews}
          next={setReviewCursor}
          reset={() => setReviewCursor(null)}
        />
      </section>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Payment events" />
        </h2>
        <label>
          <input
            type="checkbox"
            checked={pending}
            onChange={(e) => {
              setPending(e.target.checked);
              setCursor(null);
            }}
          />{" "}
          <I18nText text="Pending only" />{" "}
        </label>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>
                  <I18nText text="Received" />
                </th>
                <th>
                  <I18nText text="Environment / event" />
                </th>
                <th>
                  <I18nText text="Provider object" />
                </th>
                <th>
                  <I18nText text="Processing" />
                </th>
                <th>
                  <I18nText text="Action" />
                </th>
              </tr>
            </thead>
            <tbody>
              {events?.page.map((row) => (
                <tr key={row._id}>
                  <td>{time(row.receivedAt)}</td>
                  <td>
                    {t(row.environment)}
                    <br />
                    {row.eventType}
                    <br />
                    {row.eventId}
                  </td>
                  <td>{row.objectId}</td>
                  <td>
                    {row.processedAt
                      ? t("Processed {time}", { time: time(row.processedAt) })
                      : row.task
                        ? t("{state} ({attempts} attempts)", {
                            state: t(row.task.state),
                            attempts: row.task.attempts,
                          })
                        : t("No worker task")}
                  </td>
                  <td>
                    <Permission permission="billing.write">
                      {!row.processedAt &&
                        (!row.task || row.task.state === "failed") && (
                          <Button onClick={() => setSelected(row._id)}>
                            {" "}
                            <I18nText text="Reprocess" />{" "}
                          </Button>
                        )}
                    </Permission>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {events?.page.length === 0 && (
          <p>
            <I18nText text="No matching payment events." />
          </p>
        )}
        <Permission permission="billing.write">
          {selected && (
            <div>
              <p>
                {" "}
                <I18nText text="Reprocess event" /> {selected}
                <I18nText text=". This fetches current provider records and preserves credit deduplication." />{" "}
              </p>
              <ActionForm
                key={selected}
                label="Reprocess event"
                run={(reason, requestId) =>
                  reprocess({ eventId: selected, reason, requestId })
                }
              />
            </div>
          )}
        </Permission>
        <Pager
          cursor={cursor}
          result={events}
          next={setCursor}
          reset={() => setCursor(null)}
        />
      </section>
      <section className="admin-card p-5">
        <h2>
          <I18nText text="Generation reconciliation" />
        </h2>
        <p>
          <Link className="underline" to="/jobs?attention=billing_review">
            {" "}
            <I18nText text="Missing supplier charges and billing reviews" />{" "}
          </Link>{" "}
          ·{" "}
          <Link className="underline" to="/jobs?attention=stalled">
            {" "}
            <I18nText text="Long-running jobs and held reservations" />{" "}
          </Link>
        </p>
      </section>
    </div>
  );
}
const kinds = ["ledger", "orders", "pools", "checkouts", "refunds"] as const;
export function BillingWorkspacePage() {
  useLocale();
  const { workspaceId: raw } = useParams();
  const workspaceId = raw as Id<"workspaces">;
  const [kind, setKind] = useState<(typeof kinds)[number]>("ledger"),
    [cursor, setCursor] = useState<string | null>(null),
    [auditEnabled, setAuditEnabled] = useState(false),
    [refundOrder, setRefundOrder] = useState<Id<"paymentOrders"> | null>(null),
    [amount, setAmount] = useState(""),
    [creditAmount, setCreditAmount] = useState(""),
    [search, setSearch] = useState("");
  const detail = useQuery(api.adminBilling.workspace, { workspaceId });
  const history = useQuery(
    api.adminBilling.history,
    detail
      ? {
          workspaceId,
          kind,
          search: kind === "ledger" ? search || undefined : undefined,
          paginationOpts: { numItems: 25, cursor },
        }
      : "skip",
  );
  const audit = useQuery(
    api.adminBilling.audit,
    auditEnabled ? { workspaceId } : "skip",
  );
  const repair = useMutation(api.adminBilling.repair),
    resolve = useMutation(api.adminBilling.resolveReview),
    credit = useMutation(api.adminBilling.credit);
  const refund = useAction(api.adminBilling.refund),
    reconcile = useAction(api.adminBilling.reconcileRefunds);
  const [message, setMessage] = useState("");
  if (detail === undefined)
    return (
      <p role="status">
        <I18nText text="Loading finances…" />
      </p>
    );
  if (!detail)
    return (
      <p>
        <I18nText text="Workspace not found." />
      </p>
    );
  return (
    <div className="space-y-6">
      <div className="admin-page-heading">
        <h1>
          {detail.workspace.name}
          <I18nText text=": finances" />
        </h1>
        <p>
          {" "}
          <I18nText text="Deployment:" />{" "}
          <strong>{t(detail.environment)}</strong>{" "}
          <I18nText text="· Payment account:" />{" "}
          <strong>{t(detail.payment?.environment ?? "None")}</strong> ·{" "}
          {t(detail.workspace.billingMode)}
        </p>
        <Link className="underline" to={`/workspaces/${workspaceId}`}>
          {" "}
          <I18nText text="Workspace details and account credits" />{" "}
        </Link>
      </div>
      <section className="admin-card p-5 grid gap-3 sm:grid-cols-4">
        {(["available", "reserved", "spent", "funded"] as const).map((key) => (
          <div key={key}>
            <h2>{t(balanceLabels[key])}</h2>
            <p>{usd(detail.account?.[key] ?? 0)}</p>
          </div>
        ))}
      </section>
      <Permission permission="billing.write">
        {detail.workspace.billingMode !== "internal" && (
          <section className="admin-card p-5 space-y-3">
            <h2>
              <I18nText text="Account credit" />
            </h2>
            <p>
              {" "}
              <I18nText text="Add a workspace credit with a recorded reason. This does not return money to the payment method." />{" "}
            </p>
            <Input
              aria-label={t("Credit amount in USD")}
              type="number"
              min="0.01"
              step="0.01"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
            />
            <ActionForm
              key={creditAmount}
              label="Issue account credit"
              run={(reason, requestId) => {
                const amountUsdMicros = Math.round(
                  Number(creditAmount) * 1_000_000,
                );
                return credit({
                  workspaceId,
                  amountUsdMicros,
                  reason,
                  requestId,
                });
              }}
            />
          </section>
        )}
      </Permission>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Subscription and payment review" />
        </h2>
        <p>
          {detail.payment
            ? t("{status} · {seats} paid seats · period ends {end}", {
                status: t(detail.payment.status),
                seats: detail.payment.paidSeats,
                end: time(detail.payment.periodEnd),
              }) +
              (detail.payment.cancelAtPeriodEnd
                ? t(" · cancels at period end")
                : "")
            : t("No payment subscription")}
        </p>
        {detail.payment?.reviewReason && (
          <>
            <p role="alert">{detail.payment.reviewReason}</p>
            <Permission permission="billing.write">
              <p>
                {" "}
                <I18nText text="After investigating supplier evidence and any used funds, record your resolution. Unresolved refunds or accounting discrepancies prevent clearance." />{" "}
              </p>
              <ActionForm
                label="Resolve payment review"
                run={(reason, requestId) =>
                  resolve({ workspaceId, reason, requestId })
                }
              />
            </Permission>
          </>
        )}
      </section>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Ledger reconciliation" />
        </h2>
        <p>
          {" "}
          <I18nText text="Compare stored account and spend totals with up to 1,000 authoritative ledger entries. Repairs rebuild derived totals; they do not issue credits or release generation reservations." />{" "}
        </p>
        <Button onClick={() => setAuditEnabled(true)}>
          <I18nText text="Audit ledger" />
        </Button>
        {audit?.error && <p role="alert">{audit.error}</p>}
        {audit?.account && (
          <>
            <p>
              {audit.consistent
                ? "Account and spend totals match the ledger."
                : `Discrepancies: ${audit.differences.join(", ")}`}
            </p>
            <p>
              <I18nText text="Audited ledger sequence:" />{" "}
              {audit.account.sequence}
            </p>
            {!audit.consistent && (
              <Permission permission="billing.write">
                <ActionForm
                  label="Rebuild derived totals"
                  run={(reason, requestId) =>
                    repair({
                      workspaceId,
                      reason,
                      requestId,
                      expectedSequence: audit.account!.sequence,
                    })
                  }
                />
              </Permission>
            )}
          </>
        )}
      </section>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Financial history" />
        </h2>
        {kind === "ledger" && (
          <Input
            aria-label={t("Search ledger")}
            placeholder={t("Exact job ID, request ID, or reason")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCursor(null);
            }}
          />
        )}
        <div className="flex flex-wrap gap-3">
          {kinds.map((k) => (
            <Button
              key={k}
              variant={k === kind ? "default" : "outline"}
              onClick={() => {
                setKind(k);
                setCursor(null);
              }}
            >
              {t(k)}
            </Button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>
                  <I18nText text="Record" />
                </th>
                <th>
                  <I18nText text="Details" />
                </th>
                <th>
                  <I18nText text="Amounts" />
                </th>
                <th>
                  <I18nText text="Links / actions" />
                </th>
              </tr>
            </thead>
            <tbody>
              {history?.page.map((row) => (
                <tr key={row._id} className="border-b">
                  <td>
                    {row._id}
                    <br />
                    {"createdAt" in row ? time(row.createdAt) : ""}
                  </td>
                  <td>
                    {"reason" in row
                      ? kind === "ledger"
                        ? t(row.reason)
                        : row.reason
                      : ""}
                    {"kind" in row ? t(row.kind) : ""}
                    <br />
                    {"state" in row
                      ? t(row.state)
                      : "status" in row
                        ? t(row.status)
                        : ""}
                    {"environment" in row ? ` · ${t(row.environment)}` : ""}
                    <br />
                    {"requestId" in row
                      ? t("Request: {id}", { id: row.requestId })
                      : ""}
                  </td>
                  <td>
                    {"delta" in row ? (
                      <>
                        {" "}
                        <I18nText text="Change" /> {usd(row.delta)}
                        <br /> <I18nText text="Balance" />{" "}
                        {usd(row.balanceAfter)} · #{row.sequence}
                      </>
                    ) : "netCents" in row ? (
                      <>
                        {" "}
                        <I18nText text="Net amount" />{" "}
                        {usd(row.netCents * 10000)}
                        <br /> <I18nText text="Refunded amount" />{" "}
                        {usd(row.refundedCents * 10000)}
                        <br /> <I18nText text="Granted" />{" "}
                        {usd(row.grantedUsdMicros)}{" "}
                        <I18nText text="· reversed" />{" "}
                        {usd(row.reversedUsdMicros)}
                      </>
                    ) : "remaining" in row ? (
                      <>
                        {" "}
                        <I18nText text="Granted" /> {usd(row.granted)}
                        <br /> <I18nText text="Remaining" />{" "}
                        {usd(row.remaining)} <I18nText text="· held" />{" "}
                        {usd(row.held)}
                        <br /> <I18nText text="Expires" /> {time(row.expiresAt)}
                        {row.revoked ? ` · ${t("Revoked")}` : ""}
                      </>
                    ) : "amountCents" in row ? (
                      usd(row.amountCents * 10000)
                    ) : (
                      ""
                    )}
                  </td>
                  <td>
                    {"jobId" in row && row.jobId && (
                      <Link className="underline" to={`/jobs/${row.jobId}`}>
                        {" "}
                        <I18nText text="Generation job" />{" "}
                      </Link>
                    )}
                    {"netCents" in row && (
                      <Permission permission="billing.write">
                        <Button
                          onClick={() => {
                            setRefundOrder(row._id as Id<"paymentOrders">);
                            setAmount("");
                          }}
                        >
                          {" "}
                          <I18nText text="Payment refund" />{" "}
                        </Button>
                        <Button
                          onClick={async () => {
                            try {
                              const result = await reconcile({
                                orderId: row._id as Id<"paymentOrders">,
                              });
                              setMessage(
                                t(
                                  "Matched {count} refunds. Current order reconciled.",
                                  {
                                    count:
                                      result.matched.toLocaleString(
                                        getLocale(),
                                      ),
                                  },
                                ),
                              );
                            } catch (e) {
                              setMessage(
                                e instanceof Error ? e.message : String(e),
                              );
                            }
                          }}
                        >
                          {" "}
                          <I18nText text="Check refunds" />{" "}
                        </Button>
                      </Permission>
                    )}
                    {"orderId" in row ? (
                      <p>
                        <I18nText text="Order:" /> {row.orderId}
                      </p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {history?.page.length === 0 && (
          <p>
            <I18nText text="No records." />
          </p>
        )}
        <Pager
          cursor={cursor}
          result={history}
          next={setCursor}
          reset={() => setCursor(null)}
        />
        {message && <p role="status">{t(message)}</p>}
        <Permission permission="billing.write">
          {refundOrder && (
            <div className="space-y-3">
              <h3>
                <I18nText text="Refund payment" /> {refundOrder}
              </h3>
              <p>
                {" "}
                <I18nText text="This returns money through Polar in the order’s environment. It places the workspace in payment review until reconciled. Used funds and subscription access require review." />{" "}
              </p>
              <Input
                aria-label={t("Refund amount in USD")}
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <ActionForm
                key={`${refundOrder}:${amount}`}
                label="Request payment refund"
                run={(reason, requestId) => {
                  const cents = Math.round(Number(amount) * 100);
                  if (
                    !Number.isFinite(Number(amount)) ||
                    Number(amount) <= 0 ||
                    Math.abs(cents - Number(amount) * 100) > 0.000001
                  )
                    throw new Error(
                      "Enter a valid USD amount with at most two decimal places",
                    );
                  return refund({
                    orderId: refundOrder,
                    amountCents: cents,
                    reason,
                    requestId,
                  });
                }}
              />
            </div>
          )}
        </Permission>
      </section>
    </div>
  );
}
