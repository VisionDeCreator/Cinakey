import { expect, it, vi, afterEach } from "vitest";
import nodemailer from "nodemailer";
import { sendApproval } from "./earlyAccess";
import type { ServiceOperation } from "../runtime/context";
const deliverApproval = sendApproval as unknown as ServiceOperation;
import { approvalEmail } from "./waitlistEmail";
import type { ActionCtx } from "../runtime/operation";
import { getFunctionName } from "convex/server";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("sends localized approval mail and records delivery without granting access", async () => {
  for (const [k, v] of Object.entries({
    EMAIL_NOTIFICATIONS_ENABLED: "true",
    SMTP_HOST: "smtp.example.com",
    SMTP_USER: "fixture",
    SMTP_PASSWORD: "fixture",
    SMTP_FROM_EMAIL: "hello@example.com",
    SITE_URL: "https://app.example.com",
  }))
    vi.stubEnv(k, v);
  const sendMail = vi
    .fn()
    .mockResolvedValue({ accepted: ["qa@example.com"], rejected: [] });
  vi.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: vi.fn(),
  } as never);
  const runMutation = vi.fn();
  const runQuery = vi
    .fn()
    .mockResolvedValue({ email: "qa@example.com", locale: "fr" });
  await deliverApproval.handler(
    { runQuery, runMutation } as unknown as ActionCtx,
    { id: "waitlist-id" as never, generation: 1 },
  );
  expect(sendMail.mock.calls[0]![0]).toMatchObject({
    subject: "Votre accès anticipé à Cinakey est approuvé",
    text: expect.stringContaining("https://app.example.com/sign-up"),
  });
  expect(getFunctionName(runMutation.mock.calls[0]![0])).toBe(
    "earlyAccess:recordDelivery",
  );
  expect(runMutation.mock.calls[0]![1]).toMatchObject({
    sent: true,
    generation: 1,
  });
});
it("records failure and lets the durable worker retry without changing approval", async () => {
  vi.stubEnv("EMAIL_NOTIFICATIONS_ENABLED", "false");
  const runMutation = vi.fn();
  await expect(
    deliverApproval.handler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValue({ email: "qa@example.com", locale: "en" }),
        runMutation,
      } as unknown as ActionCtx,
      { id: "waitlist-id" as never, generation: 2 },
    ),
  ).rejects.toThrow("unavailable");
  expect(runMutation.mock.calls.at(-1)![1]).toMatchObject({ sent: false });
});
it("skips stale or already sent delivery and supports all six locales", async () => {
  const runMutation = vi.fn();
  await deliverApproval.handler(
    {
      runQuery: vi.fn().mockResolvedValue(null),
      runMutation,
    } as unknown as ActionCtx,
    { id: "waitlist-id" as never, generation: 0 },
  );
  expect(runMutation).not.toHaveBeenCalled();
  for (const locale of ["en", "fr", "es", "ko", "ja", "zh"]) {
    expect(approvalEmail(locale, "https://example.com/sign-up").text).toContain(
      "https://example.com/sign-up",
    );
  }
});
