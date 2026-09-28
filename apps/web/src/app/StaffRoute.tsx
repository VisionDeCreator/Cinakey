import { api } from "@cinakey/backend";
import { useConvexAuth, useQuery } from "convex/react";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

/** Client gate for /staff and /dev — server still enforces requireStaff. */
export function StaffRoute({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.viewer);

  if (isLoading || me === undefined) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-zinc-400">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/sign-in" replace />;
  }

  if (me === null || me.isStaff !== true) {
    return (
      <div className="mx-auto max-w-lg space-y-2 py-16 text-center">
        <h1 className="text-lg font-semibold text-zinc-100">Staff only</h1>
        <p className="text-sm text-zinc-500">
          You need a staff account to open this page.
        </p>
      </div>
    );
  }

  return children;
}
