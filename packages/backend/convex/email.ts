/**
 * Outbound email via Resend (Convex actions only; RESEND_API_KEY in env).
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { convexEnv } from "./lib/env";

export const sendNotificationEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = convexEnv("RESEND_API_KEY");
    const from = convexEnv("EMAIL_FROM") ?? "Cinakey <onboarding@resend.dev>";
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
      const body = await res.text();
      console.error(`[email] Resend error ${res.status}: ${body}`);
      return { sent: false as const, reason: "provider_error" as const };
    }
    return { sent: true as const };
  },
});

/** Schedule email after an in-app notification was created. */
export const maybeSendForNotification = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.optional(v.string()),
    href: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) return;
    if (user.notificationEmailEnabled === false) return;
    const email = user.email;
    if (email === undefined || email.length === 0) return;

    const site = convexEnv("SITE_URL") ?? "https://app.cinakey.com";
    const link =
      args.href !== undefined && args.href.length > 0
        ? `\n\nOpen: ${site}${args.href}`
        : "";
    const text = `${args.title}${args.body ? `\n\n${args.body}` : ""}${link}\n\n— Cinakey\n(You can turn off email notifications in Settings.)`;

    await ctx.scheduler.runAfter(0, internal.email.sendNotificationEmail, {
      to: email,
      subject: args.title,
      text,
    });
  },
});
