import { useRef, useState } from "react";
import { api } from "@dirrio/backend";
import { useMutation, useQuery } from "@dirrio/api-client";
import {
  ADMIN_ROLES,
  ADMIN_ROLE_LABELS,
  hasAdminPermission,
  type AdminPermission,
  type AdminRole,
} from "@dirrio/shared";
import { Button } from "@dirrio/ui/button";
import { Input } from "@dirrio/ui/input";
import { Label } from "@dirrio/ui/label";
import {
  Users,
  Search,
  Crown,
  Headphones,
  CreditCard,
  Shield,
  Settings,
  BookOpen,
  Info,
} from "lucide-react";
import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
const roleInfo = {
  platform_admin: { Icon: Crown, description: "All admin permissions." },
  support: {
    Icon: Headphones,
    description: "Account lookup, job review, and support tools.",
  },
  billing: {
    Icon: CreditCard,
    description: "Billing, funding controls, and financial reports.",
  },
  moderation: {
    Icon: Shield,
    description: "Media review, storage visibility, and moderation actions.",
  },
  operations: {
    Icon: Settings,
    description:
      "Jobs, service monitoring, reports, and provider pause controls.",
  },
};
const permissionIds: AdminPermission[] = [
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
  "accounts.manage",
  "jobs.read",
  "jobs.manage",
  "jobs.content.read",
  "directory.read",
  "billing.read",
  "billing.write",
  "moderation.content.read",
  "storage.read",
  "storage.manage",
  "moderation.manage",
  "operations.read",
  "operations.manage",
  "operations.configure",
  "workspaces.manage",
  "audit.read",
  "administrators.manage",
];
export function AdministrationPage() {
  useLocale();
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const result = useQuery(api.adminAccess.listAdministrators, {
    paginationOpts: { cursor, numItems: 25 },
  });
  const setRoles = useMutation(api.adminAccess.setRoles);
  const emailInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [roles, setSelectedRoles] = useState<AdminRole[]>([]);
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const requestId = useRef<string | null>(null);
  const changed = () => {
    requestId.current = null;
    setReviewed(false);
    setMessage("");
  };
  const rows = result?.page.filter((user) =>
    `${user.email ?? ""} ${user.userId} ${user.roles.map((role) => t(ADMIN_ROLE_LABELS[role])).join(" ")}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <div className="admin-access space-y-6">
      <div className="admin-page-heading">
        <h1>
          <I18nText text="Administration" />
        </h1>
        <p>{t("Manage staff access and understand administrator roles.")}</p>
      </div>
      <div className="admin-access-layout">
        <div className="admin-access-directory space-y-5">
          <section className="admin-card admin-access-accounts">
            <header>
              <div>
                <Users size={22} />
                <h2>{t("Administrator accounts")}</h2>
              </div>
              <span>
                {result
                  ? t("{count} on this page", { count: result.page.length })
                  : "—"}
              </span>
            </header>
            <label className="admin-search">
              <Search size={18} />
              <Input
                aria-label={t("Search accounts on this page")}
                placeholder={t("Search accounts on this page")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {result === undefined ? (
              <p role="status">
                <I18nText text="Loading…" />
              </p>
            ) : (
              <div className="overflow-auto">
                <table>
                  <caption className="sr-only">
                    {t("Administrator accounts")}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("Account email")}</th>
                      <th scope="col">{t("Roles")}</th>
                      <th scope="col">{t("Actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows?.map((user) => (
                      <tr
                        key={user.userId}
                        className={
                          email &&
                          email.toLowerCase() === user.email?.toLowerCase()
                            ? "admin-access-selected"
                            : undefined
                        }
                      >
                        <td>
                          <span className="admin-access-account">
                            <span
                              className="admin-access-avatar"
                              aria-hidden="true"
                            >
                              {(user.email || user.userId)
                                .slice(0, 2)
                                .toUpperCase()}
                            </span>
                            <span>{user.email || user.userId}</span>
                          </span>
                        </td>
                        <td>
                          <div className="admin-access-badges">
                            {user.roles.map((role) => (
                              <span key={role}>
                                {t(ADMIN_ROLE_LABELS[role])}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <Button
                            variant="outline"
                            disabled={busy || !user.email}
                            aria-label={t("Edit roles for {account}", {
                              account: user.email || user.userId,
                            })}
                            onClick={() => {
                              changed();
                              setEmail(user.email || "");
                              setSelectedRoles([...user.roles]);
                              setReason("");
                              emailInput.current?.focus();
                            }}
                          >
                            {t("Edit roles")}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows?.length && (
                  <p role="status" className="p-5">
                    {search
                      ? t("No accounts match your search.")
                      : t("No administrator accounts found.")}
                  </p>
                )}
              </div>
            )}
            <footer>
              <Button
                variant="outline"
                disabled={!cursor}
                onClick={() => setCursor(null)}
              >
                {t("First page")}
              </Button>{" "}
              <Button
                variant="outline"
                disabled={!result || result.isDone}
                onClick={() => setCursor(result!.continueCursor)}
              >
                {t("Next page")}
              </Button>
            </footer>
          </section>
          <section className="admin-card admin-access-guide">
            <header>
              <BookOpen size={22} />
              <h2>{t("Role guide")}</h2>
            </header>
            {ADMIN_ROLES.map((role) => {
              const { Icon, description } = roleInfo[role];
              return (
                <div className="admin-access-guide-row" key={role}>
                  <Icon size={22} />
                  <strong>{t(ADMIN_ROLE_LABELS[role])}</strong>
                  <p>{t(description)}</p>
                </div>
              );
            })}
            <details>
              <summary>{t("View permission details")}</summary>
              {ADMIN_ROLES.map((role) => (
                <section className="admin-access-permissions" key={role}>
                  <h3>{t(ADMIN_ROLE_LABELS[role])}</h3>
                  <ul>
                    {permissionIds
                      .filter((permission) =>
                        hasAdminPermission(
                          { isStaff: true, adminRoles: [role] },
                          permission,
                        ),
                      )
                      .map((permission) => (
                        <li key={permission}>
                          <code>{permission}</code>
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
            </details>
          </section>
        </div>
        <form
          className="admin-card admin-access-editor p-5 space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!reviewed || busy) return;
            setBusy(true);
            setMessage("");
            try {
              await setRoles({
                email: email.trim(),
                roles,
                reason,
                requestId: (requestId.current ??= crypto.randomUUID()),
              });
              requestId.current = null;
              setReviewed(false);
              setMessage(t("Roles updated."));
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : t("Role update failed"),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <header>
            <Users size={22} />
            <h2>
              <I18nText text="Assign administrator roles" />
            </h2>
          </header>
          <Label htmlFor="role-email">{t("Account email")}</Label>
          <Input
            ref={emailInput}
            id="role-email"
            type="email"
            required
            disabled={busy}
            value={email}
            onChange={(e) => {
              changed();
              setEmail(e.target.value);
            }}
          />
          <fieldset disabled={busy} className="space-y-2">
            <legend>{t("Roles")}</legend>
            {ADMIN_ROLES.map((role) => (
              <label key={role} className="admin-access-role">
                <input
                  type="checkbox"
                  aria-label={t(ADMIN_ROLE_LABELS[role])}
                  checked={roles.includes(role)}
                  onChange={(e) => {
                    changed();
                    setSelectedRoles(
                      e.target.checked
                        ? [...roles, role]
                        : roles.filter((r) => r !== role),
                    );
                  }}
                />
                {(() => {
                  const { Icon, description } = roleInfo[role];
                  return (
                    <>
                      <Icon size={22} />
                      <span>
                        <strong>{t(ADMIN_ROLE_LABELS[role])}</strong>
                        <small>{t(description)}</small>
                      </span>
                    </>
                  );
                })()}
              </label>
            ))}
          </fieldset>
          <p>
            <I18nText text="Selecting no roles revokes Admin access. Platform administrators have all permissions. You cannot change your own roles." />
          </p>
          <Label htmlFor="role-reason">{t("Reason")}</Label>
          <textarea
            className="provider-reason"
            placeholder={t("Explain why this access change is needed.")}
            id="role-reason"
            required
            minLength={3}
            maxLength={500}
            disabled={busy}
            value={reason}
            onChange={(e) => {
              changed();
              setReason(e.target.value);
            }}
          />
          <section
            className="admin-access-change"
            aria-label={t("Access change summary")}
          >
            <h3>{t("Access change summary")}</h3>
            <p>
              {email || "—"} →{" "}
              {roles.length
                ? roles.map((role) => t(ADMIN_ROLE_LABELS[role])).join(", ")
                : t("No Admin access")}
            </p>
          </section>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            {t("I have reviewed this access change.")}
          </label>
          <Button
            type="submit"
            disabled={
              busy || !reviewed || reason.trim().length < 3 || !email.trim()
            }
          >
            {t(busy ? "Saving…" : "Save roles")}
          </Button>
          {message && <p role="status">{message}</p>}
        </form>
      </div>
      <aside className="admin-access-note">
        <Info size={20} />{" "}
        <p>
          <I18nText text="Existing staff accounts retain platform administrator access until explicit roles are assigned. Role changes take effect on the next API request." />
        </p>
      </aside>
    </div>
  );
}
