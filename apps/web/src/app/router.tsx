import { ShareWatchPage } from "@/features/sharing/ShareWatchPage";
import { authDestination } from "@/features/auth/auth-errors";
import { AppShell } from "@/app/AppShell";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { NotFoundPage } from "@/app/NotFoundPage";
import { ProtectedRoute } from "@/app/ProtectedRoute";
import { StaffRoute } from "@/app/StaffRoute";
import { AssetWorkbenchPage } from "@/features/assets/AssetWorkbenchPage";
import { AssetsPage } from "@/features/assets/AssetsPage";
import { CreativeAssetsPage } from "@/features/assets/CreativeAssetsPage";
import { SignInPage } from "@/features/auth/SignInPage";
import { SignUpPage } from "@/features/auth/SignUpPage";
import { BlockoutPage } from "@/features/blockout/BlockoutPage";
import { BlockoutEditorPage } from "@/features/blockout/editor/BlockoutEditorPage";
import { EditPage } from "@/features/edit/EditPage";
import { ProjectWorkspaceLayout } from "@/features/projects/ProjectWorkspaceLayout";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { SeriesIndexPage } from "@/features/series/SeriesIndexPage";
import { SeriesPage } from "@/features/series/SeriesPage";
import { GenjutsuPage } from "@/features/genjutsu/GenjutsuPage";
import { BillingPage } from "@/features/settings/BillingPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AdminRedirect } from "@/app/AdminRedirect";
import { useConvexAuth } from "@/lib/api/hooks";
import type { ReactNode } from "react";
import {
  Navigate,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";

function AuthRedirect({ children }: { children: ReactNode }) {
  const [params] = useSearchParams();
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-zinc-400">
        Loading…
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={authDestination(params.get("next"))} replace />;
  }

  return children;
}

function LegacyRemixRedirect() {
  const { sessionId } = useParams();
  const [params] = useSearchParams();
  const query = params.toString();
  return (
    <Navigate
      replace
      to={`${sessionId ? `/remix/${sessionId}` : "/remix"}${query ? `?${query}` : ""}`}
    />
  );
}

function RedirectToStudio() {
  const { projectId } = useParams();
  return <Navigate to={`/projects/${projectId}/studio`} replace />;
}

function RedirectLookDev() {
  const { projectId, entityId } = useParams();
  if (entityId) {
    return (
      <Navigate to={`/projects/${projectId}/assets/${entityId}`} replace />
    );
  }
  return <Navigate to={`/projects/${projectId}/assets`} replace />;
}

export function AppRouter() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/share/:linkId" element={<ShareWatchPage />} />
        <Route
          path="/sign-in"
          element={
            <AuthRedirect>
              <SignInPage />
            </AuthRedirect>
          }
        />
        <Route
          path="/sign-up"
          element={
            <AuthRedirect>
              <SignUpPage />
            </AuthRedirect>
          }
        />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/series" element={<SeriesIndexPage />} />
            <Route path="/series/:seriesId" element={<SeriesPage />} />
            <Route path="/remix" element={<GenjutsuPage />} />
            <Route path="/genjutsu" element={<LegacyRemixRedirect />} />
            <Route path="/remix/:sessionId" element={<GenjutsuPage />} />
            <Route
              path="/genjutsu/:sessionId"
              element={<LegacyRemixRedirect />}
            />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route
              path="/projects/:projectId"
              element={<ProjectWorkspaceLayout />}
            >
              <Route index element={<EditPage />} />
              <Route path="studio" element={<EditPage />} />
              <Route path="copilot" element={<RedirectToStudio />} />
              <Route path="assets" element={<CreativeAssetsPage />} />
              <Route path="assets/:assetId" element={<AssetWorkbenchPage />} />
              <Route path="script" element={<EditPage />} />
              <Route path="look-dev" element={<RedirectLookDev />} />
              <Route path="look-dev/:entityId" element={<RedirectLookDev />} />
              <Route path="blockout" element={<BlockoutPage />} />
              <Route path="blockout/edit" element={<BlockoutEditorPage />} />
              <Route path="video" element={<EditPage />} />
              <Route path="edit" element={<EditPage />} />
            </Route>
            <Route path="/assets" element={<AssetsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="/billing/:billingWorkspaceId?"
              element={<BillingPage />}
            />
            <Route
              path="/staff/*"
              element={
                <StaffRoute>
                  <AdminRedirect />
                </StaffRoute>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}
