import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { I18nText, t, useLocale } from "@dirrio/ui/i18n";

type Props = {
  userId?: string;
  workspaceId?: string;
  expiresAt?: number | null;
  status?: "active" | "expired" | null;
  isOwner: boolean;
};
type Dismissal = { stage: string; until: number };
const HOUR = 3600_000;
function readDismissal(key: string): Dismissal | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "stage" in value &&
      "until" in value &&
      typeof value.stage === "string" &&
      typeof value.until === "number" &&
      Number.isFinite(value.until)
    )
      return { stage: value.stage, until: value.until };
  } catch {
    /* Reminders also work when browser storage is unavailable. */
  }
  return null;
}
export function WorkspaceTrialNotice(props: Props) {
  if (!props.userId || !props.workspaceId || !props.expiresAt || !props.status)
    return null;
  return (
    <TrialNotice
      key={`${props.userId}:${props.workspaceId}:${props.expiresAt}`}
      {...props}
    />
  );
}
function TrialNotice({
  userId,
  workspaceId,
  expiresAt,
  status,
  isOwner,
}: Props) {
  const locale = useLocale();
  const key = `dirrio.trial-reminder:${userId}:${workspaceId}:${expiresAt}`;
  const [now, setNow] = useState(Date.now);
  const [dismissal, setDismissal] = useState(() => readDismissal(key));
  const end = expiresAt!;
  const expired = status === "expired" || now >= end;
  const stage = expired
    ? "expired"
    : end - now <= 48 * HOUR
      ? "ending"
      : "active";
  const hidden = dismissal?.stage === stage && dismissal.until > now;
  const date = new Date(end).toLocaleString(locale);
  useEffect(() => {
    const nextStage =
      now < end - 48 * HOUR ? end - 48 * HOUR : now < end ? end : Infinity;
    const nextReminder = hidden ? dismissal!.until : Infinity;
    const next = Math.min(nextStage, nextReminder);
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(1, Math.min(next - Date.now(), 2_000_000_000)),
    );
    return () => window.clearTimeout(timer);
  }, [now, end, hidden, dismissal]);
  useEffect(() => {
    const sync = () => {
      setNow(Date.now());
      setDismissal(readDismissal(key));
    };
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) sync();
    };
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [key]);
  function dismiss() {
    const value = {
      stage,
      until: Date.now() + (stage === "ending" ? 12 : 24) * HOUR,
    };
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Keep the in-memory dismissal. */
    }
    setNow(Date.now());
    setDismissal(value);
  }
  const billing = `/billing/${workspaceId}`;
  return (
    <section
      aria-label={t("Workspace trial")}
      className="border-b border-amber-800 bg-amber-950 px-4 py-3 text-sm text-amber-100"
    >
      {hidden ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {expired ? t("Trial ended") : t("Trial ends {date}", { date })}
          </span>
          <button
            type="button"
            className="underline"
            onClick={() => {
              setDismissal(null);
              try {
                localStorage.removeItem(key);
              } catch {
                /* Optional storage. */
              }
            }}
          >
            <I18nText text="Show trial details" />
          </button>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div role="status" className="min-w-0 space-y-2">
            <p className="font-semibold">
              {expired
                ? t("Your free trial has ended")
                : stage === "ending"
                  ? t("Your free trial ends soon")
                  : t("Your free trial is active")}
            </p>
            <p>
              {expired
                ? t(
                    "Purchased credits do not expire. While a balance remains, you can create projects, edit scripts, upload image/video references and generate videos. A subscription is required for timeline editing, staging, series, collaboration, sharing and more credits. When your purchased balance reaches zero, creation, script editing, uploads and generation pause. Viewing, downloads and existing exports remain available.",
                  )
                : t(
                    "Your trial ends {date}. AI generation credits are paid separately. There is no automatic subscription charge.",
                    { date },
                  )}
            </p>
            {expired && (
              <p>
                <I18nText text="Your projects and media are retained indefinitely for now, unless you delete them." />
              </p>
            )}
            {isOwner ? (
              <Link className="inline-block font-medium underline" to={billing}>
                {expired
                  ? t("Unlock the full workspace")
                  : t("View subscription options")}
              </Link>
            ) : (
              <p>
                <I18nText text="Ask the workspace owner to subscribe." />
              </p>
            )}
          </div>
          <button
            type="button"
            className="shrink-0 rounded p-2 hover:bg-amber-900 focus-visible:outline focus-visible:outline-2"
            aria-label={t("Dismiss trial reminder")}
            onClick={dismiss}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
