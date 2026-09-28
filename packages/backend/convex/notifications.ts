/**
 * In-app notifications + optional email via Resend.
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireUser } from "./lib/access";

const notificationKind = v.union(
  v.literal("job_succeeded"),
  v.literal("job_failed"),
  v.literal("export_succeeded"),
  v.literal("export_failed"),
);

export type NotificationKind =
  | "job_succeeded"
  | "job_failed"
  | "export_succeeded"
  | "export_failed";

export async function insertNotification(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    projectId?: Id<"projects">;
    kind: NotificationKind;
    title: string;
    body?: string;
    href?: string;
  },
): Promise<Id<"notifications">> {
  const id = await ctx.db.insert("notifications", {
    userId: args.userId,
    projectId: args.projectId,
    kind: args.kind,
    title: args.title,
    body: args.body,
    href: args.href,
    read: false,
    createdAt: Date.now(),
  });

  await ctx.scheduler.runAfter(0, internal.email.maybeSendForNotification, {
    userId: args.userId,
    title: args.title,
    body: args.body,
    href: args.href,
  });

  return id;
}

export const listUnread = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) =>
        q.eq("userId", user._id).eq("read", false),
      )
      .order("desc")
      .collect();
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const note = await ctx.db.get(args.notificationId);
    if (note === null) {
      throw new Error("Notification not found");
    }
    if (note.userId !== user._id) {
      throw new Error("Notification access denied");
    }
    await ctx.db.patch(args.notificationId, { read: true });
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) =>
        q.eq("userId", user._id).eq("read", false),
      )
      .collect();
    for (const note of unread) {
      await ctx.db.patch(note._id, { read: true });
    }
    return { count: unread.length };
  },
});

export const createForUser = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    kind: notificationKind,
    title: v.string(),
    body: v.optional(v.string()),
    href: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await insertNotification(ctx, args);
  },
});
