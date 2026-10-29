import { useRef, useState } from "react";
import { api } from "@cinakey/backend";
import { useMutation, useQuery } from "@cinakey/api-client";
import {
  ADMIN_ROLES,
  ADMIN_ROLE_LABELS,
  type AdminRole,
} from "@cinakey/shared";
import { Button } from "@cinakey/ui/button";
import { Input } from "@cinakey/ui/input";
import { Label } from "@cinakey/ui/label";
import { I18nText, t, useLocale } from "@cinakey/ui/i18n";
export function AdministrationPage() {
  useLocale();
  const [cursor, setCursor] = useState<string | null>(null);
  const result = useQuery(api.adminAccess.listAdministrators, {
    paginationOpts: { cursor, numItems: 25 },
  });
  const setRoles = useMutation(api.adminAccess.setRoles);
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
  return (
    <>
      <h1 className="text-2xl">
        <I18nText text="Administration" />
      </h1>
      <p>
        <I18nText text="Existing staff accounts retain platform administrator access until explicit roles are assigned. Role changes take effect on the next API request." />
      </p>
      <section className="admin-card p-5 space-y-3">
        <h2>
          <I18nText text="Administrator accounts" />
        </h2>
        {result === undefined ? (
          <p role="status">
            <I18nText text="Loading…" />
          </p>
        ) : (
          <ul>
            {result.page.map((user) => (
              <li key={user.userId} className="flex flex-wrap gap-3 py-2">
                <span>
                  {user.email || user.userId} —{" "}
                  {user.roles
                    .map((role) => t(ADMIN_ROLE_LABELS[role]))
                    .join(", ")}
                </span>
                <Button
                  variant="outline"
                  onClick={() => {
                    changed();
                    setEmail(user.email || "");
                    setSelectedRoles([...user.roles]);
                  }}
                >
                  {t("Edit roles")}
                </Button>
              </li>
            ))}
          </ul>
        )}
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
      </section>
      <form
        className="admin-card p-5 space-y-4"
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
              error instanceof Error ? error.message : t("Role update failed"),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>
          <I18nText text="Assign administrator roles" />
        </h2>
        <Label htmlFor="role-email">{t("Account email")}</Label>
        <Input
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
            <label key={role} className="flex gap-2">
              <input
                type="checkbox"
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
              {t(ADMIN_ROLE_LABELS[role])}
            </label>
          ))}
        </fieldset>
        <p>
          <I18nText text="Selecting no roles revokes Admin access. Platform administrators have all permissions. You cannot change your own roles." />
        </p>
        <Label htmlFor="role-reason">{t("Reason")}</Label>
        <Input
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
        <p>
          {email || "—"} →{" "}
          {roles.length
            ? roles.map((role) => t(ADMIN_ROLE_LABELS[role])).join(", ")
            : t("No Admin access")}
        </p>
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
          disabled={busy || !reviewed || reason.trim().length < 3}
        >
          {t(busy ? "Saving…" : "Save roles")}
        </Button>
        {message && <p role="status">{message}</p>}
      </form>
    </>
  );
}
