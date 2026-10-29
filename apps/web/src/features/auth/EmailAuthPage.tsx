import { useRegistrationPolicy } from "./useRegistrationPolicy";
import { I18nText, LanguageSelector, t, useLocale } from "@cinakey/ui/i18n";
import { useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authDestination, authErrorMessage } from "./auth-errors";
import {
  OtpRequestError,
  persistChallenge,
  requestEmailCode,
  restoreChallenge,
} from "./email-otp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function EmailAuthPage({ mode }: { mode: "signIn" | "signUp" }) {
  useLocale();
  const requireApproval = useRegistrationPolicy();
  const { signIn } = useAuthActions();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const destination = authDestination(params.get("next"));
  const [challenge, setChallenge] = useState(restoreChallenge);
  const [email, setEmail] = useState(challenge?.email ?? "");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [retryAt, setRetryAt] = useState(challenge?.resendAt ?? 0);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const wait = Math.max(0, Math.ceil((retryAt - clock) / 1000));
  const expired = challenge !== null && challenge.expiresAt <= clock;
  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    if (pending || wait > 0) return;
    setPending(true);
    setError("");
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const c = await requestEmailCode(
        (challenge?.email ?? email).trim().toLowerCase(),
        controller.signal,
      );
      if (!mounted.current) return;
      setChallenge(c);
      persistChallenge(c);
      setCode("");
      setRetryAt(c.resendAt);
      setClock(Date.now());
    } catch (e) {
      if (!mounted.current) return;
      setError(
        e instanceof OtpRequestError
          ? e.message
          : "We couldn’t send a code. Please try again shortly.",
      );
      if (e instanceof OtpRequestError && e.retryAfterSeconds) {
        setRetryAt(Date.now() + e.retryAfterSeconds * 1000);
        setClock(Date.now());
      }
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!challenge || pending || expired) return;
    setPending(true);
    setError("");
    try {
      const result = await signIn("email-otp", {
        email: challenge.email,
        challenge: challenge.challenge,
        code,
      });
      if (!result.signingIn) throw new Error("Sign-in incomplete");
      persistChallenge(null);
      if (mounted.current) void navigate(destination);
    } catch (e) {
      if (mounted.current) setError(authErrorMessage(e));
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  async function google() {
    setError("");
    setPending(true);
    try {
      await signIn("google", { redirectTo: destination });
    } catch {
      if (mounted.current) {
        setError("Google sign-in could not be completed. Please try again.");
        setPending(false);
      }
    }
  }
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {challenge
              ? t("Check your email")
              : mode === "signUp"
                ? t("Create your account")
                : t("Sign in to Cinakey")}
          </h1>
          <p className="text-sm text-zinc-400">
            {challenge
              ? t("Enter the six-digit code sent to {0}.", {
                  0: challenge.email,
                })
              : t(
                  "Use your email to sign in or create an account. No password needed.",
                )}
          </p>
        </header>
        {requireApproval && (
          <p className="mb-4 text-sm">
            <Link to="/#early-access">
              {t("Waitlist approval is required for new accounts.")}
            </Link>
          </p>
        )}
        {!challenge ? (
          <form className="space-y-4" onSubmit={(e) => void sendCode(e)}>
            <div className="space-y-2">
              <Label htmlFor="email">
                <I18nText text="Email" />
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                disabled={pending}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={pending || wait > 0}
            >
              {pending
                ? t("Sending code…")
                : wait > 0
                  ? t("Try again in {0}s", { 0: wait })
                  : t("Continue with email")}
            </Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={(e) => void verify(e)}>
            <div className="space-y-2">
              <Label htmlFor="login-code">
                <I18nText text="Verification code" />
              </Label>
              <Input
                id="login-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                disabled={pending || expired}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
            </div>
            <p className="text-xs text-zinc-500">
              {expired
                ? t("This code has expired. Request a new code below.")
                : t(
                    "Codes expire after 10 minutes and work only once. Use the latest code in this browser tab.",
                  )}
            </p>
            <Button
              type="submit"
              className="w-full"
              disabled={pending || expired || code.length !== 6}
            >
              {pending ? t("Signing in…") : t("Verify and continue")}
            </Button>
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending || wait > 0}
                onClick={() => void sendCode()}
              >
                {wait > 0 ? t("Resend in {0}s", { 0: wait }) : t("Resend code")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  persistChallenge(null);
                  setChallenge(null);
                  setCode("");
                  setError("");
                  setRetryAt(0);
                }}
              >
                <I18nText text="Change email" />
              </Button>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {t(error ?? "")}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-zinc-500">
            <I18nText text="or" />
          </span>
          <Separator className="flex-1" />
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending}
          onClick={() => void google()}
        >
          <I18nText text="Continue with Google" />
        </Button>
        <p className="text-center text-sm text-zinc-400">
          {mode === "signIn"
            ? t("New to Cinakey?")
            : t("Already have an account?")}{" "}
          <Link
            className="text-zinc-100 underline"
            to={`/${mode === "signIn" ? "sign-up" : "sign-in"}?next=${encodeURIComponent(destination)}`}
          >
            {mode === "signIn" ? t("Sign up") : t("Sign in")}
          </Link>
        </p>
        <div className="flex justify-center border-t border-zinc-800 pt-5">
          <LanguageSelector className="h-9 border-transparent bg-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-100" />
        </div>
      </div>
    </div>
  );
}
