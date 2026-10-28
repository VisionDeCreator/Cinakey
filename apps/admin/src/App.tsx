import { I18nText, LanguageSelector, t, useLocale } from "@cinakey/ui/i18n";
import {
  Clapperboard,
  Users,
  Folder,
  ShieldCheck,
  Activity,
  CloudUpload,
  ScrollText,
  ExternalLink,
  LogOut,
} from "lucide-react";
import { Component, type ReactNode } from "react";
import {
  Link,
  NavLink,
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
import {
  UsersPage,
  UserDetail,
  WorkspacesPage,
  WorkspaceDetail,
} from "./Directory";
import {
  StaffAuditPage,
  StaffEgressPage,
  StaffModerationPage,
  StaffProvidersPage,
} from "./features/staff/StaffPages";

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
  ["/users", "Users"],
  ["/workspaces", "Workspaces"],
  ["/moderation", "Moderation"],
  ["/providers", "Provider health"],
  ["/egress", "Egress"],
  ["/audit", "Audit log"],
] as const;
function Layout() {
  useLocale();
  const { signOut } = useAuthActions();
  const me = useQuery(api.users.viewer, {});
  const location = useLocation();
  const title =
    sections.find(([path]) => location.pathname.startsWith(path))?.[1] ||
    "Administration";
  const icons = [Users, Folder, ShieldCheck, Activity, CloudUpload, ScrollText];
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link to="/users" className="admin-brand">
          <Clapperboard size={30} /> <span>Cinakey</span>
          <small>
            <I18nText text="ADMIN" />
          </small>
        </Link>
        <p className="rounded border border-amber-900 px-2 py-1 text-xs text-amber-200">
          {import.meta.env.VITE_APP_ENV || t("Environment not labeled")}
        </p>
        <nav
          aria-label={t("Administration")}
          className="flex flex-wrap gap-2 md:flex-col"
        >
          {sections.map(([path, label], index) => {
            const Icon = icons[index]!;
            return (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  `rounded-xl border-l-2 px-3 py-2 text-sm ${isActive ? "border-[var(--color-studio-accent)] bg-zinc-800 text-zinc-100" : "border-transparent text-zinc-400 hover:bg-zinc-900"}`
                }
              >
                <Icon size={20} />
                {t(label)}
              </NavLink>
            );
          })}
        </nav>
        <a
          className="admin-web-link"
          href={import.meta.env.VITE_WEB_URL || "http://localhost:5173"}
        >
          <ExternalLink size={18} /> <I18nText text="Open web app" />
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
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
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
          <Route index element={<Navigate to="/users" replace />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:userId" element={<UserDetail />} />
          <Route path="workspaces" element={<WorkspacesPage />} />
          <Route path="workspaces/:workspaceId" element={<WorkspaceDetail />} />
          <Route
            path="moderation"
            element={
              <>
                <StaffModerationPage />
              </>
            }
          />
          <Route
            path="providers"
            element={
              <>
                <StaffProvidersPage />
              </>
            }
          />
          <Route
            path="egress"
            element={
              <>
                <StaffEgressPage />
              </>
            }
          />
          <Route
            path="audit"
            element={
              <>
                <StaffAuditPage />
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
