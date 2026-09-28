import { useConvexAuth } from "convex/react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/app/AppShell";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { NotFoundPage } from "@/app/NotFoundPage";
import { ProtectedRoute } from "@/app/ProtectedRoute";
import { StaffRoute } from "@/app/StaffRoute";
import { AssetsPage } from "@/features/assets/AssetsPage";
import { ProjectAssetsPage } from "@/features/assets/ProjectAssetsPage";
import { SignInPage } from "@/features/auth/SignInPage";
import { SignUpPage } from "@/features/auth/SignUpPage";
import { UploadTestPage } from "@/features/dev/UploadTestPage";
import { GenerationTestPage } from "@/features/dev/GenerationTestPage";
import { DevHomePage } from "@/features/dev/DevHomePage";
import { ProjectOverviewPage } from "@/features/projects/ProjectOverviewPage";
import { ProjectWorkspaceLayout } from "@/features/projects/ProjectWorkspaceLayout";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { LookDevPage } from "@/features/look-dev/LookDevPage";
import { EntitySheetPage } from "@/features/look-dev/EntitySheetPage";
import { BlockoutPage } from "@/features/blockout/BlockoutPage";
import { BlockoutEditorPage } from "@/features/blockout/editor/BlockoutEditorPage";
import { ScriptRoomPage } from "@/features/script/ScriptRoomPage";
import { CopilotPage } from "@/features/copilot/CopilotPage";
import { ShotsPage } from "@/features/shots/ShotsPage";
import { ShotDetailPage } from "@/features/shots/ShotDetailPage";
import { EditPage } from "@/features/edit/EditPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import {
  StaffAuditPage,
  StaffEgressPage,
  StaffLayout,
  StaffModerationPage,
  StaffProvidersPage,
  StaffUsersPage,
} from "@/features/staff/StaffPages";

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
            <Route path="/projects" element={<ProjectsPage />} />
            <Route
              path="/projects/:projectId"
              element={<ProjectWorkspaceLayout />}
            >
              <Route index element={<ProjectOverviewPage />} />
              <Route path="copilot" element={<CopilotPage />} />
              <Route path="script" element={<ScriptRoomPage />} />
              <Route path="look-dev" element={<LookDevPage />} />
              <Route
                path="look-dev/:entityId"
                element={<EntitySheetPage />}
              />
              <Route path="blockout" element={<BlockoutPage />} />
              <Route
                path="blockout/shots/:shotId"
                element={<BlockoutEditorPage />}
              />
              <Route path="shots" element={<ShotsPage />} />
              <Route path="shots/:shotId" element={<ShotDetailPage />} />
              <Route path="edit" element={<EditPage />} />
              <Route path="assets" element={<ProjectAssetsPage />} />
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
