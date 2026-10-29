import { Permission } from "./Permissions";
import { formatUsd } from "@cinakey/ui/i18n";
import { getLocale } from "@cinakey/ui/i18n";
import { I18nText, t, useLocale } from "@cinakey/ui/i18n";
import {
  Search,
  ChevronRight,
  Folder,
  ArrowLeft,
  Wallet,
  Clock,
  ShieldCheck,
  Info,
  UserRound,
  CircleCheck,
  CircleMinus,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@cinakey/api-client";
import { parseUsdToMicros } from "@cinakey/shared";
import { Button } from "@cinakey/ui/button";
import { Input } from "@cinakey/ui/input";
import { Label } from "@cinakey/ui/label";
import {
  InternalWorkspaceForm,
  StaffUsersPage,
} from "./features/staff/StaffPages";
function Pagination({
  cursor,
  isDone,
  next,
  reset,
}: {
  cursor: string | null;
  isDone: boolean;
  next: () => void;
  reset: () => void;
}) {
  useLocale();
  return (
    <div className="flex gap-2">
      <Button variant="outline" disabled={cursor === null} onClick={reset}>
        <I18nText text="First page" />
      </Button>
      <Button variant="outline" disabled={isDone} onClick={next}>
        <I18nText text="Next page" />
      </Button>
    </div>
  );
}
export function UsersPage() {
  useLocale();
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const result = useQuery(api.staff.listUsers, { cursor });
  const users = result?.page.filter((user) =>
    `${user.email || ""} ${user.name || ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <div className="admin-page-heading">
        <h1>
          <I18nText text="Users" />
        </h1>
        <p>
          <I18nText text="Manage accounts, platform access, and usage funds." />
        </p>
      </div>
      <section className="admin-card admin-users-table">
        <header>
          <div>
            <h2>
              <I18nText text="User accounts" />
            </h2>
            <span className="admin-count">
              {result
                ? t("{0} on this page", { 0: result.page.length })
                : t("Loading")}
            </span>
          </div>
          <label className="admin-search">
            <Search size={18} />
            <Input
              aria-label={t("Search accounts on this page")}
              placeholder={t("Search accounts on this page…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </header>
        {!result ? (
          <p role="status" className="p-6">
            <I18nText text="Loading users…" />
          </p>
        ) : (
          <>
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  <I18nText text="User accounts" />
                </caption>
                <thead>
                  <tr>
                    <th>
                      <I18nText text="Account" />
                    </th>
                    <th>
                      <I18nText text="Name" />
                    </th>
                    <th>
                      <I18nText text="Platform access" />
                    </th>
                    <th>
                      <span className="sr-only">
                        <I18nText text="Details" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users?.map((user) => (
                    <tr key={user._id}>
                      <td>
                        <Link
                          className="admin-user-link"
                          to={`/users/${user._id}`}
                        >
                          <span aria-hidden="true" className="admin-avatar">
                            {(user.name || user.email || "U")
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                          <span>{user.email || user._id}</span>
                        </Link>
                      </td>
                      <td>{user.name || "—"}</td>
                      <td>
                        <span
                          className={`admin-role ${user.isStaff ? "admin-role-staff" : ""}`}
                        >
                          {user.isStaff ? t("Administrator") : t("Member")}
                        </span>
                      </td>
                      <td>
                        <Link
                          aria-label={t("View {0}", {
                            0: user.email || user._id,
                          })}
                          to={`/users/${user._id}`}
                        >
                          <ChevronRight size={18} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users?.length === 0 && (
                <p role="status" className="p-6 text-zinc-400">
                  {search
                    ? t("No accounts match this search on the current page.")
                    : t("No user accounts yet.")}
                </p>
              )}
            </div>
            <footer>
              <span>
                <I18nText text="Showing" /> {users?.length}{" "}
                <I18nText text="accounts on this page" />
              </span>
              <Pagination
                cursor={cursor}
                isDone={result.isDone}
                next={() => {
                  setCursor(result.continueCursor);
                  setSearch("");
                }}
                reset={() => {
                  setCursor(null);
                  setSearch("");
                }}
              />
            </footer>
          </>
        )}
      </section>
      <Permission permission="billing.read">
        <StaffUsersPage />
      </Permission>
    </>
  );
}
export function UserDetail() {
  useLocale();
  const { userId } = useParams();
  const user = useQuery(api.staff.userDetail, {
    userId: userId as Id<"users">,
  });
  if (user === undefined)
    return (
      <p role="status">
        <I18nText text="Loading account…" />
      </p>
    );
  if (!user)
    return (
      <p>
        <I18nText text="Account not found." />
      </p>
    );
  return (
    <>
      <Link className="admin-back" to="/users">
        <ArrowLeft size={16} />
        <I18nText text="All users" />
      </Link>
      <header className="admin-user-heading">
        <span aria-hidden="true" className="admin-avatar admin-profile-avatar">
          {(user.name || user.email || "U").slice(0, 2).toUpperCase()}
        </span>
        <div>
          <h1>{user.name || user.email || t("User account")}</h1>
          <Permission permission="support.read">
            <Link className="underline" to={`/support/user/${userId}`}>
              <I18nText text="Support history and account controls" />
            </Link>
          </Permission>
          <p>{user.email || t("No email provided")}</p>
          <div className="admin-platform-access">
            <span
              className={`admin-role ${user.isStaff ? "admin-role-staff" : ""}`}
            >
              {user.isStaff ? t("Administrator") : t("Member")}
            </span>
            <span>
              <I18nText text="Platform access" />
            </span>
          </div>
        </div>
      </header>
      <section className="admin-card admin-account-information">
        <header>
          <UserRound size={24} />
          <h2>
            <I18nText text="Account information" />
          </h2>
        </header>
        <dl>
          <div>
            <dt>
              <I18nText text="Name" />
            </dt>
            <dd>{user.name || "—"}</dd>
          </div>
          <div>
            <dt>
              <I18nText text="Platform access" />
            </dt>
            <dd>{user.isStaff ? t("Administrator") : t("Member")}</dd>
          </div>
          <div>
            <dt>
              <I18nText text="Email" />
            </dt>
            <dd>{user.email || "—"}</dd>
          </div>
          <div>
            <dt>
              <I18nText text="Created" />
            </dt>
            <dd>{new Date(user.createdAt).toLocaleString(getLocale())}</dd>
          </div>
          <div>
            <dt>
              <I18nText text="Email verification" />
            </dt>
            <dd className="admin-verification">
              {user.emailVerified ? (
                <CircleCheck size={18} />
              ) : (
                <CircleMinus size={18} />
              )}
              {user.emailVerified ? t("Verified") : t("Not verified")}
            </dd>
          </div>
          <div>
            <dt>
              <I18nText text="User ID" />
            </dt>
            <dd className="admin-account-id">{user._id}</dd>
          </div>
        </dl>
      </section>
      <section className="admin-card admin-users-table">
        <header>
          <div>
            <Folder size={22} />
            <h2>
              <I18nText text="Workspace memberships" />
            </h2>
            <span className="admin-count">
              {user.workspaces.length}{" "}
              {user.workspaces.length === 1 ? t("workspace") : t("workspaces")}
            </span>
          </div>
        </header>
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              <I18nText text="Workspace memberships" />
            </caption>
            <thead>
              <tr>
                <th>
                  <I18nText text="Workspace" />
                </th>
                <th>
                  <I18nText text="Workspace role" />
                </th>
                <th>
                  <I18nText text="Billing" />
                </th>
                <th>
                  <span className="sr-only">
                    <I18nText text="Details" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {user.workspaces.map((w) => (
                <tr key={w._id}>
                  <td>
                    <Link
                      className="admin-workspace-link"
                      to={`/workspaces/${w._id}`}
                    >
                      <Folder aria-hidden="true" size={20} />
                      {w.name}
                    </Link>
                  </td>
                  <td>
                    <span className="admin-role capitalize">
                      {t(w.role ?? "")}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`admin-role ${w.billingMode === "internal" ? "admin-role-staff" : ""}`}
                    >
                      {w.billingMode === "internal"
                        ? t("Company-funded")
                        : t("Standard billing")}
                    </span>
                  </td>
                  <td>
                    <Link
                      aria-label={t("View {0}", { 0: w.name })}
                      to={`/workspaces/${w._id}`}
                    >
                      <ChevronRight size={18} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!user.workspaces.length && (
            <p className="p-5 text-zinc-400">
              <I18nText text="No workspace memberships." />
            </p>
          )}
        </div>
        <footer>
          <I18nText text="Select a workspace to view its details." />
        </footer>
      </section>
    </>
  );
}
export function WorkspacesPage() {
  useLocale();
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const result = useQuery(api.staff.listWorkspaces, { cursor });
  const workspaces = result?.page.filter((w) =>
    `${w.name} ${w.ownerEmail || ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <div className="admin-page-heading">
        <h1>
          <I18nText text="Workspaces" />
        </h1>
        <p>
          <I18nText text="Browse workspaces, owners, and billing arrangements." />
        </p>
      </div>
      <section className="admin-card admin-users-table admin-workspaces-table">
        <header>
          <div>
            <h2>
              <I18nText text="Workspace directory" />
            </h2>
            <span className="admin-count">
              {result
                ? t("{0} on this page", { 0: result.page.length })
                : t("Loading")}
            </span>
          </div>
          <label className="admin-search">
            <Search size={18} />
            <Input
              aria-label={t("Search workspaces on this page")}
              placeholder={t("Search this page…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </header>
        {!result ? (
          <p role="status" className="p-6">
            <I18nText text="Loading workspaces…" />
          </p>
        ) : (
          <>
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  <I18nText text="Workspaces" />
                </caption>
                <thead>
                  <tr>
                    <th>
                      <I18nText text="Workspace" />
                    </th>
                    <th>
                      <I18nText text="Owner" />
                    </th>
                    <th>
                      <I18nText text="Billing" />
                    </th>
                    <th>
                      <span className="sr-only">
                        <I18nText text="Details" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {workspaces?.map((w) => (
                    <tr key={w._id}>
                      <td>
                        <Link
                          className="admin-workspace-link"
                          to={`/workspaces/${w._id}`}
                        >
                          <Folder aria-hidden="true" size={20} />
                          <span>{w.name}</span>
                        </Link>
                      </td>
                      <td>{w.ownerEmail || "—"}</td>
                      <td>
                        <span
                          className={`admin-role ${w.billingMode === "internal" ? "admin-role-staff" : ""}`}
                        >
                          {w.billingMode === "internal"
                            ? t("Company-funded")
                            : t("Standard")}
                        </span>
                      </td>
                      <td>
                        <Link
                          aria-label={t("View {0}", { 0: w.name })}
                          to={`/workspaces/${w._id}`}
                        >
                          <ChevronRight size={18} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {workspaces?.length === 0 && (
                <p role="status" className="p-6 text-zinc-400">
                  {search
                    ? t("No workspaces match this search on the current page.")
                    : t("No workspaces yet.")}
                </p>
              )}
            </div>
            <footer>
              <span>
                <I18nText text="Showing" /> {workspaces?.length}{" "}
                <I18nText text="workspaces on this page" />
              </span>
              <Pagination
                cursor={cursor}
                isDone={result.isDone}
                next={() => {
                  setCursor(result.continueCursor);
                  setSearch("");
                }}
                reset={() => {
                  setCursor(null);
                  setSearch("");
                }}
              />
            </footer>
          </>
        )}
      </section>
      <Permission permission="workspaces.manage">
        <InternalWorkspaceForm />
      </Permission>
    </>
  );
}
export function WorkspaceDetail() {
  useLocale();
  const { workspaceId } = useParams();
  return (
    <WorkspaceRecord
      key={workspaceId}
      workspaceId={workspaceId as Id<"workspaces">}
    />
  );
}
function WorkspaceRecord({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  useLocale();
  const workspace = useQuery(api.staff.workspaceDetail, { workspaceId });
  const enable = useMutation(api.staff.enableInternalWorkspace);
  const [cap, setCap] = useState("100");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (workspace === undefined)
    return (
      <p role="status">
        <I18nText text="Loading workspace…" />
      </p>
    );
  if (!workspace)
    return (
      <p>
        <I18nText text="Workspace not found." />
      </p>
    );
  const internal = workspace.billingMode === "internal";
  const committed =
    workspace.budget.spentUsdMicros + workspace.budget.reservedUsdMicros;
  const limit = workspace.budget.spendCapUsdMicros;
  const percent =
    limit !== null && limit > 0 ? Math.max(0, (committed / limit) * 100) : null;
  return (
    <>
      <Link className="admin-back" to="/workspaces">
        <ArrowLeft size={16} />
        <I18nText text="All workspaces" />
      </Link>
      <header className="admin-workspace-heading">
        <span className="admin-workspace-symbol">
          <Folder size={32} />
        </span>
        <div>
          <div className="admin-workspace-title">
            <h1>{workspace.name}</h1>
            <Permission permission="storage.read">
              <Link
                className="underline"
                to={`/storage?workspace=${workspaceId}`}
              >
                <I18nText text="Storage inventory" />
              </Link>
            </Permission>
            <Permission permission="support.read">
              <Link
                className="underline"
                to={`/support/workspace/${workspaceId}`}
              >
                <I18nText text="Support history and account controls" />
              </Link>
            </Permission>
            <Link className="underline" to={`/billing/${workspaceId}`}>
              <I18nText text="Billing and reconciliation" />
            </Link>
            <span
              className={`admin-role ${internal ? "admin-role-staff" : ""}`}
            >
              {internal ? t("Company-funded") : t("Standard billing")}
            </span>
          </div>
          <p>
            {workspace.projectCount} <I18nText text="projects · Created" />{" "}
            {new Date(workspace.createdAt).toLocaleDateString(getLocale())}
          </p>
          <p className="admin-workspace-id">
            <I18nText text="Workspace ID:" /> {workspace._id}
          </p>
          <div className="admin-workspace-pills">
            {internal ? (
              <>
                <span>
                  <I18nText text="Free team seats" />
                </span>
                <span>
                  <I18nText text="$0 payable" />
                </span>
              </>
            ) : (
              <>
                <span>{t(workspace.subscriptionStatus ?? "")}</span>
                <span>
                  {workspace.paidSeats} <I18nText text="paid seats" />
                </span>
              </>
            )}
          </div>
        </div>
      </header>
      <section className="admin-card admin-budget-card">
        <header>
          <h2>
            <I18nText text="Monthly budget" />
          </h2>
          <span>
            {workspace.month} <I18nText text="· UTC" />
          </span>
        </header>
        <div className="admin-budget-stats">
          {[
            {
              get label() {
                return t("Spent");
              },
              value: formatUsd(workspace.budget.spentUsdMicros),
              Icon: Wallet,
            },
            {
              get label() {
                return t("Reserved");
              },
              value: formatUsd(workspace.budget.reservedUsdMicros),
              Icon: Clock,
            },
            {
              get label() {
                return t("Monthly cap");
              },
              value: limit === null ? t("No cap") : formatUsd(limit),
              Icon: ShieldCheck,
            },
          ].map(({ label, value, Icon }) => (
            <div key={label}>
              <Icon size={30} />
              <div>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            </div>
          ))}
        </div>
        {percent !== null && (
          <div className="admin-budget-progress">
            <div
              role="progressbar"
              aria-label={t("Monthly budget committed")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, percent)}
              aria-valuetext={t("{0} committed of {1}", {
                0: formatUsd(committed),
                1: formatUsd(limit!),
              })}
            >
              <span style={{ width: `${Math.min(100, percent)}%` }} />
            </div>
            <p>
              <span>
                {formatUsd(committed)} <I18nText text="of" />{" "}
                {formatUsd(limit!)} <I18nText text="committed" />
              </span>
              <span>
                {(percent / 100).toLocaleString(getLocale(), {
                  style: "percent",
                  maximumFractionDigits: 0,
                })}
              </span>
            </p>
          </div>
        )}
        {percent === null && (
          <p className="admin-budget-uncapped">
            {formatUsd(committed)} <I18nText text="committed" />
            {limit === null
              ? " " + t("· No monthly cap")
              : " " + t("· Monthly cap is zero")}
          </p>
        )}
        <div className="admin-budget-costs">
          {internal ? (
            <>
              <div>
                <span>
                  <I18nText text="Recorded provider cost" />
                </span>
                <strong>
                  {formatUsd(workspace.budget.providerCostUsdMicros ?? 0)}
                </strong>
              </div>
              <div>
                <span>
                  <I18nText text="Standard usage price" />
                </span>
                <strong>
                  {formatUsd(workspace.budget.standardPriceUsdMicros ?? 0)}
                </strong>
              </div>
            </>
          ) : (
            <div>
              <span>
                <I18nText text="Usage balance" />
              </span>
              <strong>{formatUsd(workspace.balance)}</strong>
            </div>
          )}
        </div>
        {internal && (
          <p className="admin-budget-note">
            <Info size={20} />
            <span>
              <I18nText text="Company budgets reserve the standard maximum and settle provider costs. Unknown costs retain conservative estimates or reconciliation holds." />
            </span>
          </p>
        )}
      </section>
      <section className="admin-card admin-users-table admin-members-table">
        <header>
          <div>
            <h2>
              <I18nText text="Members & permissions" />
            </h2>
            <span className="admin-count">
              {workspace.members.length}{" "}
              {workspace.members.length === 1 ? t("member") : t("members")}
            </span>
          </div>
        </header>
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              <I18nText text="Workspace members" />
            </caption>
            <thead>
              <tr>
                <th>
                  <I18nText text="Account" />
                </th>
                <th>
                  <I18nText text="Workspace role" />
                </th>
                <th>
                  <span className="sr-only">
                    <I18nText text="Details" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {workspace.members.map((m) => (
                <tr key={m.userId}>
                  <td>
                    <Link className="admin-user-link" to={`/users/${m.userId}`}>
                      <span aria-hidden="true" className="admin-avatar">
                        {(m.email || "U").slice(0, 2).toUpperCase()}
                      </span>
                      {m.email || m.userId}
                    </Link>
                  </td>
                  <td>
                    <span className="admin-role capitalize">
                      {t(m.role ?? "")}
                    </span>
                  </td>
                  <td>
                    <Link
                      aria-label={t("View {0}", { 0: m.email || m.userId })}
                      to={`/users/${m.userId}`}
                    >
                      <ChevronRight size={18} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!workspace.members.length && (
            <p className="p-5 text-zinc-400">
              <I18nText text="No workspace members." />
            </p>
          )}
        </div>
        <footer>
          <I18nText text="Select an account to view its details." />
        </footer>
      </section>
      {!internal && (
        <Permission permission="workspaces.manage">
          <form
            className="admin-card admin-funding-form space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setMessage("");
              void (async () => {
                try {
                  await enable({
                    workspaceId,
                    monthlyCapUsdMicros: parseUsdToMicros(cap),
                    reason,
                  });
                  setMessage("Company funding enabled.");
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : t("Request failed"),
                  );
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <h2 className="text-lg">
              <I18nText text="Enable company funding" />
            </h2>
            <p className="text-sm text-zinc-400">
              <I18nText text="Only unused workspaces without payment or checkout history can be converted. Otherwise create a dedicated internal workspace. This grants free seats and company-funded usage." />
            </p>
            <Label htmlFor="cap">
              <I18nText text="Monthly budget (USD)" />
            </Label>
            <Input
              id="cap"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              inputMode="decimal"
              required
            />
            <Label htmlFor="reason">
              <I18nText text="Audit reason" />
            </Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={3}
            />
            <Button disabled={busy || reason.trim().length < 3 || !cap.trim()}>
              {busy ? t("Enabling…") : t("Enable company funding")}
            </Button>
            {message && <p role="status">{t(message ?? "")}</p>}
          </form>
        </Permission>
      )}
    </>
  );
}
