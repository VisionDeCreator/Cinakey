import { auditAccounting } from "./lib/reconciliation";
import { budgetMonth, readTotals, withCap } from "./lib/budgets";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  requireWorkspaceAccess,
  requireStaff,
  requireUser,
} from "./lib/access";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";
import { convexEnv } from "./lib/env";

export { appendLedgerEntry, getWorkspaceBalance } from "./lib/ledger";
import { appendLedgerEntry, getWorkspaceBalance } from "./lib/ledger";

export const getBalance = query({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspaceId = args.workspaceId ?? user.personalWorkspaceId;
    if (!workspaceId)
      return { balance: 0, workspaceId: null as Id<"workspaces"> | null };
    await requireWorkspaceAccess(ctx, workspaceId);
    return {
      balance: await getWorkspaceBalance(ctx, workspaceId),
      workspaceId,
    };
  },
});

export const listLedger = query({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspaceId = args.workspaceId ?? user.personalWorkspaceId;
    if (!workspaceId) return [];
    await requireWorkspaceAccess(ctx, workspaceId);
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), 200));
    return ctx.db
      .query("usageLedger")
      .withIndex("by_workspace_sequence", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .order("desc")
      .take(limit);
  },
});

/**
 * Dev-only self-grant. Requires staff OR ALLOW_DEV_USD=true in Convex env.
 * Prefer grantToEmail from the /dev admin page for production-like grants.
 */
export const grantDev = mutation({
  args: {
    amount: v.number(),
    requestId: v.optional(v.string()),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    if (args.amount <= 0 || !Number.isSafeInteger(args.amount)) {
      throw new Error("Amount must be a positive number");
    }
    const user = await requireUser(ctx);
    const allowDev = convexEnv("ALLOW_DEV_USD") === "true";
    if (user.isStaff !== true && !allowDev) {
      throw new Error("Dev USD grants require staff or ALLOW_DEV_USD=true");
    }
    const workspaceId =
      args.workspaceId ?? (await ensurePersonalWorkspaceForUser(ctx, user._id));
    await requireWorkspaceAccess(ctx, workspaceId);
    return await appendLedgerEntry(ctx, {
      workspaceId,
      userId: user._id,
      delta: args.amount,
      reason: "grant",
      requestId: args.requestId,
    });
  },
});

/**
 * Staff-only: grant usdMicros to a user identified by email (their personal workspace).
 */
export const grantToEmail = mutation({
  args: {
    email: v.string(),
    amount: v.number(),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    if (args.amount <= 0 || !Number.isSafeInteger(args.amount)) {
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
      requestId: args.requestId,
    });
    return {
      userId: target._id,
      email: target.email ?? email,
      balanceAfter: result.balanceAfter,
    };
  },
});

/** Staff-only preview: resolve a user by email and return their USD balance. */
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
    const job = await ctx.db.get(args.jobId);
    if (!job || job.estimatedCostUsdMicros !== args.estimated)
      throw new Error("Reservation estimate mismatch");
    if (
      !Number.isSafeInteger(args.actual) ||
      !Number.isSafeInteger(args.estimated) ||
      args.actual < 0 ||
      args.estimated < 0
    ) {
      throw new Error("Costs must be non-negative");
    }
    if (args.actual > args.estimated) {
      throw new Error(
        `Actual cost (${args.actual}) exceeds reserved (${args.estimated})`,
      );
    }
    // Return unused reserved usdMicros (may be 0).
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

/** Financial overview is restricted to workspace owners and admins. */
export const budgets = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const series = await ctx.db
      .query("series")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const account = await ctx.db
      .query("billingAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    const month = budgetMonth();
    return {
      month,
      billingMode: workspace.billingMode ?? "paid",
      account: {
        available: await getWorkspaceBalance(ctx, workspaceId),
        reserved: account?.reserved ?? 0,
        spent: account?.spent ?? 0,
      },
      workspace: withCap(
        await readTotals(ctx, `workspace:${workspaceId}:${month}`),
        workspace.monthlySpendCapUsdMicros,
      ),
      series: await Promise.all(
        series.map(async (s) => ({
          id: s._id,
          title: s.title,
          ...withCap(
            await readTotals(ctx, `series:${s._id}`),
            s.spendCapUsdMicros,
          ),
        })),
      ),
      projects: await Promise.all(
        projects.map(async (p) => ({
          id: p._id,
          title: p.title,
          seriesId: p.seriesId,
          ...withCap(
            await readTotals(ctx, `project:${p._id}`),
            p.spendCapUsdMicros,
          ),
        })),
      ),
    };
  },
});

export const setBudget = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    seriesId: v.optional(v.id("series")),
    projectId: v.optional(v.id("projects")),
    cap: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceAccess(ctx, args.workspaceId);
    if (args.seriesId && args.projectId)
      throw new Error("Choose one budget scope");
    if (args.cap !== null && (!Number.isSafeInteger(args.cap) || args.cap < 0))
      throw new Error("Budget must be a non-negative integer");
    const cap = args.cap ?? undefined;
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.workspaceId !== args.workspaceId)
        throw new Error("Project/workspace mismatch");
      await ctx.db.patch(project._id, { spendCapUsdMicros: cap });
    } else if (args.seriesId) {
      const series = await ctx.db.get(args.seriesId);
      if (!series || series.workspaceId !== args.workspaceId)
        throw new Error("Series/workspace mismatch");
      await ctx.db.patch(series._id, { spendCapUsdMicros: cap });
    } else {
      await ctx.db.patch(args.workspaceId, { monthlySpendCapUsdMicros: cap });
    }
  },
});

export const audit = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: (ctx, { workspaceId }) => auditAccounting(ctx, workspaceId),
});
export const rebuildTotals = internalMutation({
  args: { workspaceId: v.id("workspaces"), expectedSequence: v.number() },
  handler: async (ctx, { workspaceId, expectedSequence }) => {
    const audit = await auditAccounting(ctx, workspaceId);
    if (audit.account.sequence !== expectedSequence)
      throw new Error("Account changed; audit again before rebuilding");
    const account = await ctx.db
      .query("billingAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    if (account) await ctx.db.patch(account._id, audit.account);
    else
      await ctx.db.insert("billingAccounts", { workspaceId, ...audit.account });
    const rows = await ctx.db
      .query("spendTotals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    for (const row of audit.totals)
      await ctx.db.insert("spendTotals", { workspaceId, ...row });
    return { sequence: expectedSequence, scopes: audit.totals.length };
  },
});
