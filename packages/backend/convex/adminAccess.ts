import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { adminRoles } from "@dirrio/shared";
import { mutation, query } from "./_generated/server";
import { requireAdminPermission } from "./lib/access";
import { appendAuditLog } from "./lib/audit";
import { assertRateLimit } from "./lib/rateLimit";
import { normalizeAuthEmail } from "./lib/authEmail";

const role = v.union(
  v.literal("platform_admin"),
  v.literal("support"),
  v.literal("billing"),
  v.literal("moderation"),
  v.literal("operations"),
);
export const listAdministrators = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "administrators.manage");
    if (
      !Number.isSafeInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Page size must be 1 to 100");
    const result = await ctx.db
      .query("users")
      .withIndex("by_staff", (q) => q.eq("isStaff", true))
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map((user) => ({
        userId: user._id,
        email: user.email,
        name: user.name,
        roles: adminRoles(user),
      })),
    };
  },
});
export const setRoles = mutation({
  args: {
    email: v.string(),
    roles: v.array(role),
    reason: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "administrators.manage");
    const reason = args.reason.trim();
    if (reason.length < 3 || reason.length > 500)
      throw new Error("A reason of 3 to 500 characters is required");
    if (!args.requestId.trim() || args.requestId.length > 128)
      throw new Error("A valid request ID is required");
    const email = normalizeAuthEmail(args.email);
    const roles = [...new Set(args.roles)].sort();
    const fingerprint = JSON.stringify({ email, roles, reason });
    const previous = await ctx.db
      .query("adminActionRequests")
      .withIndex("by_actor_request", (q) =>
        q.eq("actorUserId", actor._id).eq("requestId", args.requestId),
      )
      .unique();
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new Error("Administrative request mismatch");
      return;
    }
    await assertRateLimit(ctx, `adminRoles:${actor._id}`, 20, 60_000);
    const target = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (!target) throw new Error("Account not found");
    if (roles.length && target.suspendedAt !== undefined)
      throw new Error(
        "Restore this suspended account before assigning administrator roles",
      );
    if (target._id === actor._id)
      throw new Error("Administrators cannot change their own roles");
    if (
      roles.length &&
      (target.isAnonymous || target.emailVerificationTime === undefined)
    )
      throw new Error("A verified account is required");
    if (
      adminRoles(target).includes("platform_admin") &&
      !roles.includes("platform_admin")
    ) {
      const admins = await ctx.db
        .query("users")
        .withIndex("by_staff", (q) => q.eq("isStaff", true))
        .collect();
      if (
        !admins.some(
          (user) =>
            user._id !== target._id &&
            adminRoles(user).includes("platform_admin"),
        )
      )
        throw new Error("Cannot remove the last platform administrator");
    }
    const before = [...adminRoles(target)];
    await ctx.db.patch(target._id, {
      isStaff: roles.length > 0,
      adminRoles: roles,
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "administrators.roles.set",
      targetType: "users",
      targetId: target._id,
      reason,
      requestId: args.requestId,
      before: { roles: before },
      after: { roles },
    });
    await ctx.db.insert("adminActionRequests", {
      actorUserId: actor._id,
      requestId: args.requestId,
      fingerprint,
      createdAt: Date.now(),
    });
  },
});
export const listAudit = query({
  args: {
    paginationOpts: paginationOptsValidator,
    actorUserId: v.optional(v.string()),
    action: v.optional(v.string()),
    targetId: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "audit.read");
    if (
      (args.from !== undefined && !Number.isFinite(args.from)) ||
      (args.to !== undefined && !Number.isFinite(args.to)) ||
      (args.from !== undefined && args.to !== undefined && args.from > args.to)
    )
      throw new Error("Invalid date range");
    if (
      !Number.isSafeInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Page size must be 1 to 100");
    const actorUserId = args.actorUserId
      ? ctx.db.normalizeId("users", args.actorUserId)
      : undefined;
    if (args.actorUserId && !actorUserId)
      return { page: [], isDone: true, continueCursor: "" };
    const from = args.from ?? Number.MIN_SAFE_INTEGER;
    const to = args.to ?? Number.MAX_SAFE_INTEGER;
    const rows = ctx.db.query("auditLog");
    let indexed = actorUserId
      ? rows.withIndex("by_actor_time", (q) =>
          q
            .eq("actorUserId", actorUserId!)
            .gte("createdAt", from)
            .lte("createdAt", to),
        )
      : args.action
        ? rows.withIndex("by_action_time", (q) =>
            q
              .eq("action", args.action!)
              .gte("createdAt", from)
              .lte("createdAt", to),
          )
        : args.targetId
          ? rows.withIndex("by_target_time", (q) =>
              q
                .eq("targetId", args.targetId!)
                .gte("createdAt", from)
                .lte("createdAt", to),
            )
          : rows.withIndex("by_time", (q) =>
              q.gte("createdAt", from).lte("createdAt", to),
            );
    // Combine remaining exact filters server-side. Pagination cursors preserve the selected index.
    if (args.action)
      indexed = indexed.filter((q) => q.eq(q.field("action"), args.action));
    if (args.targetId)
      indexed = indexed.filter((q) => q.eq(q.field("targetId"), args.targetId));
    return indexed.order("desc").paginate(args.paginationOpts);
  },
});
