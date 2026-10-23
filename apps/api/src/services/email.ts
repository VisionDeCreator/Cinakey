import { internal } from "../operations";
import { v } from "convex/values";
import { internalAction } from "../runtime/operation";
import { serverEnv } from "../config/env";

function emailSendingEnabled(): boolean {
  // Explicit off switch — default is on when the key is present.
  return serverEnv("EMAIL_ENABLED") !== "false";
}

export const sendNotificationEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  handler: async (_ctx, args) => {
    if (!emailSendingEnabled()) {
      console.log(
        `[email] skipped (EMAIL_ENABLED=false): to=${args.to} subject=${args.subject}`,
      );
      return { sent: false as const, reason: "disabled" as const };
    }

    const apiKey = serverEnv("RESEND_API_KEY");
    const from = serverEnv("EMAIL_FROM") ?? "Cinakey <onboarding@resend.dev>";
    if (apiKey === undefined || apiKey.length === 0) {
      console.log(
        `[email] skipped (no RESEND_API_KEY): to=${args.to} subject=${args.subject}`,
      );
      return { sent: false as const, reason: "no_api_key" as const };
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        text: args.text,
      }),
    });

    if (!res.ok) {
      console.error(`[email] Resend error ${res.status}`);
      throw new Error(`Email delivery failed (${res.status})`);
    }
    return { sent: true as const };
  },
});

export const maybeSendForNotification = internalAction({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.optional(v.string()),
    href: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const recipient = await ctx.runQuery(internal.email.recipient, {
      userId: args.userId,
    });
    if (!recipient || !emailSendingEnabled()) return;
    const site = serverEnv("SITE_URL") ?? "https://app.cinakey.com";
    const text = `${args.title}${args.body ? `\n\n${args.body}` : ""}${args.href ? `\n\nOpen: ${site}${args.href}` : ""}\n\n— Cinakey`;
    return await ctx.runAction(internal.email.sendNotificationEmail, {
      to: recipient,
      subject: args.title,
      text,
    });
  },
});
