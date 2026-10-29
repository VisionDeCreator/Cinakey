import { I18nText, useLocale } from "@dirrio/ui/i18n";
import { useParams } from "react-router-dom";
export function AdminRedirect() {
  useLocale();
  const { "*": section } = useParams();
  const path = ["moderation", "providers", "egress", "audit"].includes(
    section ?? "",
  )
    ? section
    : "users";
  const base =
    import.meta.env.VITE_ADMIN_URL ||
    (import.meta.env.DEV ? "http://localhost:5174" : null);
  return (
    <section className="mx-auto max-w-lg space-y-4 py-12">
      <h1 className="text-xl font-semibold">
        <I18nText text="Staff tools have moved" />
      </h1>
      <p className="text-sm text-zinc-400">
        <I18nText text="User management, internal workspaces, moderation, provider health, egress, and audit logs are now in the admin panel." />
      </p>
      {base ? (
        <a className="underline" href={`${base.replace(/\/$/, "")}/${path}`}>
          <I18nText text="Open admin panel" />
        </a>
      ) : (
        <p role="status">
          <I18nText text="The admin panel URL has not been configured for this deployment." />
        </p>
      )}
    </section>
  );
}
