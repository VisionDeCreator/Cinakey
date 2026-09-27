/**
 * Workspace credit ledger — append-only.
 * Balance = latest balanceAfter for the workspace (0 if no entries).
 * Mutations reject any write that would make balanceAfter < 0.
 */

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireStaff, requireUser } from "./lib/access";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";
import { convexEnv } from "./lib/env";

export type LedgerReason = "grant" | "reserve" | "settle" | "refund";

export async function getWorkspaceBalance(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<number> {
  const latest = await ctx.db
    .query("creditLedger")
    .withIndex("by_workspace_time", (q) => q.eq("workspaceId", workspaceId))
    .order("desc")
    .first();
  return latest?.balanceAfter ?? 0;
}

export async function appendLedgerEntry(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    projectId?: Id<"projects">;
    jobId?: Id<"generationJobs">;
    delta: number;
    reason: LedgerReason;
  },
): Promise<{ balanceAfter: number; entryId: Id<"creditLedger"> }> {
  const prev = await getWorkspaceBalance(ctx, args.workspaceId);
  const balanceAfter = prev + args.delta;
  if (balanceAfter < 0) {
    throw new Error(
      `Insufficient credits (balance ${prev}, delta ${args.delta})`,
    );
  }
  const entryId = await ctx.db.insert("creditLedger", {
    workspaceId: args.workspaceId,
    userId: args.userId,
    projectId: args.projectId,
    jobId: args.jobId,
    delta: args.delta,
    reason: args.reason,
    balanceAfter,
    createdAt: Date.now(),
  });
  return { balanceAfter, entryId };
}

export const getBalance = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (user.personalWorkspaceId === undefined) {
      return { balance: 0, workspaceId: null as Id<"workspaces"> | null };
    }
    const balance = await getWorkspaceBalance(ctx, user.personalWorkspaceId);
    return { balance, workspaceId: user.personalWorkspaceId };
  },
});

export const listLedger = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (user.personalWorkspaceId === undefined) {
      return [];
    }
    const limit = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query("creditLedger")
      .withIndex("by_workspace_time", (q) =>
        q.eq("workspaceId", user.personalWorkspaceId!),
      )
      .order("desc")
      .take(limit);
  },
});

/**
 * Dev-only self-grant. Requires staff OR ALLOW_DEV_CREDITS=true in Convex env.
 * Prefer grantToEmail from the /dev admin page for production-like grants.
 */
export const grantDev = mutation({
  args: { amount: v.number() },
  handler: async (ctx, args) => {
    if (args.amount <= 0 || !Number.isFinite(args.amount)) {
      throw new Error("Amount must be a positive number");
    }
    const user = await requireUser(ctx);
    const allowDev = convexEnv("ALLOW_DEV_CREDITS") === "true";
    if (user.isStaff !== true && !allowDev) {
      throw new Error(
        "Dev credit grants require staff or ALLOW_DEV_CREDITS=true",
      );
    }
    const workspaceId = await ensurePersonalWorkspaceForUser(ctx, user._id);
    return await appendLedgerEntry(ctx, {
      workspaceId,
      userId: user._id,
      delta: args.amount,
      reason: "grant",
    });
  },
});

/**
 * Staff-only: grant credits to a user identified by email (their personal workspace).
 */
export const grantToEmail = mutation({
  args: {
    email: v.string(),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    if (args.amount <= 0 || !Number.isFinite(args.amount)) {
      throw new Error("Amount must be a positive number");
    }
    const email = args.email.trim().toLowerCase();
    if (email.length === 0 || !email.includes("@")) {
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
    return {
      userId: target._id,
      email: target.email ?? email,
      balanceAfter: result.balanceAfter,
    };
  },
});

/** Staff-only preview: resolve a user by email and return their credit balance. */
export const lookupByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const email = args.email.trim().toLowerCase();
    if (email.length === 0) return null;

    const target = await findUserByEmail(ctx, email);
    if (target === null) return null;

    const balance =
      target.personalWorkspaceId !== undefined
        ? await getWorkspaceBalance(ctx, target.personalWorkspaceId)
        : 0;

    return {
      userId: target._id,
      email: target.email ?? email,
      name: target.name,
      isStaff: target.isStaff === true,
      balance,
      hasWorkspace: target.personalWorkspaceId !== undefined,
    };
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

export const reserve = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    jobId: v.id("generationJobs"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.amount <= 0) {
      throw new Error("Reserve amount must be positive");
    }
    return await appendLedgerEntry(ctx, {
      workspaceId: args.workspaceId,
      userId: args.userId,
      projectId: args.projectId,
      jobId: args.jobId,
      delta: -args.amount,
      reason: "reserve",
    });
  },
});

export const settle = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    jobId: v.id("generationJobs"),
    estimated: v.number(),
    actual: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.actual < 0 || args.estimated < 0) {
      throw new Error("Costs must be non-negative");
    }
    if (args.actual > args.estimated) {
      throw new Error(
        `Actual cost (${args.actual}) exceeds reserved (${args.estimated})`,
      );
    }
    // Return unused reserved credits (may be 0).
    const delta = args.estimated - args.actual;
    return await appendLedgerEntry(ctx, {
      workspaceId: args.workspaceId,
      userId: args.userId,
      projectId: args.projectId,
      jobId: args.jobId,
      delta,
      reason: "settle",
    });
  },
});

export const refund = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    jobId: v.id("generationJobs"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.amount < 0) {
      throw new Error("Refund amount must be non-negative");
    }
    if (args.amount === 0) {
      return { balanceAfter: await getWorkspaceBalance(ctx, args.workspaceId) };
    }
    return await appendLedgerEntry(ctx, {
      workspaceId: args.workspaceId,
      userId: args.userId,
      projectId: args.projectId,
      jobId: args.jobId,
      delta: args.amount,
      reason: "refund",
    });
  },
});

/** Test helper: append without auth (used by unit tests via internal API). */
export const appendForTest = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    delta: v.number(),
    reason: v.union(
      v.literal("grant"),
      v.literal("reserve"),
      v.literal("settle"),
      v.literal("refund"),
    ),
    projectId: v.optional(v.id("projects")),
    jobId: v.optional(v.id("generationJobs")),
  },
  handler: async (ctx, args) => {
    return await appendLedgerEntry(ctx, args);
  },
});
