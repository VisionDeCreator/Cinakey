import { EmailVerification } from "./EmailVerification";
import { TeamSettings } from "./TeamSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { api } from "@cinakey/backend";
import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export function SettingsPage() {
  const me = useQuery(api.users.viewer);
  const updateProfile = useMutation(api.users.updateProfile);
  const deleteAccount = useMutation(api.users.deleteAccount);
  const { signOut } = useAuthActions();
  const navigate = useNavigate();

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
    return <p className="text-sm text-zinc-500">Loading settings…</p>;
  }
  if (me === null) {
    return <p className="text-sm text-red-400">Not signed in.</p>;
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
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

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <form className="space-y-4" onSubmit={(e) => void saveProfile(e)}>
        <h2 className="text-sm font-semibold text-zinc-200">Profile</h2>
        <div className="space-y-2">
          <Label htmlFor="settings-name">Display name</Label>
          <Input
            id="settings-name"
            value={name}
            onChange={(e) =>
              setDraft({ userId: me._id, name: e.target.value, emailEnabled })
            }
          />
        </div>
        <p className="text-xs text-zinc-500">Email: {me.email ?? "—"}</p>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={emailEnabled}
            onChange={(e) =>
              setDraft({ userId: me._id, name, emailEnabled: e.target.checked })
            }
          />
          Email job and export alerts
        </label>
        <Button type="submit" disabled={busy}>
          Save
        </Button>
        {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </form>

      <EmailVerification />
      <TeamSettings />
      <section className="space-y-2 rounded-lg border border-zinc-800 p-4">
        <h2 className="text-sm font-semibold">Workspace billing</h2>
        <p className="text-sm text-zinc-400">
          Manage your subscription, invoices, paid seats, usage balance and
          spending limits.
        </p>
        <Link to="/billing" className="inline-block text-sm underline">
          Open billing
        </Link>
      </section>

      <section className="space-y-3 border border-red-900/40 p-4">
        <h2 className="text-sm font-semibold text-red-300">Delete account</h2>
        <p className="text-xs text-zinc-500">Type DELETE to confirm.</p>
        <Input
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder="DELETE"
        />
        <Button
          type="button"
          variant="destructive"
          disabled={busy || deleteConfirm !== "DELETE"}
          onClick={() => void onDelete()}
        >
          Delete account
        </Button>
      </section>
    </div>
  );
}
