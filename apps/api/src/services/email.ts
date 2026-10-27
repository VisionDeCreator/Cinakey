import { internal } from "../operations";
import { v } from "convex/values";
import { internalAction } from "../runtime/operation";
import { serverEnv } from "../config/env";

import { sendSmtpEmail } from "./smtp";

export const sendNotificationEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (_ctx, args) => sendSmtpEmail(args),
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
    if (!recipient || serverEnv("EMAIL_NOTIFICATIONS_ENABLED") !== "true")
      return;
    const site = serverEnv("SITE_URL") ?? "https://app.cinakey.com";
    const text = `${args.title}${args.body ? `\n\n${args.body}` : ""}${args.href ? `\n\nOpen: ${site}${args.href}` : ""}\n\n— Cinakey`;
    return await ctx.runAction(internal.email.sendNotificationEmail, {
      to: recipient,
      subject: args.title,
      text,
    });
  },
});
