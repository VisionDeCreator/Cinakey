/**
 * Protected staff tools (isStaff). Full admin RBAC is phase 2.
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireStaff } from "./lib/access";
import { appendAuditLog } from "./lib/audit";
import {
  appendLedgerEntry,
  getWorkspaceBalance,
} from "./credits";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";
import { RATE_LIMITS } from "./lib/limits";
import { assertRateLimit } from "./lib/rateLimit";

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
        estimatedCostCredits: j.estimatedCostCredits,
        actualCostCredits: j.actualCostCredits,
        createdAt: j.createdAt,
        completedAt: j.completedAt,
        errorMessage: j.errorMessage,
        projectId: j.projectId,
      })),
    };
  },
});

export const grantCredits = mutation({
  args: {
    email: v.string(),
    amount: v.number(),
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
      reason: "grant",
    });

    await appendAuditLog(ctx, {
      actorUserId: staff._id,
      action: "credits.grant",
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

export const refundCredits = mutation({
  args: {
    email: v.string(),
    amount: v.number(),
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
      reason: "refund",
    });

    await appendAuditLog(ctx, {
      actorUserId: staff._id,
      action: "credits.refund",
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
    const models = ["seedance-2.5", "gpt-image-2", "deepseek"] as const;
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
        successRate:
          terminal.length === 0 ? null : succeeded / terminal.length,
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
        byProject.set(
          e.projectId,
          (byProject.get(e.projectId) ?? 0) + e.bytes,
        );
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
