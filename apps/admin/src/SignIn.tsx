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
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 px-4">
      <h1 className="text-2xl font-semibold">Cinakey Admin</h1>
      <p className="text-sm text-zinc-400">
        Sign in with your existing account. Platform administrator access is
        required.
      </p>
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
            <p className="text-sm">Code sent to {challenge.email}</p>
            <Label htmlFor="code">Verification code</Label>
            <Input
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
    </main>
  );
}
