import { WorkspaceContext } from "./workspace-context";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { api, type Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { useConfirm } from "@/components/use-confirm";

function storedWorkspace(userId: string) {
  try {
    return localStorage.getItem(`cinakey.workspace:${userId}`);
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const user = useQuery(api.users.viewer);
  const workspaces = useQuery(api.teams.list, {});
  const ensure = useMutation(api.users.ensurePersonalWorkspace);
  const inBilling = useMatch("/billing/*");
  const billingMatch = useMatch("/billing/:billingWorkspaceId");
  const projectMatch = useMatch("/projects/:projectId/*");
  const seriesMatch = useMatch("/series/:seriesId");
  const sessionMatch = useMatch("/remix/:sessionId");
  const routeArgs = projectMatch
    ? { projectId: projectMatch.params.projectId as Id<"projects"> }
    : seriesMatch
      ? { seriesId: seriesMatch.params.seriesId as Id<"series"> }
      : sessionMatch
        ? { sessionId: sessionMatch.params.sessionId as Id<"genjutsuSessions"> }
        : null;
  const routeWorkspace = useQuery(
    api.teams.routeWorkspace,
    routeArgs ?? "skip",
  );
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [selection, setSelection] = useState<{
    userId: string;
    id: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    if (user && !user.personalWorkspaceId)
      void ensure({}).catch((err) => {
        if (current)
          setError(
            err instanceof Error
              ? err.message
              : "Could not initialize workspace",
          );
      });
    return () => {
      current = false;
    };
  }, [user, ensure]);
  const requested = user
    ? selection?.userId === user._id
      ? selection.id
      : storedWorkspace(user._id)
    : null;
  const active =
    workspaces?.find(
      (w) => w.workspace._id === billingMatch?.params.billingWorkspaceId,
    ) ??
    workspaces?.find((w) => w.workspace._id === routeWorkspace) ??
    workspaces?.find((w) => w.workspace._id === requested) ??
    workspaces?.find((w) => w.workspace._id === user?.personalWorkspaceId) ??
    workspaces?.[0];
  const inProduction = routeArgs !== null;
  const entitlement = useQuery(
    api.payments.entitlements,
    active ? { workspaceId: active.workspace._id } : "skip",
  );
  const [entitlementClock, setEntitlementClock] = useState(() => Date.now());
  useEffect(() => {
    const remaining = (entitlement?.validUntil ?? 0) - Date.now();
    if (!entitlement?.validUntil || entitlementClock >= entitlement.validUntil)
      return;
    const timer = window.setTimeout(
      () => setEntitlementClock(Date.now()),
      Math.max(0, Math.min(remaining + 1, 2_000_000_000)),
    );
    return () => window.clearTimeout(timer);
  }, [entitlement?.validUntil, entitlementClock]);
  const canWrite =
    entitlement?.canWrite === true &&
    (!entitlement.validUntil || entitlement.validUntil > entitlementClock);

  // Persist the resolved default too, so transferring ownership does not silently
  // select a newly created personal workspace on the next profile refresh.
  useEffect(() => {
    if (
      !user ||
      !active ||
      inProduction ||
      workspaces?.some((w) => w.workspace._id === requested)
    )
      return;
    try {
      localStorage.setItem(
        `cinakey.workspace:${user._id}`,
        active.workspace._id,
      );
    } catch {
      /* Browser storage is optional. */
    }
  }, [user, active, inProduction, workspaces, requested]);

  async function switchWorkspace(id: Id<"workspaces">) {
    if (
      !user ||
      !workspaces?.some((w) => w.workspace._id === id) ||
      id === active?.workspace._id
    )
      return;
    if (
      routeArgs &&
      !(await confirm({
        title: "Switch workspace?",
        description:
          "This closes the open production. Unsaved changes may be lost if they have not been saved or backed up. Return to the editor to save before switching.",
        confirmLabel: "Switch workspace",
      }))
    )
      return;
    try {
      localStorage.setItem(`cinakey.workspace:${user._id}`, id);
    } catch {
      /* Selection remains usable for this session. */
    }
    setSelection({ userId: user._id, id });
    void navigate(inBilling ? `/billing/${id}` : "/projects");
  }
  if (error)
    return (
      <p role="alert" className="p-6 text-red-400">
        {error}
      </p>
    );
  if (
    !user ||
    workspaces === undefined ||
    !active ||
    (routeArgs && routeWorkspace === undefined)
  )
    return (
      <p role="status" className="p-6 text-zinc-400">
        Loading workspace…
      </p>
    );
  if (
    billingMatch &&
    !workspaces.some(
      (w) => w.workspace._id === billingMatch.params.billingWorkspaceId,
    )
  )
    return (
      <p role="alert" className="p-6 text-red-400">
        This billing workspace is unavailable.{" "}
        <a href="/billing" className="underline">
          Open your workspace billing
        </a>
        .
      </p>
    );
  const role = active.role ?? undefined;
  return (
    <WorkspaceContext.Provider
      value={{
        userId: user._id,
        workspaceId: active.workspace._id,
        role,
        canWrite,
        subscriptionMessage: canWrite
          ? null
          : (entitlement?.message ??
            (entitlement
              ? "Your subscription needs payment confirmation. Editing and new uploads are paused; existing work remains available."
              : "Checking subscription access…")),
        canCreate:
          canWrite &&
          (role === "owner" || role === "admin" || role === "creator"),
        canManage: role === "owner" || role === "admin",
        workspaces: workspaces ?? [],
        switchWorkspace,
      }}
    >
      <Fragment key={`${user._id}:${active.workspace._id}`}>
        {children}
      </Fragment>
    </WorkspaceContext.Provider>
  );
}
