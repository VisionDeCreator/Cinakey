export type EmailChallenge = {
  email: string;
  challenge: string;
  expiresAt: number;
  resendAt: number;
};
const storageKey = "dirrio.email-login.v1";
export function restoreChallenge(): EmailChallenge | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    return c &&
      typeof c.email === "string" &&
      /^[a-f0-9]{64}$/.test(c.challenge) &&
      Number.isFinite(c.expiresAt) &&
      Number.isFinite(c.resendAt) &&
      c.expiresAt > Date.now()
      ? c
      : null;
  } catch {
    return null;
  }
}
export function persistChallenge(c: EmailChallenge | null) {
  try {
    if (c) sessionStorage.setItem(storageKey, JSON.stringify(c));
    else sessionStorage.removeItem(storageKey);
  } catch {
    /* Login still works without browser storage. */
  }
}
export class OtpRequestError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds = 0,
  ) {
    super(message);
  }
}
export async function requestEmailCode(
  email: string,
  signal: AbortSignal,
): Promise<EmailChallenge> {
  const base = (
    import.meta.env.VITE_API_URL ?? "http://localhost:3001"
  ).replace(/\/$/, "");
  const r = await fetch(`${base}/auth/email/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
    signal,
    cache: "no-store",
  });
  let body;
  try {
    body = await r.json();
  } catch {
    throw new OtpRequestError(
      "We couldn’t send a code. Please try again shortly.",
    );
  }
  if (!r.ok)
    throw new OtpRequestError(
      r.status === 429
        ? "Please wait before requesting another code."
        : "We couldn’t send a code. Check your email address and try again shortly.",
      Math.max(0, Math.min(3600, Number(body.retryAfterSeconds) || 0)),
    );
  if (
    typeof body.email !== "string" ||
    typeof body.challenge !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.challenge) ||
    !Number.isFinite(body.expiresAt) ||
    !Number.isFinite(body.resendAt)
  )
    throw new OtpRequestError(
      "We couldn’t send a code. Please try again shortly.",
    );
  return body;
}
