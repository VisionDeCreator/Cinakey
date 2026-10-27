import { randomBytes, randomInt } from "node:crypto";
import { ConvexError } from "convex/values";
import { internal } from "../operations";
import type { ActionCtx } from "../runtime/operation";
import {
  authDigest,
  normalizeAuthEmail,
} from "../../../../packages/backend/convex/lib/authEmail";
import { sendSmtpEmail, smtpConfiguration } from "./smtp";

/** Forwarded addresses are trusted only behind explicitly configured proxy peers. */
export function authClientAddress(request: Request, peer: string): string {
  const trusted = new Set(
    (process.env.AUTH_TRUSTED_PROXY_IPS ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
  if (!trusted.has(peer)) return peer;
  const chain = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((x) => x.trim());
  if (!chain.length || chain.some((x) => !x || !/^[0-9a-f:.]+$/i.test(x)))
    return peer;
  return chain.reverse().find((x) => !trusted.has(x)) ?? peer;
}

export async function requestEmailOtp(
  ctx: ActionCtx,
  rawEmail: unknown,
  address: string,
): Promise<Response> {
  let email: string;
  try {
    email = normalizeAuthEmail(rawEmail);
  } catch {
    return Response.json(
      { message: "Enter a valid email address." },
      { status: 400 },
    );
  }
  try {
    if (!smtpConfiguration()) throw new Error("SMTP unavailable");
    const challenge = randomBytes(32).toString("hex");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const { id, expiresAt } = await ctx.runMutation(internal.authOtp.issue, {
      email,
      challengeHash: await authDigest(challenge),
      codeHash: await authDigest(`${challenge}:${email}:${code}`),
      ipHash: await authDigest(address),
    });
    const result = await sendSmtpEmail({
      to: email,
      subject: "Your Cinakey sign-in code",
      text: `Your Cinakey sign-in code is ${code}.\n\nIt expires in 10 minutes and can only be used once. Enter it in the browser tab where you requested it.\n\nIf you did not request this code, you can ignore this email. Never share your code with anyone.`,
      idempotencyKey: `login:${id}`,
    });
    if (!result.sent) throw new Error("SMTP unavailable");
    await ctx.runMutation(internal.authOtp.delivered, { id });
    return Response.json(
      { challenge, email, expiresAt, resendAt: Date.now() + 60_000 },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const data = error instanceof ConvexError ? error.data : null;
    if (
      (data &&
        typeof data === "object" &&
        "code" in data &&
        data.code === "OTP_RATE_LIMIT") ||
      (error instanceof Error && /Rate limit exceeded/.test(error.message))
    ) {
      const retryAfter =
        data && typeof data === "object" && "retryAfterSeconds" in data
          ? Number(data.retryAfterSeconds)
          : 3600;
      return Response.json(
        {
          message: "Please wait before requesting another code.",
          retryAfterSeconds: retryAfter,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "Cache-Control": "no-store",
          },
        },
      );
    }
    // No delivery errors, account existence, codes or SMTP details reach the client/logs.
    return Response.json(
      {
        message: "We couldn’t send a code. Please try again shortly.",
        retryAfterSeconds: 60,
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "60" },
      },
    );
  }
}
