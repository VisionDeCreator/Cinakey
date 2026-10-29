import { registrationPolicy } from "./lib/registrationPolicy";
import {
  internalMutation,
  query,
  mutation,
  internalQuery,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { requireAdminPermission } from "./lib/access";
import { appendAuditLog } from "./lib/audit";
import { enqueueTask } from "./tasks";

import { v } from "convex/values";
import { assertRateLimit } from "./lib/rateLimit";
/** Waitlist only: never creates users, invitations, or access entitlements. */
export const request = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    idea: v.string(),
    clientKey: v.string(),
    locale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase(),
      name = args.name.trim(),
      idea = args.idea.trim();
    if (
      email.length > 254 ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
      name.length > 100 ||
      idea.length > 1000 ||
      !/^[a-f0-9]{64}$/.test(args.clientKey)
    )
      throw new Error("Invalid request");
    await assertRateLimit(
      ctx,
      `early-access:${args.clientKey}`,
      5,
      60 * 60 * 1000,
    );
    const existing = await ctx.db
      .query("earlyAccessRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!existing)
      await ctx.db.insert("earlyAccessRequests", {
        email,
        locale: ["en", "fr", "es", "ko", "ja", "zh"].includes(args.locale ?? "")
          ? args.locale
          : "en",
        name,
        idea,
        status: "pending",
        createdAt: Date.now(),
      });
    return { ok: true };
  },
});

const statusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);
export const list = query({
  args: {
    status: v.optional(statusValidator),
    email: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "waitlist.read");
    if (args.paginationOpts.numItems > 100) throw new Error("Page too large");
    async function decorate(row: Doc<"earlyAccessRequests">) {
      const reviewer = row.reviewedBy ? await ctx.db.get(row.reviewedBy) : null;
      return { ...row, reviewerLabel: reviewer?.name || reviewer?.email };
    }
    if (args.email?.trim()) {
      const row = await ctx.db
        .query("earlyAccessRequests")
        .withIndex("by_email", (q) =>
          q.eq("email", args.email!.trim().toLowerCase()),
        )
        .unique();
      return {
        page:
          row && (!args.status || row.status === args.status)
            ? [await decorate(row)]
            : [],
        isDone: true,
        continueCursor: "",
      };
    }
    const rows = args.status
      ? ctx.db
          .query("earlyAccessRequests")
          .withIndex("by_status_created", (q) => q.eq("status", args.status!))
      : ctx.db.query("earlyAccessRequests").withIndex("by_created");
    const result = await rows.order("desc").paginate(args.paginationOpts);
    return { ...result, page: await Promise.all(result.page.map(decorate)) };
  },
});
export const counts = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminPermission(ctx, "waitlist.read");
    const result = {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      registered: 0,
    };
    // This query reads only waitlist records, never user or workspace data.
    for await (const row of ctx.db.query("earlyAccessRequests")) {
      result.total++;
      result[row.status]++;
      if (row.registeredUserId) result.registered++;
    }
    return result;
  },
});
export const review = mutation({
  args: {
    id: v.id("earlyAccessRequests"),
    status: statusValidator,
    revision: v.number(),
    reason: v.optional(v.string()),
    requestId: v.string(),
    resend: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "waitlist.manage");
    const reason = args.reason?.trim() ?? "";
    if ((args.reason?.length ?? 0) > 2000)
      throw new Error("Review reason must be 2000 characters or fewer");
    if (!args.requestId.trim() || args.requestId.length > 128)
      throw new Error("Invalid request ID");
    const fingerprint = JSON.stringify([
      args.id,
      args.status,
      args.revision,
      args.reason ?? "",
      !!args.resend,
    ]);
    const prior = await ctx.db
      .query("adminActionRequests")
      .withIndex("by_actor_request", (q) =>
        q.eq("actorUserId", actor._id).eq("requestId", args.requestId),
      )
      .unique();
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new Error("Administrative request mismatch");
      return;
    }
    const row = await ctx.db.get(args.id);
    if (!row || (row.revision ?? 0) !== args.revision)
      throw new Error("Request changed. Refresh and try again.");
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", row.email))
      .first();
    if ((row.registeredUserId || existing) && args.status !== "approved")
      throw new Error(
        "Use account suspension to restrict an existing account.",
      );
    if (
      args.resend &&
      (row.status !== "approved" || args.status !== "approved")
    )
      throw new Error("Approve this request first");
    await assertRateLimit(ctx, `waitlist-review:${actor._id}`, 30, 60_000);
    const generation = (row.deliveryGeneration ?? 0) + 1;
    await ctx.db.insert("adminActionRequests", {
      actorUserId: actor._id,
      requestId: args.requestId,
      fingerprint,
      createdAt: Date.now(),
    });
    await ctx.db.patch(row._id, {
      status: args.status,
      revision: args.revision + 1,
      reviewedBy: actor._id,
      reviewedAt: Date.now(),
      reason: reason || undefined,
      deliveryGeneration: generation,
      emailDelivery: args.status === "approved" ? "queued" : undefined,
      ...(existing
        ? {
            registeredUserId: existing._id,
            registeredAt: row.registeredAt ?? Date.now(),
          }
        : {}),
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: args.resend ? "waitlist.resend" : "waitlist.review",
      targetType: "waitlist",
      targetId: row._id,
      requestId: args.requestId,
      reason: reason || undefined,
      before: { status: row.status },
      after: { status: args.status },
    });
    if (args.status === "approved")
      await enqueueTask(ctx, 0, "earlyAccess:sendApproval", {
        id: row._id,
        generation,
      });
  },
});
export const delivery = internalQuery({
  args: { id: v.id("earlyAccessRequests"), generation: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    return row?.status === "approved" &&
      row.deliveryGeneration === args.generation &&
      row.emailDelivery !== "sent"
      ? { email: row.email, locale: row.locale ?? "en" }
      : null;
  },
});
export const recordDelivery = internalMutation({
  args: {
    id: v.id("earlyAccessRequests"),
    generation: v.number(),
    sent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (
      row?.deliveryGeneration === args.generation &&
      row.status === "approved" &&
      row.emailDelivery !== "sent"
    )
      await ctx.db.patch(row._id, {
        emailDelivery: args.sent ? "sent" : "failed",
      });
  },
});

export const publicPolicy = internalQuery({
  args: {},
  handler: async (ctx) => ({
    requireApproval: (await registrationPolicy(ctx)).requireApproval,
  }),
});
export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminPermission(ctx, "waitlist.read");
    return registrationPolicy(ctx);
  },
});
export const configure = mutation({
  args: {
    requireApproval: v.boolean(),
    revision: v.number(),
    reason: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "waitlist.configure");
    const reason = args.reason.trim();
    if (
      reason.length < 10 ||
      reason.length > 2000 ||
      !args.requestId.trim() ||
      args.requestId.length > 128
    )
      throw new Error("Provide a reason of 10 to 2000 characters");
    const fingerprint = JSON.stringify([
      "waitlist.configure",
      args.requireApproval,
      args.revision,
      reason,
    ]);
    const prior = await ctx.db
      .query("adminActionRequests")
      .withIndex("by_actor_request", (q) =>
        q.eq("actorUserId", actor._id).eq("requestId", args.requestId),
      )
      .unique();
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new Error("Administrative request mismatch");
      return;
    }
    const before = await registrationPolicy(ctx);
    if (before.revision !== args.revision)
      throw new Error("Registration settings changed. Refresh and try again.");
    await assertRateLimit(ctx, `waitlist-config:${actor._id}`, 10, 60_000);
    const row = await ctx.db
      .query("registrationSettings")
      .withIndex("by_key", (q) => q.eq("key", "platform"))
      .unique();
    const values = {
      requireApproval: args.requireApproval,
      revision: before.revision + 1,
      updatedBy: actor._id,
      updatedAt: Date.now(),
    };
    if (row) await ctx.db.patch(row._id, values);
    else
      await ctx.db.insert("registrationSettings", {
        key: "platform",
        ...values,
      });
    await ctx.db.insert("adminActionRequests", {
      actorUserId: actor._id,
      requestId: args.requestId,
      fingerprint,
      createdAt: Date.now(),
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "waitlist.configure",
      targetType: "platform",
      targetId: "registration",
      requestId: args.requestId,
      reason,
      before,
      after: values,
    });
  },
});
