import { useState } from "react";
import { api } from "@dirrio/backend";
import { useQuery } from "@dirrio/api-client";
import { Input } from "@dirrio/ui/input";
import { Button } from "@dirrio/ui/button";
import { getLocale, I18nText, t, useLocale } from "@dirrio/ui/i18n";
export function AuditPage() {
  useLocale();
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    actorUserId: "",
    action: "",
    targetId: "",
    from: "",
    to: "",
  });
  const [filters, setFilters] = useState(draft);
  const [filterError, setFilterError] = useState("");
  const result = useQuery(api.adminAccess.listAudit, {
    paginationOpts: { cursor, numItems: 25 },
    actorUserId: filters.actorUserId || undefined,
    action: filters.action || undefined,
    targetId: filters.targetId || undefined,
    from: filters.from ? new Date(filters.from).getTime() : undefined,
    to: filters.to ? new Date(filters.to).getTime() : undefined,
  });
  return (
    <>
      <h1 className="text-2xl">
        <I18nText text="Audit log" />
      </h1>
      <form
        className="admin-card p-5 flex flex-wrap gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            draft.from &&
            draft.to &&
            new Date(draft.from).getTime() > new Date(draft.to).getTime()
          ) {
            setFilterError(t("The start date must be before the end date."));
            return;
          }
          setFilterError("");
          setCursor(null);
          setFilters(draft);
        }}
      >
        {(["actorUserId", "action", "targetId", "from", "to"] as const).map(
          (key) => (
            <label key={key}>
              {t(
                {
                  actorUserId: "Actor user ID (exact)",
                  action: "Action (exact)",
                  targetId: "Target ID (exact)",
                  from: "From (local time)",
                  to: "To (local time)",
                }[key],
              )}
              <Input
                type={
                  key === "from" || key === "to" ? "datetime-local" : "text"
                }
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </label>
          ),
        )}
        <Button type="submit">{t("Apply filters")}</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const empty = {
              actorUserId: "",
              action: "",
              targetId: "",
              from: "",
              to: "",
            };
            setFilterError("");
            setDraft(empty);
            setFilters(empty);
            setCursor(null);
          }}
        >
          {t("Reset")}
        </Button>
      </form>
      {filterError && <p role="alert">{filterError}</p>}
      {result === undefined ? (
        <p role="status">
          <I18nText text="Loading…" />
        </p>
      ) : (
        <section className="admin-card p-5 space-y-4">
          {!result.page.length && (
            <p>
              <I18nText text="No matching audit entries." />
            </p>
          )}
          {result.page.map((entry) => (
            <article key={entry._id} className="border-b border-zinc-700 pb-3">
              <p>
                {new Date(entry.createdAt).toLocaleString(getLocale())} ·{" "}
                {entry.action} · {t(entry.outcome || "Recorded")}
              </p>
              <p>
                {t("Actor")}:{" "}
                {entry.actorUserId || entry.actorType || "operator"} ·{" "}
                {t("Target")}: {entry.targetId || "—"}
              </p>
              {entry.reason && <p>{entry.reason}</p>}
              {entry.requestId && (
                <p>
                  {t("Request ID")}: {entry.requestId}
                </p>
              )}
              {(entry.before || entry.after || entry.meta) && (
                <details>
                  <summary>{t("Details")}</summary>
                  <pre className="whitespace-pre-wrap break-all">
                    {JSON.stringify(
                      {
                        before: entry.before && JSON.parse(entry.before),
                        after: entry.after && JSON.parse(entry.after),
                        metadata: entry.meta && JSON.parse(entry.meta),
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              )}
            </article>
          ))}
        </section>
      )}
      <div className="flex gap-3">
        <Button
          variant="outline"
          disabled={!cursor}
          onClick={() => setCursor(null)}
        >
          {t("First page")}
        </Button>
        <Button
          variant="outline"
          disabled={!result || result.isDone}
          onClick={() => setCursor(result!.continueCursor)}
        >
          {t("Next page")}
        </Button>
      </div>
    </>
  );
}
