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
import { useConvexAuth, useQuery } from "@cinakey/api-client";
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
  const auth = useConvexAuth();
  const me = useQuery(api.users.viewer, auth.isAuthenticated ? {} : "skip");
  const location = useLocation();
  const { signOut } = useAuthActions();
  if (auth.isLoading)
    return (
      <p role="status" className="p-8">
        Checking session…
      </p>
    );
  if (!auth.isAuthenticated)
    return (
      <Navigate
        to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  if (me === undefined)
    return (
      <p role="status" className="p-8">
        Checking administrator access…
      </p>
    );
  if (!me?.isStaff)
    return (
      <main className="mx-auto max-w-lg space-y-4 p-10">
        <h1 className="text-xl">Administrator access required</h1>
        <p>
          Your account does not have platform administrator access. Internal
          workspace membership does not grant access here.
        </p>
        <Button onClick={() => void signOut()}>Sign out</Button>
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
  const { signOut } = useAuthActions();
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <aside className="space-y-6 border-b border-zinc-800 p-5 md:border-b-0 md:border-r">
        <Link to="/users" className="text-lg font-semibold">
          Cinakey Admin
        </Link>
        <p className="rounded border border-amber-900 px-2 py-1 text-xs text-amber-200">
          {import.meta.env.VITE_APP_ENV || "Environment not labeled"}
        </p>
        <nav
          aria-label="Administration"
          className="flex flex-wrap gap-2 md:flex-col"
        >
          {sections.map(([path, label]) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                `rounded px-3 py-2 text-sm ${isActive ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900"}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <a
          className="block text-sm text-zinc-400 underline"
          href={import.meta.env.VITE_WEB_URL || "http://localhost:5173"}
        >
          Open web app
        </a>
        <Button variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </aside>
      <main className="min-w-0 p-5 md:p-8">
        <div className="mx-auto max-w-6xl space-y-6">
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
        <h1 className="text-xl">Could not load administration</h1>
        <p role="alert">{this.state.error.message}</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
        <a className="ml-4 underline" href="/users">
          Return to users
        </a>
      </main>
    ) : (
      this.props.children
    );
  }
}
export function App() {
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
                <h1 className="text-2xl font-semibold">Moderation</h1>
                <StaffModerationPage />
              </>
            }
          />
          <Route
            path="providers"
            element={
              <>
                <h1 className="text-2xl font-semibold">Provider health</h1>
                <StaffProvidersPage />
              </>
            }
          />
          <Route
            path="egress"
            element={
              <>
                <h1 className="text-2xl font-semibold">Egress</h1>
                <StaffEgressPage />
              </>
            }
          />
          <Route
            path="audit"
            element={
              <>
                <h1 className="text-2xl font-semibold">Audit log</h1>
                <StaffAuditPage />
              </>
            }
          />
          <Route
            path="*"
            element={
              <>
                <h1>Page not found</h1>
                <Link to="/users">Return to users</Link>
              </>
            }
          />
        </Route>
      </Routes>
    </Boundary>
  );
}
