import type { ReactNode } from "react";
import { api } from "@dirrio/backend";
import { useQuery } from "@dirrio/api-client";
import { hasAdminPermission, type AdminPermission } from "@dirrio/shared";
import { I18nText } from "@dirrio/ui/i18n";
export function Permission({
  permission,
  children,
}: {
  permission: AdminPermission;
  children: ReactNode;
}) {
  const me = useQuery(api.users.viewer, {});
  return hasAdminPermission(me, permission) ? children : null;
}
export function PermissionRoute({
  permission,
  children,
}: {
  permission: AdminPermission;
  children: ReactNode;
}) {
  const me = useQuery(api.users.viewer, {});
  if (me === undefined)
    return (
      <p role="status">
        <I18nText text="Checking administrator access…" />
      </p>
    );
  return hasAdminPermission(me, permission) ? (
    children
  ) : (
    <p role="alert">
      <I18nText text="You do not have permission to view this section." />
    </p>
  );
}
