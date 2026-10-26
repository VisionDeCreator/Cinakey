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
import { DevHomePage } from "@/features/dev/DevHomePage";
import { GenerationTestPage } from "@/features/dev/GenerationTestPage";
import { UploadTestPage } from "@/features/dev/UploadTestPage";
import { EditPage } from "@/features/edit/EditPage";
import { ProjectWorkspaceLayout } from "@/features/projects/ProjectWorkspaceLayout";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { SeriesIndexPage } from "@/features/series/SeriesIndexPage";
import { SeriesPage } from "@/features/series/SeriesPage";
import { GenjutsuPage } from "@/features/genjutsu/GenjutsuPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import {
  StaffAuditPage,
  StaffEgressPage,
  StaffLayout,
  StaffModerationPage,
  StaffProvidersPage,
  StaffUsersPage,
} from "@/features/staff/StaffPages";
import { useConvexAuth } from "@/lib/api/hooks";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";

function AuthRedirect({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-zinc-400">
        Loading…
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/projects" replace />;
  }

  return children;
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
            <Route path="/genjutsu" element={<GenjutsuPage />} />
            <Route path="/genjutsu/:sessionId" element={<GenjutsuPage />} />
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
              path="/staff"
              element={
                <StaffRoute>
                  <StaffLayout />
                </StaffRoute>
              }
            >
              <Route index element={<StaffUsersPage />} />
              <Route path="moderation" element={<StaffModerationPage />} />
              <Route path="providers" element={<StaffProvidersPage />} />
              <Route path="egress" element={<StaffEgressPage />} />
              <Route path="audit" element={<StaffAuditPage />} />
            </Route>
            <Route
              path="/dev"
              element={
                <StaffRoute>
                  <DevHomePage />
                </StaffRoute>
              }
            />
            <Route
              path="/dev/upload"
              element={
                <StaffRoute>
                  <UploadTestPage />
                </StaffRoute>
              }
            />
            <Route
              path="/dev/generation"
              element={
                <StaffRoute>
                  <GenerationTestPage />
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
