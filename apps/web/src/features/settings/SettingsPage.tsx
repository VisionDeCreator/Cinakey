import { I18nText, LanguageSelector, t, useLocale } from "@cinakey/ui/i18n";
import { EmailVerification } from "./EmailVerification";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { api } from "@cinakey/backend";
import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export function SettingsPage() {
  useLocale();
  const me = useQuery(api.users.viewer);
  const updateProfile = useMutation(api.users.updateProfile);
  const deleteAccount = useMutation(api.users.deleteAccount);
  const { signOut } = useAuthActions();
  const navigate = useNavigate();
  const { workspaceId, workspaces, canManage } = useWorkspace();
  const workspace = workspaces.find(
    (row) => row.workspace._id === workspaceId,
  )?.workspace;

  const [draft, setDraft] = useState<{
    userId: string;
    name: string;
    emailEnabled: boolean;
  } | null>(null);
  const name =
    draft && draft.userId === me?._id ? draft.name : (me?.name ?? "");
  const emailEnabled =
    draft && draft.userId === me?._id
      ? draft.emailEnabled
      : me?.notificationEmailEnabled !== false;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  if (me === undefined) {
    return (
      <p className="text-sm text-zinc-500">
        <I18nText text="Loading settings…" />
      </p>
    );
  }
  if (me === null) {
    return (
      <p className="text-sm text-red-400">
        <I18nText text="Not signed in." />
      </p>
    );
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateProfile({
        name: name.trim(),
        notificationEmailEnabled: emailEnabled,
      });
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (busy || deleteConfirm !== "DELETE") return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount({ confirm: deleteConfirm });
      await signOut();
      void navigate("/sign-in");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(false);
    }
  }

  const panel =
    "space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6";
  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          <I18nText text="Settings" />
        </h1>
        <p className="mt-2 text-sm text-zinc-400 sm:text-base">
          <I18nText text="Manage your profile, notifications and account." />
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <form
          id="account-profile"
          className={panel}
          onSubmit={(e) => void saveProfile(e)}
        >
          <h2 className="text-xl font-semibold">
            <I18nText text="Profile" />
          </h2>
          <div className="flex items-center gap-4 border-b border-zinc-800 pb-4">
            <Avatar className="size-14">
              <AvatarImage src={me.image} alt="" />
              <AvatarFallback className="bg-[var(--color-studio-accent-soft)] text-xl text-[var(--color-studio-accent)]">
                {(me.name || me.email || "A").slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-medium">
                <I18nText text="Your account" />
              </p>
              <p className="mt-1 break-all text-sm text-zinc-400">{me.email}</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-name">
              <I18nText text="Display name" />
            </Label>
            <Input
              id="settings-name"
              required
              placeholder={t("Enter your display name")}
              maxLength={200}
              value={name}
              disabled={busy}
              onChange={(e) =>
                setDraft({ userId: me._id, name: e.target.value, emailEnabled })
              }
            />
            <p className="text-xs text-zinc-400">
              <I18nText text="This name appears across your workspace." />
            </p>
          </div>
          {message && (
            <p role="status" className="text-sm text-emerald-400">
              {t(message ?? "")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {t(error ?? "")}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? t("Saving…") : t("Save changes")}
            </Button>
          </div>
        </form>
        <EmailVerification />
        <section
          className={`${panel} lg:col-span-2`}
          aria-labelledby="language-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <h2 id="language-heading" className="text-xl font-semibold">
                <I18nText text="Language" />
              </h2>
              <p className="text-sm text-zinc-400">
                <I18nText text="Choose the language used in this browser." />
              </p>
            </div>
            <LanguageSelector className="w-full sm:w-48" />
          </div>
        </section>
        <section className={panel}>
          <h2 className="text-xl font-semibold">
            <I18nText text="Notifications" />
          </h2>
          <p className="text-sm text-zinc-400">
            <I18nText text="Choose which updates arrive by email." />
          </p>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-[var(--color-studio-accent)]"
              checked={emailEnabled}
              disabled={busy}
              onChange={(e) =>
                setDraft({
                  userId: me._id,
                  name,
                  emailEnabled: e.target.checked,
                })
              }
            />
            <span>
              <span className="block text-sm font-medium">
                <I18nText text="Job and export alerts" />
              </span>
              <span className="mt-1 block text-xs text-zinc-400">
                <I18nText text="Get an email when generation jobs and exports finish." />
              </span>
            </span>
          </label>
          <p className="text-xs text-zinc-400">
            <I18nText text="Saved with your profile." />
          </p>
        </section>
        <section className={panel}>
          <h2 className="text-xl font-semibold">
            <I18nText text="Workspace management" />
          </h2>
          <p className="font-medium">
            {workspace?.name ?? t("Your workspace")}
          </p>
          <p className="text-sm text-zinc-400">
            {canManage
              ? t(
                  "Manage team access, seats, funding and spending limits in Billing.",
                )
              : t(
                  "Your workspace owner manages team access, seats and billing.",
                )}
          </p>
          <div className="flex flex-wrap gap-3">
            {canManage && (
              <Button variant="outline" asChild>
                <Link to="/billing#members">
                  <I18nText text="Manage team" />
                  <ArrowRight />
                </Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/billing">
                <I18nText text="Open billing" />
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </section>
      </div>
      <section className="space-y-3 rounded-2xl border border-red-900/40 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">
          <I18nText text="Delete account" />
        </h2>
        <p className="text-sm text-zinc-400">
          <I18nText text="Permanently delete your account. This action cannot be undone." />
        </p>
        <Label htmlFor="delete-account-confirm">
          <I18nText text="Type DELETE to confirm" />
        </Label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="delete-account-confirm"
            className="min-w-40 flex-1 bg-transparent"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder="DELETE"
            disabled={busy}
          />
          <Button
            type="button"
            variant="destructive"
            disabled={busy || deleteConfirm !== "DELETE"}
            onClick={() => void onDelete()}
          >
            <I18nText text="Delete account" />
          </Button>
        </div>
      </section>
    </div>
  );
}
