import { useConvexAuth } from "convex/react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/app/AppShell";
import { ProtectedRoute } from "@/app/ProtectedRoute";
import { AssetsPage } from "@/features/assets/AssetsPage";
import { ProjectAssetsPage } from "@/features/assets/ProjectAssetsPage";
import { SignInPage } from "@/features/auth/SignInPage";
import { SignUpPage } from "@/features/auth/SignUpPage";
import { UploadTestPage } from "@/features/dev/UploadTestPage";
import { GenerationTestPage } from "@/features/dev/GenerationTestPage";
import { DevHomePage } from "@/features/dev/DevHomePage";
import { ProjectOverviewPage } from "@/features/projects/ProjectOverviewPage";
import { ProjectStagePlaceholder } from "@/features/projects/ProjectStagePlaceholder";
import { ProjectWorkspaceLayout } from "@/features/projects/ProjectWorkspaceLayout";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { LookDevPage } from "@/features/look-dev/LookDevPage";
import { EntitySheetPage } from "@/features/look-dev/EntitySheetPage";
import { BlockoutPage } from "@/features/blockout/BlockoutPage";
import { BlockoutEditorPage } from "@/features/blockout/editor/BlockoutEditorPage";
import { ScriptRoomPage } from "@/features/script/ScriptRoomPage";
import { CopilotPage } from "@/features/copilot/CopilotPage";
import { SettingsPage } from "@/features/settings/SettingsPage";

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
            <Route
              path="shots"
              element={<ProjectStagePlaceholder stage="shots" />}
            />
            <Route
              path="edit"
              element={<ProjectStagePlaceholder stage="edit" />}
            />
            <Route path="assets" element={<ProjectAssetsPage />} />
          </Route>
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/dev" element={<DevHomePage />} />
          <Route path="/dev/upload" element={<UploadTestPage />} />
          <Route path="/dev/generation" element={<GenerationTestPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
