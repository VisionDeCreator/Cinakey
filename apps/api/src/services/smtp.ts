import nodemailer from "nodemailer";
import { createHash } from "node:crypto";
export const smtpTransport = nodemailer;
import { serverEnv } from "../config/env";

export function smtpConfiguration() {
  if (serverEnv("EMAIL_NOTIFICATIONS_ENABLED") !== "true") return null;
  const required = [
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM_EMAIL",
  ];
  if (required.some((key) => !serverEnv(key)?.trim()))
    throw new Error(
      "SMTP email is not configured. Check SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM_EMAIL.",
    );
  const secureValue = serverEnv("SMTP_SECURE") ?? "true";
  const port = Number(
    serverEnv("SMTP_PORT")?.trim() || (secureValue === "true" ? 465 : 587),
  );
  if (
    !["true", "false"].includes(secureValue) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error("Invalid SMTP_PORT or SMTP_SECURE configuration");
  const address = serverEnv("SMTP_FROM_EMAIL")!.trim();
  const replyTo = serverEnv("SMTP_REPLY_TO")?.trim() || undefined;
  if (
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ||
    (replyTo && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(replyTo))
  )
    throw new Error("Invalid SMTP_FROM_EMAIL or SMTP_REPLY_TO configuration");
  return {
    transport: {
      host: serverEnv("SMTP_HOST")!.trim(),
      port,
      secure: secureValue === "true",
      requireTLS: secureValue !== "true",
      auth: {
        user: serverEnv("SMTP_USER")!,
        pass: serverEnv("SMTP_PASSWORD")!,
      },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    },
    from: { name: serverEnv("SMTP_FROM_NAME")?.trim() || "Dirrio", address },
    replyTo,
  };
}

export async function sendSmtpEmail(args: {
  to: string;
  subject: string;
  text: string;
  idempotencyKey?: string;
}) {
  const config = smtpConfiguration();
  if (!config) return { sent: false as const, reason: "disabled" as const };
  const transport = nodemailer.createTransport(config.transport);
  try {
    const result = await transport.sendMail({
      from: config.from,
      replyTo: config.replyTo,
      to: { address: args.to, name: "" },
      subject: args.subject,
      text: args.text,
      ...(args.idempotencyKey
        ? {
            messageId: `<${createHash("sha256").update(args.idempotencyKey).digest("hex")}@${config.from.address.split("@")[1]}>`,
          }
        : {}),
    });
    if (!result.accepted?.length || result.rejected?.length)
      throw new Error("SMTP recipient rejected");
    return { sent: true as const };
  } catch {
    // SMTP errors can contain credentials, server replies and recipient details.
    throw new Error(
      "SMTP delivery failed. Check sender configuration and email service availability.",
    );
  } finally {
    transport.close();
  }
}
