import { expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { ConvexError } from "convex/values";
import { authClientAddress, requestEmailOtp } from "./authOtp";
import type { ActionCtx } from "../runtime/operation";
function configured() {
  for (const [key, value] of Object.entries({
    EMAIL_NOTIFICATIONS_ENABLED: "true",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "fixture",
    SMTP_PASSWORD: "fixture",
    SMTP_FROM_EMAIL: "hello@example.com",
  }))
    vi.stubEnv(key, value);
}
function context() {
  const runMutation = vi
    .fn()
    .mockResolvedValueOnce({
      id: "challenge-id",
      expiresAt: Date.now() + 600_000,
    })
    .mockResolvedValue(null);
  return { runMutation, ctx: { runMutation } as unknown as ActionCtx };
}
it("sends the code through Nodemailer; returns only a challenge and stores hashes", async () => {
  configured();
  const sendMail = vi
    .fn()
    .mockResolvedValue({ accepted: ["person@example.com"], rejected: [] });
  vi.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: vi.fn(),
  } as never);
  const { ctx, runMutation } = context();
  const response = await requestEmailOtp(
    ctx,
    " Person@Example.com ",
    "127.0.0.1",
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json();
  expect(body.email).toBe("person@example.com");
  expect(body.challenge).toMatch(/^[a-f0-9]{64}$/);
  expect(body.code).toBeUndefined();
  expect(sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      to: { address: "person@example.com", name: "" },
      text: expect.stringMatching(/code is \d{6}/),
    }),
  );
  expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
    challengeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    codeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(JSON.stringify(runMutation.mock.calls)).not.toContain(body.challenge);
  expect(runMutation).toHaveBeenCalledTimes(2);
});
it("rejects disabled SMTP and delivery failure without activating a code or leaking details", async () => {
  const { ctx, runMutation } = context();
  expect((await requestEmailOtp(ctx, "person@example.com", "ip")).status).toBe(
    503,
  );
  expect(runMutation).not.toHaveBeenCalled();
  configured();
  vi.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail: vi.fn().mockRejectedValue(new Error("SMTP password secret")),
    close: vi.fn(),
  } as never);
  const failed = await requestEmailOtp(ctx, "person@example.com", "ip");
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("secret");
  expect(runMutation).toHaveBeenCalledOnce();
});
it("returns retry-after on throttling and never sends another email", async () => {
  configured();
  const { ctx, runMutation } = context();
  runMutation
    .mockReset()
    .mockRejectedValue(
      new ConvexError({ code: "OTP_RATE_LIMIT", retryAfterSeconds: 49 }),
    );
  const response = await requestEmailOtp(ctx, "person@example.com", "ip");
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("49");
});
it("validates email before database or SMTP use", async () => {
  const { ctx, runMutation } = context();
  expect((await requestEmailOtp(ctx, "bad\naddress", "ip")).status).toBe(400);
  expect(runMutation).not.toHaveBeenCalled();
});
it("ignores spoofed forwarded IPs unless the peer is an explicitly trusted proxy", () => {
  const request = new Request("https://api.example.com", {
    headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.2" },
  });
  expect(authClientAddress(request, "5.6.7.8")).toBe("5.6.7.8");
  vi.stubEnv("AUTH_TRUSTED_PROXY_IPS", "10.0.0.1,10.0.0.2");
  expect(authClientAddress(request, "10.0.0.1")).toBe("1.2.3.4");
});
