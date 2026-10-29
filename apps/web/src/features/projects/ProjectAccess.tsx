import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Doc } from "@dirrio/backend";
import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";

export function ProjectAccess({ project }: { project: Doc<"projects"> }) {
  useLocale();
  const members = useQuery(api.teams.projectAccess, { projectId: project._id });
  const assign = useMutation(api.teams.assign);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="space-y-4" aria-label={t("Project access")}>
      <p className="text-sm text-zinc-400">
        <I18nText text="Give existing team members access to this project. Workspace roles and series access are managed separately." />
      </p>
      {members === undefined ? (
        <p role="status">
          <I18nText text="Loading team…" />
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">
                  {member.name || member.email || member.userId}
                </p>
                {member.name && (
                  <p className="break-all text-xs text-zinc-400">
                    {member.email}
                  </p>
                )}
                <p className="text-xs text-zinc-400">
                  {t(member.role)}
                  {member.inherited ? ` · ${t("Access through series")}` : ""}
                </p>
              </div>
              {member.automatic ? (
                <span className="text-xs text-zinc-400">
                  <I18nText text="Automatic access" />
                </span>
              ) : member.role === "creator" ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-studio-accent)]"
                    checked={member.direct}
                    disabled={busy}
                    aria-label={t("Direct project access for {0}", {
                      0: member.name || member.email || member.userId,
                    })}
                    onChange={async (event) => {
                      const enabled = event.target.checked;
                      setBusy(true);
                      setError("");
                      try {
                        await assign({
                          workspaceId: project.workspaceId,
                          projectId: project._id,
                          userId: member.userId,
                          enabled,
                        });
                      } catch (error) {
                        setError(
                          error instanceof Error
                            ? error.message
                            : "Could not update project access.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                  <I18nText text="Direct project access" />
                </label>
              ) : (
                <span className="text-xs text-zinc-500">
                  <I18nText text="No production access" />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {t(error)}
        </p>
      )}
      <Button variant="outline" asChild>
        <Link to="/billing#members">
          <I18nText text="Manage workspace team" />
        </Link>
      </Button>
    </section>
  );
}
