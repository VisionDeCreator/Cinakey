import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@cinakey/backend";
import { useQuery } from "@cinakey/api-client";
import { hasAdminPermission, type AdminPermission } from "@cinakey/shared";
import { t, useLocale } from "@cinakey/ui/i18n";
import { UsersPage, WorkspacesPage } from "./Directory";
import { ProviderControlsPage } from "./ProviderControls";
import { AnalyticsPage } from "./Analytics";
import {
  StaffEgressPage,
  StaffProvidersPage,
} from "./features/staff/StaffPages";
type SectionTab = {
  id: string;
  label: string;
  permission: AdminPermission;
  content: ReactNode;
};
function SectionHub({ label, tabs }: { label: string; tabs: SectionTab[] }) {
  useLocale();
  const viewer = useQuery(api.users.viewer, {});
  const [params, setParams] = useSearchParams();
  const allowed = tabs.filter((tab) =>
    hasAdminPermission(viewer, tab.permission),
  );
  const selected =
    allowed.find((tab) => tab.id === params.get("tab")) ?? allowed[0];
  if (viewer === undefined)
    return <p role="status">{t("Checking administrator access…")}</p>;
  if (!selected)
    return (
      <p role="alert">
        {t("You do not have permission to view this section.")}
      </p>
    );
  return (
    <>
      {label === "Providers" && (
        <div className="admin-page-heading">
          <h1>{t("Providers")}</h1>
          <p>{t("Monitor model performance and manage spending policies.")}</p>
        </div>
      )}
      {label === "Analytics" && (
        <div className="admin-page-heading">
          <h1>{t("Analytics")}</h1>
          <p>
            {t("Understand product activity, usage, and recorded transfers.")}
          </p>
        </div>
      )}
      <nav className="admin-section-tabs" aria-label={t(label)}>
        {allowed.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={selected.id === tab.id ? "page" : undefined}
            onClick={() =>
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set("tab", tab.id);
                return next;
              })
            }
          >
            {t(tab.label)}
          </button>
        ))}
      </nav>
      <div key={selected.id}>{selected.content}</div>
    </>
  );
}
export function DirectoryHub() {
  return (
    <SectionHub
      label="Directory"
      tabs={[
        {
          id: "users",
          label: "Users",
          permission: "directory.read",
          content: <UsersPage />,
        },
        {
          id: "workspaces",
          label: "Workspaces",
          permission: "directory.read",
          content: <WorkspacesPage />,
        },
      ]}
    />
  );
}
export function ProvidersHub() {
  return (
    <SectionHub
      label="Providers"
      tabs={[
        {
          id: "health",
          label: "Provider health",
          permission: "operations.read",
          content: <StaffProvidersPage />,
        },
        {
          id: "controls",
          label: "Provider controls",
          permission: "providers.read",
          content: <ProviderControlsPage />,
        },
      ]}
    />
  );
}
export function AnalyticsHub() {
  return (
    <SectionHub
      label="Analytics"
      tabs={[
        {
          id: "reports",
          label: "Reports",
          permission: "analytics.read",
          content: <AnalyticsPage />,
        },
        {
          id: "transfers",
          label: "Egress",
          permission: "operations.read",
          content: <StaffEgressPage />,
        },
      ]}
    />
  );
}
