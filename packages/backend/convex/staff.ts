import { budgetMonth, readTotals, withCap } from "./lib/budgets";
import { paymentState } from "./lib/paymentAccess";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireStaff } from "./lib/access";
import { appendAuditLog } from "./lib/audit";
import { appendLedgerEntry, getWorkspaceBalance } from "./billing";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";
import { RATE_LIMITS } from "./lib/limits";
import { assertRateLimit } from "./lib/rateLimit";
import { normalizeAuthEmail } from "./lib/authEmail";

/** Deployment operators can bootstrap access without an existing staff session. */
export const promoteAdmin = internalMutation({
  args: { email: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    let email: string;
    try {
      email = normalizeAuthEmail(args.email);
    } catch {
      throw new ConvexError("Enter a valid email address");
    }
    const reason = args.reason.trim();
    if (reason.length < 3 || reason.length > 500)
      throw new ConvexError("A reason of 3 to 500 characters is required");

    const matches = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .take(2);
    const target = matches[0];
    if (!target)
      throw new ConvexError(
        "No existing account has this email. Sign in to the web app first, then rerun the script.",
      );
    if (matches.length > 1)
      throw new ConvexError(
        "Multiple accounts have this email. Resolve the duplicate accounts before promoting an administrator.",
      );
    if (target.isAnonymous || target.emailVerificationTime === undefined)
      throw new ConvexError(
        "This account must verify its email by signing in before it can become an administrator.",
      );
    if (target.isStaff === true)
      return { userId: target._id, email, isStaff: true, alreadyAdmin: true };

    await ctx.db.patch(target._id, { isStaff: true });
    await appendAuditLog(ctx, {
      actorType: "operator",
      action: "platform.admin.promote",
      targetType: "users",
      targetId: target._id,
      reason,
      meta: { email, source: "admin:promote", authorization: "deployment-key" },
    });
    return { userId: target._id, email, isStaff: true, alreadyAdmin: false };
  },
});

async function findUserByEmail(
  ctx: MutationCtx | QueryCtx,
  emailLower: string,
) {
  return await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", emailLower))
    .unique();
}

export const lookupUser = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const email = args.email.trim().toLowerCase();
    if (email.length === 0) return null;

    const target = await findUserByEmail(ctx, email);
    if (target === null) return null;

    const workspaceId = target.personalWorkspaceId;
    const balance =
      workspaceId !== undefined
        ? await getWorkspaceBalance(ctx, workspaceId)
        : 0;

    const jobs =
      workspaceId !== undefined
        ? await ctx.db
            .query("generationJobs")
            .filter((q) => q.eq(q.field("createdBy"), target._id))
            .order("desc")
            .take(30)
        : [];

    return {
      userId: target._id,
      email: target.email ?? email,
      name: target.name,
      isStaff: target.isStaff === true,
      balance,
      hasWorkspace: workspaceId !== undefined,
      workspaceId,
      recentJobs: jobs.map((j) => ({
        _id: j._id,
        model: j.model,
        kind: j.kind,
        status: j.status,
        estimatedCostUsdMicros: j.estimatedCostUsdMicros,
        actualCostUsdMicros: j.actualCostUsdMicros,
        createdAt: j.createdAt,
        completedAt: j.completedAt,
        errorMessage: j.errorMessage,
        projectId: j.projectId,
      })),
    };
  },
});

export const grantUsd = mutation({
  args: {
    email: v.string(),
    amount: v.number(),
    requestId: v.optional(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    await assertRateLimit(
      ctx,
      `staffGrant:${staff._id}`,
      RATE_LIMITS.staffGrant.limit,
      RATE_LIMITS.staffGrant.windowMs,
    );
    if (args.amount <= 0 || !Number.isFinite(args.amount)) {
      throw new Error("Amount must be a positive number");
    }
    const reason = args.reason.trim();
    if (reason.length < 3) {
      throw new Error("A reason of at least 3 characters is required");
    }
    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) {
      throw new Error("A valid email is required");
    }

    const target = await findUserByEmail(ctx, email);
    if (target === null) {
      throw new Error(`No user found with email ${email}`);
    }

    const workspaceId = await ensurePersonalWorkspaceForUser(ctx, target._id);
    const result = await appendLedgerEntry(ctx, {
      workspaceId,
      userId: target._id,
      delta: args.amount,
      requestId: args.requestId,
      reason: "grant",
    });

    await appendAuditLog(ctx, {
      actorUserId: staff._id,
      action: "usdMicros.grant",
      targetType: "users",
      targetId: target._id,
      reason,
      meta: { amount: args.amount, email, balanceAfter: result.balanceAfter },
    });

    return {
      userId: target._id,
      email: target.email ?? email,
      balanceAfter: result.balanceAfter,
    };
  },
});

export const adjustUsd = mutation({
  args: {
    email: v.string(),
    amount: v.number(),
    requestId: v.optional(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    await assertRateLimit(
      ctx,
      `staffGrant:${staff._id}`,
      RATE_LIMITS.staffGrant.limit,
      RATE_LIMITS.staffGrant.windowMs,
    );
    if (args.amount <= 0 || !Number.isFinite(args.amount)) {
      throw new Error("Amount must be a positive number");
    }
    const reason = args.reason.trim();
    if (reason.length < 3) {
      throw new Error("A reason of at least 3 characters is required");
    }
    const email = args.email.trim().toLowerCase();
    const target = await findUserByEmail(ctx, email);
    if (target === null) {
      throw new Error(`No user found with email ${email}`);
    }
    const workspaceId = await ensurePersonalWorkspaceForUser(ctx, target._id);
    const result = await appendLedgerEntry(ctx, {
      workspaceId,
      userId: target._id,
      delta: args.amount,
      requestId: args.requestId,
      reason: "adjustment",
    });

    await appendAuditLog(ctx, {
      actorUserId: staff._id,
      action: "usdMicros.refund",
      targetType: "users",
      targetId: target._id,
      reason,
      meta: { amount: args.amount, email, balanceAfter: result.balanceAfter },
    });

    return {
      userId: target._id,
      email: target.email ?? email,
      balanceAfter: result.balanceAfter,
    };
  },
});

export const listModerationQueue = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const limit = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query("moderationFlags")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(limit);
  },
});

export const providerHealth = query({
  args: { limitPerModel: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const limit = Math.min(args.limitPerModel ?? 100, 500);
    const models = [
      "seedance-2.5",
      "sume-remix-lite",
      "gpt-image-2",
      "deepseek",
    ] as const;
    const results = [];

    for (const model of models) {
      const jobs = await ctx.db
        .query("generationJobs")
        .withIndex("by_model", (q) => q.eq("model", model))
        .order("desc")
        .take(limit);

      const terminal = jobs.filter(
        (j) =>
          j.status === "succeeded" ||
          j.status === "failed" ||
          j.status === "refunded",
      );
      const succeeded = terminal.filter((j) => j.status === "succeeded").length;
      const latencies: number[] = [];
      for (const j of terminal) {
        const end = j.completedAt ?? j.updatedAt;
        if (end > j.createdAt) {
          latencies.push(end - j.createdAt);
        }
      }
      latencies.sort((a, b) => a - b);
      const p50 =
        latencies.length > 0
          ? latencies[Math.floor(latencies.length * 0.5)]!
          : null;
      const p95 =
        latencies.length > 0
          ? latencies[Math.floor(latencies.length * 0.95)]!
          : null;

      results.push({
        model,
        sampleSize: terminal.length,
        successRate: terminal.length === 0 ? null : succeeded / terminal.length,
        latencyP50Ms: p50,
        latencyP95Ms: p95,
      });
    }

    return results;
  },
});

export const monthlyEgress = query({
  args: {
    year: v.number(),
    month: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    if (args.month < 1 || args.month > 12) {
      throw new Error("month must be 1-12");
    }
    const start = Date.UTC(args.year, args.month - 1, 1);
    const end = Date.UTC(args.year, args.month, 1);

    // Small-scale scan for first-50 launch; move to R2 rollups when volume grows.
    const events = await ctx.db.query("egressEvents").collect();
    const inMonth = events.filter(
      (e) => e.createdAt >= start && e.createdAt < end,
    );

    const byUser = new Map<string, number>();
    const byProject = new Map<string, number>();
    let total = 0;
    for (const e of inMonth) {
      total += e.bytes;
      byUser.set(e.userId, (byUser.get(e.userId) ?? 0) + e.bytes);
      if (e.projectId !== undefined) {
        byProject.set(e.projectId, (byProject.get(e.projectId) ?? 0) + e.bytes);
      }
    }

    const topUsers = [...byUser.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([userId, bytes]) => ({ userId: userId as Id<"users">, bytes }));
    const topProjects = [...byProject.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([projectId, bytes]) => ({
        projectId: projectId as Id<"projects">,
        bytes,
      }));

    return {
      year: args.year,
      month: args.month,
      totalBytes: total,
      topUsers,
      topProjects,
    };
  },
});

export const listAuditLog = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const limit = Math.min(args.limit ?? 100, 500);
    return await ctx.db
      .query("auditLog")
      .withIndex("by_time")
      .order("desc")
      .take(limit);
  },
});

/** Platform administration uses the existing server-controlled isStaff permission. */
export const enableInternalWorkspace = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    monthlyCapUsdMicros: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    await enableInternal(
      ctx,
      args.workspaceId,
      actor._id,
      args.monthlyCapUsdMicros,
      args.reason,
    );
    return args.workspaceId;
  },
});

export const createInternalWorkspace = mutation({
  args: {
    ownerEmail: v.string(),
    name: v.string(),
    monthlyCapUsdMicros: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx);
    const target = await findUserByEmail(
      ctx,
      args.ownerEmail.trim().toLowerCase(),
    );
    if (!target) throw new Error("Owner must have an existing account");
    const name = args.name.trim();
    if (!name || name.length > 120)
      throw new Error("Workspace name must be 1–120 characters");
    const now = Date.now();
    const workspaceId = await ctx.db.insert("workspaces", {
      name,
      ownerUserId: target._id,
      createdAt: now,
      updatedAt: now,
    });
    await enableInternal(
      ctx,
      workspaceId,
      actor._id,
      args.monthlyCapUsdMicros,
      args.reason,
    );
    return workspaceId;
  },
});

async function enableInternal(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  actorUserId: Id<"users">,
  cap: number,
  rawReason: string,
) {
  const reason = rawReason.trim();
  if (reason.length < 3)
    throw new Error("A reason of at least 3 characters is required");
  if (!Number.isSafeInteger(cap) || cap < 0)
    throw new Error("Monthly budget must be a non-negative integer");
  // Never let a billing override hide a live subscription, purchased funds, or a pending checkout.
  const payment = await ctx.db
    .query("paymentWorkspaces")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
  const checkout = await ctx.db
    .query("paymentCheckouts")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
  const usage = await ctx.db
    .query("usageLedger")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .filter((q) => q.eq(q.field("reason"), "reserve"))
    .first();
  if (payment || checkout || usage)
    throw new Error(
      "Use a new workspace without payment or usage history for internal billing",
    );
  await ctx.db.patch(workspaceId, {
    billingMode: "internal",
    monthlySpendCapUsdMicros: cap,
    updatedAt: Date.now(),
  });
  await appendAuditLog(ctx, {
    actorUserId,
    action: "workspace.internal.enable",
    targetType: "workspaces",
    targetId: workspaceId,
    reason,
    meta: { monthlyCapUsdMicros: cap },
  });
}

/** Narrow, staff-only diagnostics; never return auth sessions or provider credentials. */
export const listUsers = query({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    await requireStaff(ctx);
    const result = await ctx.db
      .query("users")
      .order("desc")
      .paginate({ cursor, numItems: 25 });
    return {
      ...result,
      page: result.page.map((u) => ({
        _id: u._id,
        email: u.email,
        name: u.name,
        isStaff: u.isStaff === true,
      })),
    };
  },
});

export const userDetail = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireStaff(ctx);
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const owned = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const workspaces = owned.map((w) => ({
      _id: w._id,
      name: w.name,
      role: "owner",
      billingMode: w.billingMode ?? "paid",
    }));
    for (const membership of memberships) {
      if (workspaces.some((w) => w._id === membership.workspaceId)) continue;
      const workspace = await ctx.db.get(membership.workspaceId);
      if (workspace)
        workspaces.push({
          _id: workspace._id,
          name: workspace.name,
          role: membership.role,
          billingMode: workspace.billingMode ?? "paid",
        });
    }
    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      isStaff: user.isStaff === true,
      emailVerified: user.emailVerificationTime !== undefined,
      createdAt: user._creationTime,
      workspaces,
    };
  },
});

export const listWorkspaces = query({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    await requireStaff(ctx);
    const result = await ctx.db
      .query("workspaces")
      .order("desc")
      .paginate({ cursor, numItems: 25 });
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (w) => ({
          _id: w._id,
          name: w.name,
          billingMode: w.billingMode ?? "paid",
          ownerEmail: (await ctx.db.get(w.ownerUserId))?.email,
        })),
      ),
    };
  },
});

export const workspaceDetail = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireStaff(ctx);
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) return null;
    const owner = await ctx.db.get(workspace.ownerUserId);
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const members = [
      { userId: workspace.ownerUserId, role: "owner", email: owner?.email },
    ];
    for (const m of memberships)
      members.push({
        userId: m.userId,
        role: m.role,
        email: (await ctx.db.get(m.userId))?.email,
      });
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const payment = await paymentState(ctx, workspaceId);
    const month = budgetMonth();
    return {
      _id: workspace._id,
      name: workspace.name,
      billingMode: workspace.billingMode ?? "paid",
      createdAt: workspace.createdAt,
      members,
      projectCount: projects.length,
      subscriptionStatus: payment?.status ?? "Not subscribed",
      paidSeats: payment?.paidSeats ?? 0,
      budget: withCap(
        await readTotals(ctx, `workspace:${workspaceId}:${month}`),
        workspace.monthlySpendCapUsdMicros,
      ),
      month,
      balance: await getWorkspaceBalance(ctx, workspaceId),
    };
  },
});
