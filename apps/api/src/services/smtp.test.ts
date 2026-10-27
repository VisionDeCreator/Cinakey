import { expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { sendSmtpEmail, smtpConfiguration } from "./smtp";
function configured() {
  for (const [key, value] of Object.entries({
    EMAIL_NOTIFICATIONS_ENABLED: "true",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "fixture-user",
    SMTP_PASSWORD: "fixture-password",
    SMTP_FROM_NAME: "Cinakey",
    SMTP_FROM_EMAIL: "hello@example.com",
    SMTP_REPLY_TO: "support@example.com",
  }))
    vi.stubEnv(key, value);
}
it("disables SMTP explicitly without creating a transport", async () => {
  vi.mocked(nodemailer.createTransport).mockClear();
  expect(
    await sendSmtpEmail({
      to: "recipient@example.com",
      subject: "Hello",
      text: "Body",
    }),
  ).toEqual({ sent: false, reason: "disabled" });
  expect(nodemailer.createTransport).not.toHaveBeenCalled();
});
it("uses configured sender, reply-to, TLS and deterministic message IDs", async () => {
  configured();
  const sendMail = vi
    .fn()
    .mockResolvedValue({ accepted: ["recipient@example.com"], rejected: [] });
  const close = vi.fn();
  vi.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close,
  } as never);
  await sendSmtpEmail({
    to: "recipient@example.com",
    subject: "Hello",
    text: "Body",
    idempotencyKey: "invitation:1",
  });
  expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
    expect.objectContaining({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "fixture-user", pass: "fixture-password" },
    }),
  );
  expect(sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      from: { name: "Cinakey", address: "hello@example.com" },
      replyTo: "support@example.com",
      messageId: expect.stringMatching(/^<[a-f0-9]{64}@example.com>$/),
    }),
  );
  expect(close).toHaveBeenCalledOnce();
  vi.stubEnv("SMTP_PORT", "587");
  vi.stubEnv("SMTP_SECURE", "false");
  expect(smtpConfiguration()?.transport).toMatchObject({
    port: 587,
    secure: false,
    requireTLS: true,
  });
});
it("reports missing configuration and sanitizes SMTP failures", async () => {
  configured();
  vi.stubEnv("SMTP_PASSWORD", "");
  expect(() => smtpConfiguration()).toThrow("not configured");
  configured();
  vi.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail: vi
      .fn()
      .mockRejectedValue(new Error("fixture-password secret server response")),
    close: vi.fn(),
  } as never);
  await expect(
    sendSmtpEmail({
      to: "recipient@example.com",
      subject: "Hello",
      text: "Body",
    }),
  ).rejects.toThrow("SMTP delivery failed");
});
