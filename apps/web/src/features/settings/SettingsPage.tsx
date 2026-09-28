import { api } from "@cinakey/backend";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsPage() {
  const me = useQuery(api.users.viewer);
  const ledger = useQuery(api.credits.listLedger, { limit: 50 });
  const updateProfile = useMutation(api.users.updateProfile);
  const deleteAccount = useMutation(api.users.deleteAccount);
  const { signOut } = useAuthActions();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  useEffect(() => {
    if (me) {
      setName(me.name ?? "");
      setEmailEnabled(me.notificationEmailEnabled !== false);
    }
  }, [me]);

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
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Profile, notifications, credits, and account.
        </p>
      </div>

      <form className="space-y-4" onSubmit={(e) => void saveProfile(e)}>
        <h2 className="text-sm font-semibold text-zinc-200">Profile</h2>
        <div className="space-y-2">
          <Label htmlFor="settings-name">Display name</Label>
          <Input
            id="settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <p className="text-xs text-zinc-500">
          Email: {me.email ?? "—"} (managed by sign-in)
        </p>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={emailEnabled}
            onChange={(e) => setEmailEnabled(e.target.checked)}
          />
          Email me when jobs or exports finish or fail
        </label>
        <Button type="submit" disabled={busy}>
          Save
        </Button>
        {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </form>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-200">Credit history</h2>
        {ledger === undefined ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : ledger.length === 0 ? (
          <p className="text-sm text-zinc-500">No ledger entries yet.</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-auto text-xs text-zinc-500">
            {ledger.map((row) => (
              <li key={row._id}>
                {new Date(row.createdAt).toLocaleString()} · {row.reason} ·{" "}
                {row.delta > 0 ? "+" : ""}
                {row.delta} → {row.balanceAfter}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 border border-red-900/40 p-4">
        <h2 className="text-sm font-semibold text-red-300">Delete account</h2>
        <p className="text-xs text-zinc-500">
          Permanently deletes your projects, assets, and workspace data. Type
          DELETE to confirm.
        </p>
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
          Delete my account
        </Button>
      </section>
    </div>
  );
}
