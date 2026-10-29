import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireAdminPermission } from "./lib/access";
import { appendAuditLog } from "./lib/audit";
import { appendLedgerEntry } from "./lib/ledger";
import { auditAccounting } from "./lib/reconciliation";
import { assertRateLimit } from "./lib/rateLimit";
import { enqueueTask } from "./tasks";
import { convexEnv } from "./lib/env";
const workspaceArgs = { workspaceId: v.id("workspaces") };
const actionArgs = { reason: v.string(), requestId: v.string() };
function validate(reason: string, requestId: string) {
  if (reason.trim().length < 10 || reason.length > 500)
    throw new Error("Provide a reason of 10 to 500 characters");
  if (!requestId.trim() || requestId.length > 128)
    throw new Error("Invalid request ID");
}
function pageSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 100)
    throw new Error("Page size must be 1 to 100");
}
async function once(
  ctx: MutationCtx,
  actorUserId: Parameters<typeof appendAuditLog>[1]["actorUserId"],
  requestId: string,
  fingerprint: string,
) {
  if (!actorUserId) throw new Error("Actor required");
  const prior = await ctx.db
    .query("adminActionRequests")
    .withIndex("by_actor_request", (q) =>
      q.eq("actorUserId", actorUserId).eq("requestId", requestId),
    )
    .unique();
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      throw new Error("Administrative request mismatch");
    return false;
  }
  await assertRateLimit(ctx, `adminBilling:${actorUserId}`, 20, 60_000);
  await ctx.db.insert("adminActionRequests", {
    actorUserId,
    requestId,
    fingerprint,
    createdAt: Date.now(),
  });
  return true;
}
export const events = query({
  args: {
    paginationOpts: paginationOptsValidator,
    pending: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "billing.read");
    pageSize(args.paginationOpts.numItems);
    const result = await (
      args.pending
        ? ctx.db
            .query("paymentEvents")
            .withIndex("by_processed_received", (q) =>
              q.eq("processedAt", undefined),
            )
        : ctx.db.query("paymentEvents").withIndex("by_received")
    )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (e) => {
          const task = e.taskId ? await ctx.db.get(e.taskId) : null;
          return {
            ...e,
            task: task ? { state: task.state, attempts: task.attempts } : null,
          };
        }),
      ),
      environment: convexEnv("POLAR_ENVIRONMENT") ?? "sandbox",
    };
  },
});
export const workspace = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "billing.read");
    const workspaceId = ctx.db.normalizeId("workspaces", args.workspaceId);
    if (!workspaceId) return null;
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) return null;
    const account = await ctx.db
      .query("billingAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    const payment = await ctx.db
      .query("paymentWorkspaces")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    return {
      workspace: {
        id: workspaceId,
        name: workspace.name,
        billingMode: workspace.billingMode ?? "paid",
      },
      account,
      payment,
      environment: convexEnv("POLAR_ENVIRONMENT") ?? "sandbox",
    };
  },
});
export const history = query({
  args: {
    ...workspaceArgs,
    search: v.optional(v.string()),
    kind: v.union(
      v.literal("ledger"),
      v.literal("orders"),
      v.literal("pools"),
      v.literal("checkouts"),
      v.literal("refunds"),
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "billing.read");
    pageSize(args.paginationOpts.numItems);
    if ((args.search?.length ?? 0) > 128) throw new Error("Search is too long");
    const opts = {
      ...args.paginationOpts,
      maximumRowsRead: 200,
      maximumBytesRead: 1_000_000,
    };
    if (args.kind === "ledger")
      return ctx.db
        .query("usageLedger")
        .withIndex("by_workspace_sequence", (q) =>
          q.eq("workspaceId", args.workspaceId),
        )
        .order("desc")
        .filter((q) =>
          args.search
            ? q.or(
                q.eq(q.field("requestId"), args.search),
                q.eq(q.field("reason"), args.search),
                q.eq(q.field("jobId"), args.search),
              )
            : q.eq(1, 1),
        )
        .paginate(opts);
    if (args.kind === "orders")
      return ctx.db
        .query("paymentOrders")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .order("desc")
        .paginate(opts);
    if (args.kind === "pools")
      return ctx.db
        .query("fundingPools")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .order("desc")
        .paginate(opts);
    if (args.kind === "refunds")
      return ctx.db
        .query("adminRefunds")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .order("desc")
        .paginate(opts);
    const result = await ctx.db
      .query("paymentCheckouts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .paginate(opts);
    // Checkout URLs grant customer access; never expose them to staff.
    return {
      ...result,
      page: result.page.map(({ checkoutUrl: _, ...row }) => row),
    };
  },
});
export const audit = query({
  args: workspaceArgs,
  handler: async (ctx, { workspaceId }) => {
    await requireAdminPermission(ctx, "billing.read");
    try {
      const result = await auditAccounting(ctx, workspaceId, 1000);
      return {
        error: null,
        consistent: result.consistent,
        differences: result.differences,
        account: result.account,
      };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Accounting audit failed",
        consistent: false,
        differences: [],
        account: null,
      };
    }
  },
});
export const reprocess = mutation({
  args: { eventId: v.id("paymentEvents"), ...actionArgs },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "billing.write");
    validate(args.reason, args.requestId);
    if (
      !(await once(
        ctx,
        actor._id,
        args.requestId,
        JSON.stringify({ action: "payment.reprocess", ...args }),
      ))
    )
      return;
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Payment event not found");
    if (event.environment !== (convexEnv("POLAR_ENVIRONMENT") ?? "sandbox"))
      throw new Error("Payment environment mismatch");
    if (event.processedAt) throw new Error("Payment event already processed");
    const task = event.taskId ? await ctx.db.get(event.taskId) : null;
    if (task && task.state !== "failed")
      throw new Error("Payment event already queued or running");
    if (task) await ctx.db.delete(task._id);
    const taskId = await enqueueTask(ctx, 0, "payments:processEvent", {
      eventId: event._id,
    });
    await ctx.db.patch(event._id, { taskId });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "payment.reprocess",
      targetType: "paymentEvent",
      targetId: event._id,
      reason: args.reason,
      requestId: args.requestId,
    });
  },
});
export const repair = mutation({
  args: { ...workspaceArgs, ...actionArgs, expectedSequence: v.number() },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "billing.write");
    validate(args.reason, args.requestId);
    if (
      !(await once(
        ctx,
        actor._id,
        args.requestId,
        JSON.stringify({ action: "billing.repair", ...args }),
      ))
    )
      return;
    const audit = await auditAccounting(ctx, args.workspaceId, 1000);
    if (audit.account.sequence !== args.expectedSequence)
      throw new Error("Ledger changed; audit again");
    const stored = await ctx.db
      .query("billingAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (stored) await ctx.db.patch(stored._id, audit.account);
    else
      await ctx.db.insert("billingAccounts", {
        workspaceId: args.workspaceId,
        ...audit.account,
      });
    const totals = await ctx.db
      .query("spendTotals")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(3001);
    if (totals.length > 3000)
      throw new Error("Too many scopes for interactive repair");
    for (const row of totals) await ctx.db.delete(row._id);
    for (const row of audit.totals)
      await ctx.db.insert("spendTotals", {
        workspaceId: args.workspaceId,
        ...row,
      });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "billing.repair",
      targetType: "workspace",
      targetId: args.workspaceId,
      reason: args.reason,
      requestId: args.requestId,
      before: stored ?? {},
      after: audit.account,
    });
  },
});
export const refundContext = internalQuery({
  args: { orderId: v.id("paymentOrders") },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "billing.write");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    return order;
  },
});
export const prepareRefund = internalMutation({
  args: {
    orderId: v.id("paymentOrders"),
    amountCents: v.number(),
    ...actionArgs,
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "billing.write");
    validate(args.reason, args.requestId);
    const prior = await ctx.db
      .query("adminRefunds")
      .withIndex("by_actor_request", (q) =>
        q.eq("actorUserId", actor._id).eq("requestId", args.requestId),
      )
      .unique();
    if (prior) {
      if (
        prior.orderId !== args.orderId ||
        prior.amountCents !== args.amountCents ||
        prior.reason !== args.reason
      )
        throw new Error("Refund request mismatch");
      return { id: prior._id, dispatch: false };
    }
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.environment !== (convexEnv("POLAR_ENVIRONMENT") ?? "sandbox"))
      throw new Error("Payment environment mismatch");
    if (
      !Number.isSafeInteger(args.amountCents) ||
      args.amountCents < 1 ||
      args.amountCents > order.netCents - order.refundedCents
    )
      throw new Error("Invalid refundable amount");
    const previous = await ctx.db
      .query("adminRefunds")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .take(101);
    if (
      previous.length > 100 ||
      previous.some(
        (r) =>
          !["succeeded", "failed", "canceled"].includes(r.status) ||
          (r.status === "succeeded" &&
            order.refundedCents < r.expectedRefundedCents),
      )
    )
      throw new Error("An unresolved refund already exists for this order");
    await assertRateLimit(ctx, `adminRefund:${actor._id}`, 10, 60_000);
    const now = Date.now();
    const id = await ctx.db.insert("adminRefunds", {
      ...args,
      actorUserId: actor._id,
      workspaceId: order.workspaceId,
      environment: order.environment,
      expectedRefundedCents: order.refundedCents + args.amountCents,
      status: "submitting",
      createdAt: now,
      updatedAt: now,
    });
    const state = await ctx.db
      .query("paymentWorkspaces")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", order.workspaceId))
      .unique();
    if (!state) throw new Error("Payment binding missing");
    await ctx.db.patch(state._id, {
      reviewReason:
        state.reviewReason ??
        "An administrator requested a payment refund. Reconcile before further generation.",
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "payment.refund.request",
      targetType: "paymentOrder",
      targetId: order._id,
      reason: args.reason,
      requestId: args.requestId,
      after: {
        refundId: id,
        amountCents: args.amountCents,
        environment: order.environment,
      },
    });
    return { id, dispatch: true };
  },
});
export const recordRefund = internalMutation({
  args: {
    refundId: v.id("adminRefunds"),
    status: v.string(),
    providerRefundId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.refundId);
    if (!row) throw new Error("Refund not found");
    if (
      row.providerRefundId &&
      args.providerRefundId &&
      row.providerRefundId !== args.providerRefundId
    )
      throw new Error("Refund identity mismatch");
    if (
      ["succeeded", "failed", "canceled"].includes(row.status) &&
      row.status !== args.status
    )
      throw new Error("Terminal refund cannot change");
    await ctx.db.patch(row._id, {
      status: args.status,
      providerRefundId: args.providerRefundId ?? row.providerRefundId,
      updatedAt: Date.now(),
    });
    await appendAuditLog(ctx, {
      actorType: "operator",
      action: "payment.refund.observe",
      targetType: "adminRefund",
      targetId: row._id,
      before: { status: row.status },
      after: { status: args.status, providerRefundId: args.providerRefundId },
    });
  },
});
export const refundIntents = internalQuery({
  args: { orderId: v.id("paymentOrders") },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "billing.write");
    return ctx.db
      .query("adminRefunds")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .order("desc")
      .take(100);
  },
});
export const resolveReview = mutation({
  args: { ...workspaceArgs, ...actionArgs },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "billing.write");
    validate(args.reason, args.requestId);
    if (
      !(await once(
        ctx,
        actor._id,
        args.requestId,
        JSON.stringify({ action: "payment.review.resolve", ...args }),
      ))
    )
      return;
    const state = await ctx.db
      .query("paymentWorkspaces")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (!state?.reviewReason) throw new Error("No payment review pending");
    if (state.environment !== (convexEnv("POLAR_ENVIRONMENT") ?? "sandbox"))
      throw new Error("Payment environment mismatch");
    const refunds = await ctx.db
      .query("adminRefunds")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(1001);
    if (
      refunds.length > 1000 ||
      refunds.some(
        (r) => !["succeeded", "failed", "canceled"].includes(r.status),
      )
    )
      throw new Error("Reconcile unresolved refunds before clearing review");
    for (const refund of refunds) {
      if (refund.status !== "succeeded") continue;
      const order = await ctx.db.get(refund.orderId);
      if (!order || order.refundedCents < refund.expectedRefundedCents)
        throw new Error(
          "Refresh provider order accounting before clearing review",
        );
    }
    const audit = await auditAccounting(ctx, args.workspaceId, 1000);
    if (!audit.consistent)
      throw new Error("Resolve accounting discrepancies first");
    await ctx.db.patch(state._id, { reviewReason: undefined });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "payment.review.resolve",
      targetType: "workspace",
      targetId: args.workspaceId,
      reason: args.reason,
      requestId: args.requestId,
      before: { reviewReason: state.reviewReason },
      after: { reviewReason: null },
    });
  },
});
export const reviews = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "billing.read");
    pageSize(args.paginationOpts.numItems);
    return ctx.db
      .query("paymentWorkspaces")
      .withIndex("by_review", (q) => q.gt("reviewReason", undefined))
      .paginate(args.paginationOpts);
  },
});
export const credit = mutation({
  args: { ...workspaceArgs, ...actionArgs, amountUsdMicros: v.number() },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "billing.write");
    validate(args.reason, args.requestId);
    if (
      !Number.isSafeInteger(args.amountUsdMicros) ||
      args.amountUsdMicros <= 0
    )
      throw new Error("Credit must be a positive integer in USD micros");
    if (
      !(await once(
        ctx,
        actor._id,
        args.requestId,
        JSON.stringify({ action: "billing.credit", ...args }),
      ))
    )
      return;
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (workspace.billingMode === "internal")
      throw new Error("Company-funded workspaces do not need account credits");
    const result = await appendLedgerEntry(ctx, {
      workspaceId: args.workspaceId,
      userId: workspace.ownerUserId,
      delta: args.amountUsdMicros,
      reason: "adjustment",
      requestId: `admin:${actor._id}:${args.requestId}`,
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "billing.credit",
      targetType: "workspace",
      targetId: args.workspaceId,
      requestId: args.requestId,
      reason: args.reason,
      after: {
        amountUsdMicros: args.amountUsdMicros,
        balanceAfter: result.balanceAfter,
      },
    });
  },
});
