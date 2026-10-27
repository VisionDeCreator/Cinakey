import { createContext, useContext } from "react";
import type { Id } from "@cinakey/backend";
type Role = "owner" | "admin" | "creator" | "reviewer";
type WorkspaceState = {
  userId?: string;
  workspaceId?: Id<"workspaces">;
  role?: Role;
  canWrite?: boolean;
  subscriptionMessage?: string | null;
  canCreate: boolean;
  canManage: boolean;
  workspaces: Array<{
    workspace: { _id: Id<"workspaces">; name: string };
    role: Role | null;
  }>;
  switchWorkspace: (id: Id<"workspaces">) => Promise<void>;
};
export const WorkspaceContext = createContext<WorkspaceState>({
  canCreate: true,
  canManage: true,
  workspaces: [],
  switchWorkspace: async () => {},
});
export function useWorkspace() {
  return useContext(WorkspaceContext);
}

/** Authenticated production drafts never share a browser key across collaborators. */
export function useDraftScope() {
  const { userId, workspaceId } = useWorkspace();
  return userId && workspaceId ? `${userId}.${workspaceId}.` : "";
}
