import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { api } from "@cinakey/backend";
import { useAction, useQuery } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EmailVerification() {
  const me = useQuery(api.users.viewer);
  const send = useAction(api.teamOnboarding.startVerification);
  const verify = useAction(api.teamOnboarding.verifyEmail);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (!me?.email) return null;
  if (me.emailVerificationTime !== undefined)
    return (
      <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Email verification</h2>
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-800 px-3 py-1.5 text-sm text-emerald-400">
          <CheckCircle2 className="size-4" />
          Verified
        </span>
        <p className="break-all text-sm">{me.email}</p>
        <p className="text-sm text-zinc-400">
          Your email is verified and ready to receive account updates.
        </p>
      </section>
    );
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
      <h2 className="text-sm font-semibold">Verify your email</h2>
      <p className="text-xs text-zinc-400">
        Verify {me.email} to accept team invitations. We’ll send a six-digit
        code that expires in ten minutes.
      </p>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          void run(() => send({}), "Verification code sent. Check your email.")
        }
      >
        Send verification code
      </Button>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () => verify({ code }),
            "Email verified. You can now accept invitations.",
          );
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="email-verification-code">Verification code</Label>
          <Input
            id="email-verification-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            maxLength={6}
            disabled={busy}
          />
        </div>
        <Button type="submit" disabled={busy || code.length !== 6}>
          Verify email
        </Button>
      </form>
      {message && (
        <p role="status" className="text-sm text-emerald-400">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
