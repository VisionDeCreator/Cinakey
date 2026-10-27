import { formatUsd, parseUsdToMicros } from "@cinakey/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { api } from "@cinakey/backend";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * Staff-only /dev hub: grant usdMicros by email + links to other tools.
 */
export function DevHomePage() {
  const fundingRequest = useRef<string | null>(null);
  const me = useQuery(api.users.viewer);
  const grantToEmail = useMutation(api.billing.grantToEmail);

  const [emailDraft, setEmail] = useState<string>();
  const email = emailDraft ?? me?.email ?? "";
  const [amount, setAmount] = useState("10.00");
  const [lookupDraft, setLookupEmail] = useState<string>();
  const lookupEmail = lookupDraft ?? me?.email ?? "";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = useQuery(
    api.billing.lookupByEmail,
    me?.isStaff === true && lookupEmail.includes("@")
      ? { email: lookupEmail }
      : "skip",
  );

  if (me === undefined) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }

  if (me === null || me.isStaff !== true) {
    return (
      <div className="mx-auto max-w-lg space-y-3 border border-dashed border-zinc-700 px-6 py-10 text-center">
        <h1 className="text-lg font-semibold text-zinc-100">Dev tools</h1>
        <p className="text-sm text-zinc-500">
          Staff access required. Set{" "}
          <code className="text-zinc-400">isStaff: true</code> on your user in
          the Convex dashboard to unlock this page.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/projects">Back to projects</Link>
        </Button>
      </div>
    );
  }

  const onGrant = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await grantToEmail({
        email: email.trim(),
        amount: parseUsdToMicros(amount),
        requestId: (fundingRequest.current ??= crypto.randomUUID()),
      });
      fundingRequest.current = null;
      setMessage(
        `Granted ${amount} USD to ${result.email}. Balance is now ${formatUsd(result.balanceAfter)}.`,
      );
      setLookupEmail(email.trim());
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8">
      <div>
        <p className="text-xs uppercase tracking-wider text-zinc-500">Admin</p>
        <h1 className="text-xl font-semibold text-zinc-100">Dev tools</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Grant USD and open local test pages. Staff only.
        </p>
      </div>

      <section className="space-y-4 border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-200">Grant USD</h2>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="grant-email">User email</Label>
            <Input
              id="grant-email"
              type="email"
              autoComplete="off"
              placeholder="creator@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setLookupEmail(e.target.value.trim());
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grant-amount">Amount</Label>
            <Input
              id="grant-amount"
              type="text"
              inputMode="decimal"
              min={1}
              className="w-32"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          {lookupEmail.includes("@") ? (
            <div className="rounded-sm bg-zinc-900/80 px-3 py-2 text-xs text-zinc-400">
              {lookup === undefined ? (
                <p>Looking up…</p>
              ) : lookup === null ? (
                <p>No user found for that email yet.</p>
              ) : (
                <p>
                  {lookup.email}
                  {lookup.name ? ` (${lookup.name})` : ""} · balance{" "}
                  <span className="text-zinc-200">
                    {formatUsd(lookup.balance)}
                  </span>
                  {!lookup.hasWorkspace ? " · no workspace yet" : ""}
                </p>
              )}
            </div>
          ) : null}

          <Button
            type="button"
            size="sm"
            disabled={busy || !email.includes("@") || !amount.trim()}
            onClick={() => void onGrant()}
          >
            {busy ? "Granting…" : "Grant USD"}
          </Button>

          {message ? (
            <p className="text-sm text-emerald-400">{message}</p>
          ) : null}
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-200">Other tools</h2>
        <ul className="space-y-1 text-sm">
          <li>
            <Link
              className="text-zinc-400 underline-offset-2 hover:text-zinc-100 hover:underline"
              to="/dev/generation"
            >
              Generation test
            </Link>
          </li>
          <li>
            <Link
              className="text-zinc-400 underline-offset-2 hover:text-zinc-100 hover:underline"
              to="/dev/upload"
            >
              Upload test
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}

function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/no user found/i.test(raw)) {
    return "No account exists for that email. Ask them to sign up first.";
  }
  if (/staff access/i.test(raw)) {
    return "Staff access required.";
  }
  if (/positive number/i.test(raw)) {
    return "Enter a positive USD amount.";
  }
  // Strip Convex request wrappers.
  const match = raw.match(/Uncaught Error:\s*(.+?)(?:\s+at\s|$)/i);
  if (match?.[1]) return match[1].trim();
  if (raw.length > 160) return "Something went wrong. Check the Convex logs.";
  return raw;
}
