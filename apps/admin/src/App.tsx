import { WaitlistPage } from "./Waitlist";
import { AnalyticsHub, DirectoryHub, ProvidersHub } from "./SectionHubs";
import { ModerationPage, StoragePage, MediaDetailPage } from "./Media";
import { SupportPage, SupportTargetPage } from "./Support";
import { BillingPage, BillingWorkspacePage } from "./Billing";
import { JobsPage, JobDetailPage } from "./Jobs";
import { OperationsPage } from "./Operations";
import { hasAdminPermission } from "@cinakey/shared";
import { PermissionRoute } from "./Permissions";
import { AdministrationPage } from "./Administration";
import { AuditPage } from "./Audit";
import { I18nText, LanguageSelector, t, useLocale } from "@cinakey/ui/i18n";
import {
  Clapperboard,
  Users,
  ShieldCheck,
  Activity,
  ScrollText,
  ExternalLink,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  BarChart3,
  BriefcaseBusiness,
  LayoutDashboard,
  HardDrive,
  LifeBuoy,
  CreditCard,
  Settings,
} from "lucide-react";
import { Component, useState, type ReactNode } from "react";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@cinakey/backend";
import { useConvexAuth, useQuery, useQueryStatus } from "@cinakey/api-client";
import { Button } from "@cinakey/ui/button";
import { SignIn } from "./SignIn";
import { UserDetail, WorkspaceDetail } from "./Directory";

export function AdminGate({ children }: { children: ReactNode }) {
  useLocale();
  const auth = useConvexAuth();
  const viewerArgs = auth.isAuthenticated ? {} : "skip";
  const me = useQuery(api.users.viewer, viewerArgs);
  const viewerStatus = useQueryStatus(api.users.viewer, viewerArgs);
  const location = useLocation();
  const { signOut } = useAuthActions();
  if (auth.isLoading)
    return (
      <p role="status" className="p-8">
        <I18nText text="Checking session…" />
      </p>
    );
  if (!auth.isAuthenticated)
    return (
      <Navigate
        to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  if (viewerStatus.isReconnecting)
    return (
      <main className="mx-auto max-w-lg space-y-4 p-10">
        <h1 className="text-xl">
          <I18nText text="Cannot connect to the API" />
        </h1>
        <p role="status">
          <I18nText text="Administrator access cannot be checked while the API is unavailable. Reconnecting automatically…" />
        </p>
        <Button onClick={() => void viewerStatus.retry()}>
          <I18nText text="Retry connection" />
        </Button>
      </main>
    );
  if (me === undefined)
    return (
      <p role="status" className="p-8">
        <I18nText text="Checking administrator access…" />
      </p>
    );
  if (!me?.isStaff)
    return (
      <main className="mx-auto max-w-lg space-y-4 p-10">
        <h1 className="text-xl">
          <I18nText text="Administrator access required" />
        </h1>
        <p>
          <I18nText text="Your account does not have platform administrator access. Internal workspace membership does not grant access here." />
        </p>
        <Button onClick={() => void signOut()}>
          <I18nText text="Sign out" />
        </Button>
      </main>
    );
  return children;
}
const sections = [
  [
    "/operations",
    "Overview",
    ["operations.read"],
    LayoutDashboard,
    "Operations",
  ],
  ["/jobs", "Jobs", ["jobs.read"], BriefcaseBusiness, "Operations"],
  [
    "/providers",
    "Providers",
    ["operations.read", "providers.read"],
    Activity,
    "Operations",
  ],
  ["/waitlist", "Waitlist", ["waitlist.read"], Users, "Accounts"],
  ["/directory", "Directory", ["directory.read"], Users, "Accounts"],
  ["/support", "Support", ["support.read"], LifeBuoy, "Accounts"],
  ["/billing", "Billing", ["billing.read"], CreditCard, "Accounts"],
  ["/moderation", "Moderation", ["moderation.manage"], ShieldCheck, "Content"],
  ["/storage", "Storage", ["storage.read"], HardDrive, "Content"],
  [
    "/analytics",
    "Analytics",
    ["analytics.read", "operations.read"],
    BarChart3,
    "Reporting",
  ],
  ["/audit", "Audit log", ["audit.read"], ScrollText, "Reporting"],
  [
    "/administration",
    "Administration",
    ["administrators.manage"],
    Settings,
    "Access",
  ],
] as const;
function Layout() {
  useLocale();
  const { signOut } = useAuthActions();
  const me = useQuery(api.users.viewer, {});
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("cinakey.admin.sidebar.collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const navPath = /^\/(users|workspaces)(?:\/|$)/.test(location.pathname)
    ? "/directory"
    : location.pathname;
  const title =
    sections.find(([path]) => navPath.startsWith(path))?.[1] ||
    "Administration";
  return (
    <div
      className={`admin-shell ${collapsed ? "admin-shell-collapsed" : ""} ${mobileOpen ? "admin-mobile-open" : ""}`}
    >
      {mobileOpen && (
        <button
          className="admin-sidebar-backdrop"
          aria-label={t("Close navigation")}
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className="admin-sidebar" aria-label={t("Administration")}>
        <div className="admin-sidebar-heading">
          <Link
            to={
              sections.find(([, , permissions]) =>
                permissions.some((permission) =>
                  hasAdminPermission(me, permission),
                ),
              )?.[0] || "/users"
            }
            className="admin-brand"
          >
            <Clapperboard size={30} /> <span>Cinakey</span>
            <small>
              <I18nText text="ADMIN" />
            </small>
          </Link>
          <Button
            className="admin-collapse-toggle"
            variant="ghost"
            aria-label={t(collapsed ? "Expand sidebar" : "Collapse sidebar")}
            aria-expanded={!collapsed}
            onClick={() =>
              setCollapsed((value) => {
                const next = !value;
                try {
                  localStorage.setItem(
                    "cinakey.admin.sidebar.collapsed",
                    String(next),
                  );
                } catch {
                  /* Session preference remains usable. */
                }
                return next;
              })
            }
          >
            {collapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </Button>
          <Button
            className="admin-mobile-close"
            variant="ghost"
            aria-label={t("Close navigation")}
            onClick={() => setMobileOpen(false)}
          >
            <X size={18} />
          </Button>
        </div>
        <p className="rounded border border-amber-900 px-2 py-1 text-xs text-amber-200">
          {import.meta.env.VITE_APP_ENV || t("Environment not labeled")}
        </p>
        <nav
          aria-label={t("Administration")}
          className="flex flex-wrap gap-2 md:flex-col"
        >
          {["Operations", "Accounts", "Content", "Reporting", "Access"].map(
            (group) => {
              const visible = sections.filter(
                ([, , permissions, , sectionGroup]) =>
                  sectionGroup === group &&
                  permissions.some((permission) =>
                    hasAdminPermission(me, permission),
                  ),
              );
              if (!visible.length) return null;
              return (
                <div className="admin-nav-group" key={group}>
                  <h2>{t(group)}</h2>
                  {visible.map(([path, label, , Icon]) => (
                    <Link
                      key={path}
                      to={path}
                      title={t(label)}
                      aria-label={t(label)}
                      onClick={() => setMobileOpen(false)}
                      className={`admin-nav-link ${navPath.startsWith(path) ? "admin-nav-selected" : ""}`}
                      aria-current={
                        navPath.startsWith(path) ? "page" : undefined
                      }
                    >
                      <Icon size={20} />
                      <span>{t(label)}</span>
                    </Link>
                  ))}
                </div>
              );
            },
          )}
        </nav>
        <div className="admin-sidebar-footer">
          <a
            className="admin-web-link"
            title={t("Open web app")}
            aria-label={t("Open web app")}
            href={import.meta.env.VITE_WEB_URL || "http://localhost:5173"}
          >
            <ExternalLink size={18} />{" "}
            <span>
              <I18nText text="Open web app" />
            </span>
          </a>
          <div className="admin-account">
            <span className="admin-avatar">
              {(me?.name || me?.email || "A").slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{me?.name || me?.email || t("Administrator")}</strong>
              <small>
                <I18nText text="Administrator" />
              </small>
            </div>
            <Button
              aria-label={t("Sign out")}
              title={t("Sign out")}
              variant="ghost"
              onClick={() => void signOut()}
            >
              <LogOut size={18} />
            </Button>
          </div>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <Button
            className="admin-mobile-menu"
            variant="ghost"
            aria-label={t("Open navigation")}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} />
          </Button>
          <span>
            <I18nText text="Administration" /> <span className="mx-3">/</span>{" "}
            <strong>{t(title)}</strong>
          </span>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <small>
              {import.meta.env.VITE_APP_ENV || t("Environment not labeled")}
            </small>
            <LanguageSelector className="h-9 w-40 bg-transparent" />
          </div>
        </header>
        <div className="admin-content space-y-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
class Boundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <main className="space-y-4 p-8">
        <h1 className="text-xl">
          <I18nText text="Could not load administration" />
        </h1>
        <p role="alert">{this.state.error.message}</p>
        <Button onClick={() => window.location.reload()}>
          <I18nText text="Reload" />
        </Button>
        <a className="ml-4 underline" href="/users">
          <I18nText text="Return to users" />
        </a>
      </main>
    ) : (
      this.props.children
    );
  }
}
export function App() {
  useLocale();
  return (
    <Boundary>
      <Routes>
        <Route path="/sign-in" element={<SignIn />} />
        <Route
          element={
            <AdminGate>
              <Layout />
            </AdminGate>
          }
        >
          <Route path="directory" element={<DirectoryHub />} />
          <Route
            path="operations"
            element={
              <PermissionRoute permission="operations.read">
                <OperationsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="jobs"
            element={
              <PermissionRoute permission="jobs.read">
                <JobsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="jobs/:jobId"
            element={
              <PermissionRoute permission="jobs.read">
                <JobDetailPage />
              </PermissionRoute>
            }
          />
          <Route
            path="billing"
            element={
              <PermissionRoute permission="billing.read">
                <BillingPage />
              </PermissionRoute>
            }
          />
          <Route
            path="billing/:workspaceId"
            element={
              <PermissionRoute permission="billing.read">
                <BillingWorkspacePage />
              </PermissionRoute>
            }
          />
          <Route
            path="support"
            element={
              <PermissionRoute permission="support.read">
                <SupportPage />
              </PermissionRoute>
            }
          />
          <Route
            path="support/:targetType/:targetId"
            element={
              <PermissionRoute permission="support.read">
                <SupportTargetPage />
              </PermissionRoute>
            }
          />
          <Route
            path="storage"
            element={
              <PermissionRoute permission="storage.read">
                <StoragePage />
              </PermissionRoute>
            }
          />
          <Route
            path="storage/files/:storageId"
            element={
              <PermissionRoute permission="storage.read">
                <MediaDetailPage />
              </PermissionRoute>
            }
          />
          <Route
            path="provider-controls"
            element={
              <PermissionRoute permission="providers.read">
                <Navigate replace to="/providers?tab=controls" />
              </PermissionRoute>
            }
          />
          <Route path="analytics" element={<AnalyticsHub />} />
          <Route index element={<Navigate to="/users" replace />} />
          <Route
            path="administration"
            element={
              <PermissionRoute permission="administrators.manage">
                <AdministrationPage />
              </PermissionRoute>
            }
          />
          <Route
            path="waitlist"
            element={
              <PermissionRoute permission="waitlist.read">
                <WaitlistPage />
              </PermissionRoute>
            }
          />
          <Route
            path="users"
            element={
              <PermissionRoute permission="directory.read">
                <Navigate replace to="/directory?tab=users" />
              </PermissionRoute>
            }
          />
          <Route
            path="users/:userId"
            element={
              <PermissionRoute permission="directory.read">
                <UserDetail />
              </PermissionRoute>
            }
          />
          <Route
            path="workspaces"
            element={
              <PermissionRoute permission="directory.read">
                <Navigate replace to="/directory?tab=workspaces" />
              </PermissionRoute>
            }
          />
          <Route
            path="workspaces/:workspaceId"
            element={
              <PermissionRoute permission="billing.read">
                <WorkspaceDetail />
              </PermissionRoute>
            }
          />
          <Route
            path="moderation"
            element={
              <>
                <PermissionRoute permission="moderation.manage">
                  <ModerationPage />
                </PermissionRoute>
              </>
            }
          />
          <Route
            path="providers"
            element={
              <>
                <ProvidersHub />
              </>
            }
          />
          <Route
            path="egress"
            element={
              <>
                <PermissionRoute permission="operations.read">
                  <Navigate replace to="/analytics?tab=transfers" />
                </PermissionRoute>
              </>
            }
          />
          <Route
            path="audit"
            element={
              <>
                <PermissionRoute permission="audit.read">
                  <AuditPage />
                </PermissionRoute>
              </>
            }
          />
          <Route
            path="*"
            element={
              <>
                <h1>
                  <I18nText text="Page not found" />
                </h1>
                <Link to="/users">
                  <I18nText text="Return to users" />
                </Link>
              </>
            }
          />
        </Route>
      </Routes>
    </Boundary>
  );
}
