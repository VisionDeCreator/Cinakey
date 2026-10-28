import { Link, useSearchParams } from "react-router-dom";
import { api } from "@cinakey/backend";
import { formatUsd } from "@cinakey/shared";
import { useQuery } from "@/lib/api/hooks";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { BillingSettings } from "./BillingSettings";
import { BudgetSettings } from "./BudgetSettings";
import { TeamSettings } from "./TeamSettings";

export function BillingPage() {
  const { workspaceId, canManage, workspaces } = useWorkspace();
  const [params] = useSearchParams();
  const workspace = workspaces.find((w) => w.workspace._id === workspaceId);
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          Workspace
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-zinc-400">
          {workspace?.workspace.name ?? "Your workspace"} · Manage your plan,
          usage and team in one place.
        </p>
      </header>
      {!canManage ? (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
          <h2 className="font-medium">
            Billing is managed by your workspace owner
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Owners and Admins can view workspace finances. Only the owner can
            change the subscription, purchase usage or access invoices and
            payment methods.
          </p>
          <Link to="/settings" className="mt-4 inline-block text-sm underline">
            Open account settings
          </Link>
        </section>
      ) : !workspaceId ? (
        <p role="status">Loading workspace…</p>
      ) : (
        <div key={workspaceId} className="space-y-8">
          {params.get("billing") === "returned" && (
            <p
              role="status"
              className="rounded-lg border border-sky-900 bg-sky-950/40 p-4 text-sm text-sky-200"
            >
              You’ve returned from checkout. Payment is confirmed by Polar;
              returning here does not confirm a successful payment. Use Refresh
              billing if your subscription or balance has not updated.
            </p>
          )}
          <nav
            aria-label="Billing sections"
            className="flex flex-wrap gap-4 border-b border-zinc-800 pb-4 text-sm text-zinc-400"
          >
            <a href="#subscription" className="hover:text-zinc-100">
              {workspace?.workspace.billingMode === "internal"
                ? "Company funding"
                : "Subscription & invoices"}
            </a>
            <a href="#members" className="hover:text-zinc-100">
              Members & seats
            </a>
            <a href="#spending" className="hover:text-zinc-100">
              Spending & budgets
            </a>
            <a href="#activity" className="hover:text-zinc-100">
              Balance activity
            </a>
          </nav>
          <div id="subscription" className="scroll-mt-6">
            <BillingSettings />
          </div>
          <section
            id="members"
            className="scroll-mt-6 rounded-xl border border-zinc-800 p-5"
          >
            <h2 className="mb-2 text-lg font-medium">Members & seats</h2>
            <p className="mb-5 text-sm text-zinc-400">
              {workspace?.workspace.billingMode === "internal" ? (
                "All team seats are free in this company-funded workspace. Invite members and assign their normal permissions below."
              ) : (
                <>
                  The owner, Admins and Creators each use one paid seat. Buy
                  capacity above before inviting or adding members. Removing a
                  member revokes access; reduce the paid seat quantity
                  separately to change your next invoice. Invitations do not
                  reserve a seat.
                </>
              )}
            </p>
            <TeamSettings />
          </section>
          <section
            id="spending"
            className="scroll-mt-6 rounded-xl border border-zinc-800 p-5"
          >
            <BudgetSettings />
          </section>
          <BalanceActivity
            workspaceId={workspaceId}
            internal={workspace?.workspace.billingMode === "internal"}
          />
        </div>
      )}
    </div>
  );
}

function BalanceActivity({
  workspaceId,
  internal,
}: {
  workspaceId: import("@cinakey/backend").Id<"workspaces">;
  internal?: boolean;
}) {
  const ledger = useQuery(api.billing.listLedger, { workspaceId, limit: 100 });
  return (
    <section
      id="activity"
      className="scroll-mt-6 rounded-xl border border-zinc-800 p-5"
    >
      <h2 className="text-lg font-medium">Balance activity</h2>
      <p className="mb-4 mt-1 text-sm text-zinc-400">
        {internal
          ? "Latest 100 company funding and usage entries. These are accounting entries, not payments or amounts owed."
          : "Latest 100 usage balance entries, including reservations and releases. Subscription invoices are separate and available in the Polar portal."}
      </p>
      {ledger === undefined ? (
        <p role="status" className="text-sm text-zinc-500">
          Loading balance activity…
        </p>
      ) : ledger.length === 0 ? (
        <p className="text-sm text-zinc-500">No balance activity yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Workspace balance activity</caption>
            <thead className="text-xs text-zinc-500">
              <tr>
                <th scope="col" className="p-2">
                  Date
                </th>
                <th scope="col" className="p-2">
                  Activity
                </th>
                <th scope="col" className="p-2 text-right">
                  Change
                </th>
                <th scope="col" className="p-2 text-right">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr
                  key={row._id}
                  className="border-t border-zinc-800 text-zinc-300"
                >
                  <td className="whitespace-nowrap p-2">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="p-2 capitalize">
                    {row.companyFunded && row.reason === "grant"
                      ? "Company funding"
                      : row.reason.replaceAll("_", " ")}
                  </td>
                  <td className="whitespace-nowrap p-2 text-right tabular-nums">
                    {row.delta > 0 ? "+" : row.delta < 0 ? "−" : ""}
                    {formatUsd(Math.abs(row.delta))}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {formatUsd(row.balanceAfter)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
