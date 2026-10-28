import { Clapperboard, ShieldCheck, Mail, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "@cinakey/api-client";
import {
  requestEmailCode,
  restoreChallenge,
  persistChallenge,
  OtpRequestError,
} from "@cinakey/api-client/email-otp";
import { authErrorMessage } from "@cinakey/api-client/auth-errors";
import { Navigate, useSearchParams } from "react-router-dom";
import { Button } from "@cinakey/ui/button";
import { Input } from "@cinakey/ui/input";
import { Label } from "@cinakey/ui/label";
import { adminDestination } from "./routing";
export function SignIn() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [params] = useSearchParams();
  const [challenge, setChallenge] = useState(restoreChallenge);
  const [email, setEmail] = useState(challenge?.email ?? "");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const [retryAt, setRetryAt] = useState(challenge?.resendAt ?? 0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000));
  if (!isLoading && isAuthenticated)
    return <Navigate to={adminDestination(params.get("next"))} replace />;
  return (
    <main className="admin-auth-page">
      <div className="admin-auth-brand"><Clapperboard size={34} /><div>Cinakey<small>ADMIN</small></div></div>
      <section className="admin-auth-card">
      <header><span className="admin-auth-symbol">{challenge ? <Mail size={30} /> : <ShieldCheck size={30} />}</span><h1>{challenge ? "Check your email" : "Admin sign in"}</h1><p>{challenge ? <>Enter the 6-digit code sent to <strong>{challenge.email}</strong></> : "Use your existing account to access Cinakey administration."}</p></header>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setPending(true);
          setError("");
          void (async () => {
            try {
              if (!challenge) {
                const result = await requestEmailCode(
                  email.trim().toLowerCase(),
                  new AbortController().signal,
                );
                setChallenge(result);
                persistChallenge(result);
                setRetryAt(result.resendAt);
                setNow(Date.now());
              } else {
                const result = await signIn("email-otp", {
                  email: challenge.email,
                  challenge: challenge.challenge,
                  code,
                });
                if (!result.signingIn) throw new Error("Sign-in incomplete");
                persistChallenge(null);
              }
            } catch (error) {
              setError(
                error instanceof OtpRequestError
                  ? error.message
                  : authErrorMessage(error),
              );
              if (error instanceof OtpRequestError) {
                setRetryAt(Date.now() + error.retryAfterSeconds * 1000);
                setNow(Date.now());
              }
            } finally {
              setPending(false);
            }
          })();
        }}
      >
        {!challenge ? (
          <>
            <Label htmlFor="email">Email</Label>
            <Input
              placeholder="name@example.com"
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              required
              disabled={pending}
            />
          </>
        ) : (
          <>
            <Label htmlFor="code">Verification code</Label>
            <Input
              className="admin-auth-code"
              placeholder="000000"
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              required
              disabled={pending || challenge.expiresAt <= now}
            />
            {challenge.expiresAt <= now && (
              <p role="alert">Code expired. Request a new code.</p>
            )}
          </>
        )}
        <Button
          disabled={
            pending ||
            isLoading ||
            (!challenge && wait > 0) ||
            (!!challenge && (code.length !== 6 || challenge.expiresAt <= now))
          }
        >
          {pending
            ? "Working…"
            : challenge
              ? "Verify and sign in"
              : wait
                ? `Try again in ${wait}s`
                : "Send sign-in code"}
          {!pending && !challenge && !wait && <ArrowRight size={18} />}
        </Button>
        {challenge && (
          <Button
            type="button"
            variant="outline"
            disabled={pending || wait > 0}
            onClick={() => {
              persistChallenge(null);
              setChallenge(null);
              setCode("");
            }}
          >
            {wait
              ? `Request new code in ${wait}s`
              : "Change email / request new code"}
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
      </form>
      <p className="admin-auth-access"><ShieldCheck size={17} />Platform administrator access required.</p>
      </section>
      <p className="admin-auth-footer">Cinakey administration</p>
    </main>
  );
}
