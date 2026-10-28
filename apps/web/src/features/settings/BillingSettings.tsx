import { Wallet, Clock3, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Id } from "@cinakey/backend";
import { formatUsd } from "@cinakey/shared";
import { useAction, useQuery } from "@/lib/api/hooks";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function BillingSettings() {
  const { workspaceId, canManage } = useWorkspace();
  if (!workspaceId || !canManage) return null;
  return <WorkspaceBilling key={workspaceId} workspaceId={workspaceId} />;
}
function WorkspaceBilling({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const summary = useQuery(api.payments.summary, { workspaceId });
  const configuration = useAction(api.payments.configuration);
  const checkout = useAction(api.payments.checkout);
  const portal = useAction(api.payments.portal);
  const resume = useAction(api.payments.resumeCheckout);
  const refresh = useAction(api.payments.refresh);
  const changeSeats = useAction(api.payments.changeSeats);
  const [config, setConfig] = useState<{
    enabled: boolean;
    environment: string;
  } | null>(null);
  const [seatDraft, setSeatDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [requests] = useState(() => new Map<string, string>());
  useEffect(() => {
    let active = true;
    void configuration({})
      .then((value) => {
        if (active) setConfig(value);
      })
      .catch(() => {
        if (active) setError("Billing configuration could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [configuration]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Billing request failed");
    } finally {
      setBusy(false);
    }
  }
  async function buy(kind: "subscription" | "topup", amountUsd?: number) {
    const key = `${kind}:${kind === "subscription" ? seats : amountUsd}`;
    if (!requests.has(key)) requests.set(key, crypto.randomUUID());
    const result = await checkout({
      workspaceId,
      kind,
      requestId: requests.get(key)!,
      ...(kind === "subscription" ? { seats } : { amountUsd }),
    });
    window.location.assign(result.url);
  }
  const state = summary?.state;
  const seats = Number(
    seatDraft || state?.seats || summary?.occupiedSeats || 1,
  );
  const seatValid =
    Number.isSafeInteger(seats) &&
    seats >= (summary?.occupiedSeats ?? 1) &&
    seats <= 100;
  if (summary?.billingMode === "internal")
    return (
      <InternalFunding
        workspaceId={workspaceId}
        seats={summary.occupiedSeats}
      />
    );
  return (
    <section
      className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5"
      aria-label="Workspace billing"
    >
      <h2 className="text-sm font-semibold text-zinc-200">Workspace billing</h2>
      {!summary && (
        <p role="status" className="text-sm text-zinc-500">
          Loading subscription…
        </p>
      )}
      {!config ? (
        <p className="text-sm text-zinc-500">Loading billing…</p>
      ) : !config.enabled ? (
        <p className="text-sm text-zinc-400">Payments are not enabled yet.</p>
      ) : null}
      <>
        {config?.enabled && config.environment === "sandbox" && (
          <p className="text-sm text-amber-300">
            Sandbox billing · test payments only
          </p>
        )}
        <p className="text-sm text-zinc-400">
          $29/month includes the owner. Additional Admin/Creator seats are
          $15/month each, plus applicable tax. Each paid monthly period includes
          $5 of workspace usage, with no rollover or extra allowance per seat.
        </p>
        <p className="text-sm">
          Subscription: {state?.status ?? "Not subscribed"} ·{" "}
          {summary?.occupiedSeats ?? 1} seats in use · {state?.paidSeats ?? 0}{" "}
          paid
        </p>
        {state?.status === "active" &&
          !summary?.usable &&
          !state.reviewReason && (
            <p className="text-sm text-amber-300">
              Waiting for payment confirmation. Editing, uploads and generation
              remain paused.
            </p>
          )}
        {state && state.seats > state.paidSeats && !state.reviewReason && (
          <p role="status" className="text-sm text-amber-300">
            Waiting for payment confirmation for {state.seats - state.paidSeats}{" "}
            extra seat(s). Current paid seats remain available; new members can
            join after the invoice is confirmed.
          </p>
        )}
        {state?.cancelAtPeriodEnd && (
          <p className="text-sm text-amber-300">
            Subscription ends on{" "}
            {new Date(state.periodEnd).toLocaleDateString()}.
          </p>
        )}
        {state?.pendingSeats !== undefined &&
          ["active", "past_due"].includes(state.status) && (
            <p className="text-sm text-zinc-400">
              Scheduled seat quantity: {state.pendingSeats} at the next renewal.
            </p>
          )}
        {state?.status === "past_due" && (
          <p className="text-sm text-amber-300">
            Payment is overdue. Update your payment method in the billing
            portal; access pauses after the seven-day grace period.
          </p>
        )}
        {state?.reviewReason && (
          <p role="alert" className="text-sm text-red-400">
            {state.reviewReason}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            label="Included usage available"
            value={summary ? formatUsd(summary.includedAvailable) : "…"}
          />
          <Metric
            label="Purchased usage available"
            value={summary ? formatUsd(summary.purchasedAvailable) : "…"}
          />
          <Metric
            label="Paid seats / seats in use"
            value={`${state?.paidSeats ?? 0} / ${summary?.occupiedSeats ?? 1}`}
          />
        </div>
        {state?.subscriptionId && (
          <p className="text-sm text-zinc-400">
            Current billing period:{" "}
            {new Date(state.periodStart).toLocaleDateString()} –{" "}
            {new Date(state.periodEnd).toLocaleDateString()}.{" "}
            {state.cancelAtPeriodEnd
              ? "Cancellation scheduled."
              : ["active", "past_due"].includes(state.status)
                ? "Next billing date is the end of this period."
                : "This subscription is not active."}
          </p>
        )}
        {summary?.isOwner && config?.enabled ? (
          <>
            <label className="block text-sm" htmlFor="billing-seats">
              Total paid seats, including owner
            </label>
            <Input
              id="billing-seats"
              type="number"
              min={summary.occupiedSeats}
              max={100}
              value={seatDraft || String(state?.seats ?? summary.occupiedSeats)}
              onChange={(e) => setSeatDraft(e.target.value)}
            />
            <p className="text-xs text-zinc-500">
              Selected monthly total:{" "}
              {Number.isSafeInteger(seats) && seats >= 1
                ? formatUsd((2900 + 1500 * (seats - 1)) * 10_000)
                : "Choose a seat quantity"}
              . Increases are invoiced now; decreases apply at renewal. Remove
              unused members before reducing seats.
            </p>
            {!seatValid && (
              <p role="alert" className="text-sm text-amber-300">
                Choose a whole number from {summary.occupiedSeats} to 100,
                enough for every current member.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!state?.subscriptionId ||
              ["canceled", "unpaid", "incomplete_expired"].includes(
                state.status,
              ) ? (
                <Button
                  disabled={busy || !seatValid}
                  onClick={() => void run(() => buy("subscription"))}
                >
                  Subscribe with Polar
                </Button>
              ) : (
                <Button
                  disabled={busy || !seatValid || seats === state.seats}
                  onClick={() =>
                    void run(async () => {
                      const result = await changeSeats({
                        workspaceId,
                        seats,
                      });
                      setMessage(
                        result.scheduled
                          ? "Seat reduction scheduled for renewal."
                          : "Seat change submitted. Extra seats activate after payment confirmation.",
                      );
                    })
                  }
                >
                  Update seats
                </Button>
              )}
              {state?.customerId && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await portal({ workspaceId });
                      window.location.assign(result.url);
                    })
                  }
                >
                  Manage subscription & invoices
                </Button>
              )}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await resume({ workspaceId });
                    if (result.url) window.location.assign(result.url);
                    else setMessage("No open checkout was found.");
                  })
                }
              >
                Resume checkout
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await refresh({ workspaceId });
                    setMessage(
                      "Billing refreshed. Payments are confirmed by Polar, not the return page.",
                    );
                  })
                }
              >
                Refresh billing
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {[10, 25, 50].map((amount) => (
                <Button
                  key={amount}
                  variant="outline"
                  disabled={busy || !state?.subscriptionId || !summary.usable}
                  onClick={() => void run(() => buy("topup", amount))}
                >
                  Add ${amount} usage
                </Button>
              ))}
            </div>
            <p className="text-xs text-zinc-500">
              Purchased usage does not expire and is separate from your monthly
              included allowance. No automatic top-ups.
            </p>
          </>
        ) : !summary?.isOwner && summary ? (
          <p className="text-sm text-zinc-500">
            Only the workspace owner can purchase usage or manage the
            subscription.
          </p>
        ) : null}
        <section
          className="space-y-3 border-t border-zinc-800 pt-5"
          aria-label="Invoices and payments"
        >
          <h3 className="font-medium">Invoices & payment methods</h3>
          <p className="text-sm text-zinc-400">
            The workspace owner can use Manage subscription & invoices above to
            download invoices and receipts, update payment methods and billing
            details, or cancel and resume the subscription in Polar’s secure
            portal. Card details are never stored in Cinakey.
          </p>
          {!config?.enabled && (
            <p className="text-sm text-zinc-500">
              Checkout and the billing portal will become available once
              payments are configured. No payment can be made from this page
              yet.
            </p>
          )}
          <h4 className="text-sm font-medium">Recent payments</h4>
          <p className="text-xs text-zinc-500">
            Latest 20 recorded orders. Amounts below exclude tax and may differ
            from the invoice total. View full invoices and older history in the
            portal.
          </p>
          {!summary ? (
            <p className="text-sm text-zinc-500">Loading payments…</p>
          ) : !summary.orders?.length ? (
            <p className="text-sm text-zinc-500">No recorded payments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Recent workspace payments</caption>
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th scope="col" className="p-2">
                      Date
                    </th>
                    <th scope="col" className="p-2">
                      Order
                    </th>
                    <th scope="col" className="p-2">
                      Type
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Amount before tax
                    </th>
                    <th scope="col" className="p-2">
                      Refund
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.orders.map((order) => (
                    <tr
                      key={order._id}
                      className="border-t border-zinc-800 text-zinc-300"
                    >
                      <td className="whitespace-nowrap p-2">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      <td
                        className="max-w-48 truncate p-2 font-mono text-xs"
                        title={order.orderId}
                      >
                        {order.orderId}
                      </td>
                      <td className="p-2">
                        {order.kind === "topup"
                          ? "Usage top-up"
                          : "Subscription"}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {formatUsd(order.netCents * 10_000)}
                      </td>
                      <td className="p-2">
                        {order.refundedCents > 0
                          ? `${formatUsd(order.refundedCents * 10_000)} refunded`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-emerald-400">
          {message}
        </p>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function InternalFunding({
  workspaceId,
  seats,
}: {
  workspaceId: Id<"workspaces">;
  seats: number;
}) {
  const balance = useQuery(api.billing.getBalance, { workspaceId });
  const budgets = useQuery(api.billing.budgets, { workspaceId });
  return (
    <div className="space-y-5">
      <section
        aria-label="Workspace billing"
        className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6"
      >
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">Company-funded workspace</h2>
            <span className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-400">
              Internal
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            Your company covers generation usage and team seats. No subscription
            payment is required. Member permissions and spending limits still
            apply.
          </p>
        </div>
        <div>
          <p className="text-sm text-zinc-400">Amount payable</p>
          <p className="mt-1 text-3xl font-semibold">$0.00</p>
        </div>
      </section>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            label: "Available company funding",
            icon: Wallet,
            value: balance ? formatUsd(balance.balance) : "…",
            help: "Available for generation",
          },
          {
            label: "Reserved usage",
            icon: Clock3,
            value: budgets?.workspace
              ? formatUsd(budgets.workspace.reservedUsdMicros)
              : "…",
            help: "Held for running jobs",
          },
          {
            label: "Team seats",
            icon: Users,
            value: `${seats} ${seats === 1 ? "seat" : "seats"}`,
            help: "No seat charges",
          },
        ].map((item) => (
          <section
            key={item.label}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6"
          >
            <div className="flex items-center gap-4">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-studio-accent-soft)] text-[var(--color-studio-accent)]">
                <item.icon className="size-7" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm text-zinc-300">{item.label}</h3>
                <p className="mt-1 text-3xl font-semibold">{item.value}</p>
                <p className="mt-2 text-xs text-zinc-400">{item.help}</p>
              </div>
            </div>
          </section>
        ))}
      </div>
      <p className="text-xs text-zinc-400">
        Use Members & seats to manage access, Spending & budgets to set limits,
        and Balance activity to review funding and usage. Only platform
        administrators can enable company funding.
      </p>
    </div>
  );
}
