export const ADMIN_ROLES = [
  "platform_admin",
  "support",
  "billing",
  "moderation",
  "operations",
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
export type AdminPermission =
  | "waitlist.read"
  | "waitlist.manage"
  | "waitlist.configure"
  | "analytics.read"
  | "analytics.run"
  | "analytics.export"
  | "analytics.financial"
  | "providers.read"
  | "providers.configure"
  | "providers.pause"
  | "support.read"
  | "support.write"
  | "knowledge.publish"
  | "accounts.manage"
  | "jobs.read"
  | "jobs.manage"
  | "jobs.content.read"
  | "directory.read"
  | "billing.read"
  | "billing.write"
  | "moderation.content.read"
  | "storage.read"
  | "storage.manage"
  | "moderation.manage"
  | "operations.read"
  | "operations.manage"
  | "operations.configure"
  | "workspaces.manage"
  | "audit.read"
  | "administrators.manage";
const permissions: Record<AdminRole, readonly AdminPermission[]> = {
  platform_admin: [
    "waitlist.read",
    "waitlist.manage",
    "waitlist.configure",
    "analytics.read",
    "analytics.run",
    "analytics.export",
    "analytics.financial",
    "providers.read",
    "providers.configure",
    "providers.pause",
    "support.read",
    "support.write",
    "knowledge.publish",
    "accounts.manage",
    "directory.read",
    "jobs.read",
    "jobs.manage",
    "jobs.content.read",
    "billing.read",
    "billing.write",
    "moderation.manage",
    "moderation.content.read",
    "storage.read",
    "storage.manage",
    "operations.read",
    "operations.manage",
    "operations.configure",
    "workspaces.manage",
    "audit.read",
    "administrators.manage",
  ],
  support: ["directory.read", "jobs.read", "support.read", "support.write"],
  billing: [
    "analytics.read",
    "analytics.run",
    "analytics.export",
    "analytics.financial",
    "directory.read",
    "jobs.read",
    "billing.read",
    "billing.write",
  ],
  moderation: [
    "directory.read",
    "moderation.manage",
    "moderation.content.read",
    "storage.read",
  ],
  operations: [
    "analytics.read",
    "analytics.run",
    "analytics.export",
    "providers.read",
    "providers.pause",
    "directory.read",
    "jobs.read",
    "jobs.manage",
    "operations.read",
    "operations.manage",
    "storage.read",
  ],
};
export function adminRoles(
  user:
    { isStaff?: boolean; adminRoles?: readonly AdminRole[] } | null | undefined,
): readonly AdminRole[] {
  if (!user?.isStaff) return [];
  return user.adminRoles ?? ["platform_admin"];
}
export function hasAdminPermission(
  user: Parameters<typeof adminRoles>[0],
  permission: AdminPermission,
): boolean {
  return adminRoles(user).some((role) =>
    permissions[role]?.includes(permission),
  );
}

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  platform_admin: "Platform administrator",
  support: "Support",
  billing: "Billing",
  moderation: "Moderation",
  operations: "Operations",
};
