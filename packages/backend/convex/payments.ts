import { convexEnv } from "./lib/env";
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  requireUser,
  requireWorkspaceMembership,
  requireProjectWrite,
  workspaceRole,
} from "./lib/access";
import {
  productionEntitlement,
  occupiedSeats,
  paymentState,
  subscriptionUsable,
} from "./lib/paymentAccess";
import { appendLedgerEntry } from "./lib/ledger";
import { expireFunding } from "./lib/funding";
import { appendAuditLog } from "./lib/audit";
import { assertRateLimit } from "./lib/rateLimit";
import { enqueueTask } from "./tasks";
const environment = v.union(v.literal("sandbox"), v.literal("production"));
const workspaceArgs = { workspaceId: v.id("workspaces") };
const checkoutKind = v.union(v.literal("subscription"), v.literal("topup"));
async function owner(
  ctx: Parameters<typeof requireUser>[0],
  workspaceId: Id<"workspaces">,
) {
  const user = await requireUser(ctx);
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.ownerUserId !== user._id)
    throw new Error("Only the workspace owner can manage payments");
  if (workspace.billingMode === "internal")
    throw new Error("Company-funded workspaces do not accept payments");
  return { user, workspace };
}
export const summary = query({
  args: workspaceArgs,
  handler: async (ctx, { workspaceId }) => {
    const user = await requireUser(ctx);
    const role = await workspaceRole(ctx, workspaceId, user._id);
    if (role !== "owner" && role !== "admin")
      throw new Error("Workspace billing access denied");
    const state = await paymentState(ctx, workspaceId);
    const pools = await ctx.db
      .query("fundingPools")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const orders = await ctx.db
      .query("paymentOrders")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(20);
    return {
      billingMode: (await ctx.db.get(workspaceId))?.billingMode ?? "paid",
      isOwner: role === "owner",
      state,
      occupiedSeats: await occupiedSeats(ctx, workspaceId),
      usable: subscriptionUsable(state),
      includedAvailable: pools
        .filter(
          (p) =>
            p.kind === "included" &&
            !p.revoked &&
            (p.expiresAt ?? 0) > Date.now(),
        )
        .reduce((n, p) => n + p.remaining, 0),
      purchasedAvailable: pools
        .filter((p) => p.kind === "purchased" && !p.revoked)
        .reduce((n, p) => n + p.remaining, 0),
      orders,
    };
  },
});
export const ownerContext = internalQuery({
  args: workspaceArgs,
  handler: async (ctx, { workspaceId }) => {
    const { user, workspace } = await owner(ctx, workspaceId);
    return {
      userId: user._id,
      email: user.email,
      verified: user.emailVerificationTime !== undefined,
      name: workspace.name,
      state: await paymentState(ctx, workspaceId),
      occupiedSeats: await occupiedSeats(ctx, workspaceId),
    };
  },
});
export const prepareCheckout = internalMutation({
  args: {
    ...workspaceArgs,
    environment,
    requestId: v.string(),
    kind: checkoutKind,
    productId: v.string(),
    seats: v.number(),
    amountCents: v.number(),
  },
  handler: async (ctx, args) => {
    const { user } = await owner(ctx, args.workspaceId);
    if (user.emailVerificationTime === undefined)
      throw new Error("Verify your email before checkout");
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(args.requestId))
      throw new Error("Invalid payment request ID");
    if (!Number.isSafeInteger(args.seats) || args.seats < 1 || args.seats > 100)
      throw new Error("Seats must be between 1 and 100");
    const prior = await ctx.db
      .query("paymentCheckouts")
      .withIndex("by_request", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("requestId", args.requestId),
      )
      .unique();
    if (prior) {
      if (
        prior.kind !== args.kind ||
        prior.productId !== args.productId ||
        prior.seats !== args.seats ||
        prior.amountCents !== args.amountCents ||
        prior.environment !== args.environment
      )
        throw new Error("Payment request mismatch");
      return { intent: prior, fresh: false };
    }
    await assertRateLimit(ctx, `checkout:${user._id}`, 10, 3600_000);
    const state = await paymentState(ctx, args.workspaceId);
    if (state && state.environment !== args.environment)
      throw new Error(
        "Use a separate workspace for sandbox and production billing",
      );
    if (args.kind === "subscription") {
      if (
        state?.subscriptionId &&
        !["canceled", "unpaid", "incomplete_expired"].includes(state.status)
      )
        throw new Error(
          "Manage the existing subscription instead of starting another",
        );
      if (args.seats < (await occupiedSeats(ctx, args.workspaceId)))
        throw new Error(
          "Buy enough seats for the current Owner, Admins and Creators",
        );
    } else if (!state?.subscriptionId || !subscriptionUsable(state))
      throw new Error("Activate a workspace subscription before buying usage");
    const pending = await ctx.db
      .query("paymentCheckouts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    if (
      pending.some(
        (p) =>
          p.kind === args.kind &&
          p.state !== "paid" &&
          p.expiresAt > Date.now(),
      )
    )
      throw new Error(
        "A checkout is already open. Reuse that checkout or wait for it to expire",
      );
    const id = await ctx.db.insert("paymentCheckouts", {
      ...args,
      userId: user._id,
      state: "creating",
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400_000,
    });
    return { intent: (await ctx.db.get(id))!, fresh: true };
  },
});
export const finishCheckout = internalMutation({
  args: {
    id: v.id("paymentCheckouts"),
    checkoutId: v.string(),
    url: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Checkout not found");
    if (row.checkoutId && row.checkoutId !== args.checkoutId)
      throw new Error("Checkout binding mismatch");
    await ctx.db.patch(row._id, {
      checkoutId: args.checkoutId,
      checkoutUrl: args.url,
      expiresAt: args.expiresAt,
      state: row.state === "paid" ? "paid" : "ready",
    });
  },
});
export const uncertainCheckout = internalMutation({
  args: { id: v.id("paymentCheckouts") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (row?.state === "creating")
      await ctx.db.patch(id, { state: "uncertain" });
  },
});
export const checkoutForOwner = internalQuery({
  args: { ...workspaceArgs, environment },
  handler: async (ctx, args) => {
    await owner(ctx, args.workspaceId);
    return (
      (
        await ctx.db
          .query("paymentCheckouts")
          .withIndex("by_workspace", (q) =>
            q.eq("workspaceId", args.workspaceId),
          )
          .order("desc")
          .take(30)
      ).find(
        (p) =>
          p.environment === args.environment &&
          p.state !== "paid" &&
          p.expiresAt > Date.now(),
      ) ?? null
    );
  },
});
export const receiveEvent = internalMutation({
  args: {
    environment,
    eventId: v.string(),
    eventType: v.string(),
    paidSeats: v.optional(v.number()),
    objectId: v.string(),
  },
  handler: async (ctx, args) => {
    const prior = await ctx.db
      .query("paymentEvents")
      .withIndex("by_event", (q) =>
        q.eq("environment", args.environment).eq("eventId", args.eventId),
      )
      .unique();
    if (prior) {
      if (
        prior.objectId !== args.objectId ||
        prior.eventType !== args.eventType
      )
        throw new Error("Webhook ID mismatch");
      if (prior.processedAt === undefined) {
        const task = prior.taskId ? await ctx.db.get(prior.taskId) : null;
        if (!task || task.state === "failed") {
          const taskId = await enqueueTask(ctx, 0, "payments:processEvent", {
            eventId: prior._id,
          });
          await ctx.db.patch(prior._id, { taskId });
        }
      }
      return;
    }
    const eventId = await ctx.db.insert("paymentEvents", {
      ...args,
      receivedAt: Date.now(),
    });
    const taskId = await enqueueTask(ctx, 0, "payments:processEvent", {
      eventId,
    });
    await ctx.db.patch(eventId, { taskId });
  },
});
export const event = internalQuery({
  args: { eventId: v.id("paymentEvents") },
  handler: (ctx, { eventId }) => ctx.db.get(eventId),
});
export const completeEvent = internalMutation({
  args: { eventId: v.id("paymentEvents") },
  handler: async (ctx, { eventId }) => {
    await ctx.db.patch(eventId, { processedAt: Date.now() });
  },
});
export const binding = internalQuery({
  args: {
    environment,
    customerId: v.string(),
    externalId: v.string(),
    checkoutId: v.optional(v.string()),
    intentId: v.optional(v.id("paymentCheckouts")),
  },
  handler: async (ctx, args) => {
    const workspaceId = ctx.db.normalizeId("workspaces", args.externalId);
    if (!workspaceId) return null;
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) return null;
    const state = await paymentState(ctx, workspaceId);
    if (state) {
      if (
        state.environment !== args.environment ||
        state.customerId !== args.customerId
      )
        throw new Error("Polar customer/workspace mismatch");
      return { workspaceId, state, intent: null };
    }
    const intent = args.intentId ? await ctx.db.get(args.intentId) : null;
    if (
      !intent ||
      intent.workspaceId !== workspaceId ||
      intent.environment !== args.environment ||
      intent.kind !== "subscription" ||
      (intent.checkoutId !== undefined && intent.checkoutId !== args.checkoutId)
    )
      return null;
    return { workspaceId, state: null, intent };
  },
});
export const applySubscription = internalMutation({
  args: {
    ...workspaceArgs,
    environment,
    customerId: v.string(),
    subscriptionId: v.string(),
    status: v.string(),
    seats: v.number(),
    periodStart: v.number(),
    periodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
    pendingSeats: v.optional(v.number()),
    pastDueAt: v.optional(v.number()),
    providerUpdatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    const state = await paymentState(ctx, args.workspaceId);
    if (
      state &&
      (state.environment !== args.environment ||
        state.customerId !== args.customerId)
    )
      throw new Error("Customer binding mismatch");
    if (
      state?.subscriptionId &&
      state.subscriptionId !== args.subscriptionId &&
      !["canceled", "unpaid", "incomplete_expired"].includes(state.status)
    )
      throw new Error("Multiple subscriptions require operator review");
    if (
      state?.subscriptionId === args.subscriptionId &&
      state.providerUpdatedAt > args.providerUpdatedAt
    )
      return;
    if (
      !Number.isSafeInteger(args.seats) ||
      args.seats < 1 ||
      args.seats > 100 ||
      args.periodEnd <= args.periodStart
    )
      throw new Error("Invalid subscription snapshot");
    const same = state?.subscriptionId === args.subscriptionId;
    const next = {
      ...args,
      paidSeats: same ? state.paidSeats : 0,
      paidPeriodEnd: same ? state.paidPeriodEnd : 0,
      paidOrderAt: same ? state.paidOrderAt : 0,
      pastDueAt:
        args.status === "past_due"
          ? (args.pastDueAt ??
            (same ? state.pastDueAt : undefined) ??
            args.periodStart)
          : undefined,
    };
    if (state) await ctx.db.patch(state._id, next);
    else await ctx.db.insert("paymentWorkspaces", next);
  },
});
async function fund(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  key: string,
  amount: number,
  kind: "purchased" | "included",
  expiresAt?: number,
) {
  const prior = await ctx.db
    .query("fundingPools")
    .withIndex("by_key", (q) => q.eq("workspaceId", workspaceId).eq("key", key))
    .unique();
  if (prior) return prior;
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) throw new Error("Workspace not found");
  await appendLedgerEntry(ctx, {
    workspaceId,
    userId: workspace.ownerUserId,
    reason: "grant",
    delta: amount,
    requestId: key,
  });
  const id = await ctx.db.insert("fundingPools", {
    workspaceId,
    key,
    kind,
    granted: amount,
    remaining: amount,
    held: 0,
    expiresAt,
    createdAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}
export const applyOrder = internalMutation({
  args: {
    ...workspaceArgs,
    environment,
    orderId: v.string(),
    checkoutId: v.optional(v.string()),
    customerId: v.string(),
    subscriptionId: v.optional(v.string()),
    intentId: v.optional(v.id("paymentCheckouts")),
    kind: checkoutKind,
    netCents: v.number(),
    refundedCents: v.number(),
    paid: v.boolean(),
    createdAt: v.number(),
    billingReason: v.string(),
    seats: v.optional(v.number()),
    periodStart: v.optional(v.number()),
    periodEnd: v.optional(v.number()),
    topupUsdMicros: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const state = await paymentState(ctx, args.workspaceId);
    const workspace = await ctx.db.get(args.workspaceId);
    if (
      !state ||
      !workspace ||
      state.environment !== args.environment ||
      state.customerId !== args.customerId
    )
      throw new Error("Unbound payment customer");
    for (const n of [
      args.netCents,
      args.refundedCents,
      args.topupUsdMicros ?? 0,
    ])
      if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000_000)
        throw new Error("Invalid order amount");
    let row = await ctx.db
      .query("paymentOrders")
      .withIndex("by_order", (q) =>
        q.eq("environment", args.environment).eq("orderId", args.orderId),
      )
      .unique();
    if (
      row &&
      (row.workspaceId !== args.workspaceId ||
        row.kind !== args.kind ||
        row.subscriptionId !== args.subscriptionId ||
        row.netCents !== args.netCents)
    )
      throw new Error("Order binding mismatch");
    if (!args.paid) return;
    if (args.kind === "topup") {
      const intent = args.intentId ? await ctx.db.get(args.intentId) : null;
      if (
        !intent ||
        intent.workspaceId !== args.workspaceId ||
        intent.environment !== args.environment ||
        intent.kind !== "topup" ||
        (intent.checkoutId !== undefined &&
          intent.checkoutId !== args.checkoutId) ||
        (intent.fundedOrderId !== undefined &&
          intent.fundedOrderId !== args.orderId) ||
        intent.amountCents !== args.netCents ||
        args.topupUsdMicros !== args.netCents * 10_000
      )
        throw new Error("Top-up does not match the approved checkout");
    } else if (state.subscriptionId !== args.subscriptionId && !row)
      throw new Error("Subscription order mismatch");
    if (!row) {
      let pool;
      let granted = 0;
      if (args.kind === "topup") {
        granted = args.topupUsdMicros!;
        pool = await fund(
          ctx,
          args.workspaceId,
          `polar:${args.environment}:order:${args.orderId}`,
          granted,
          "purchased",
        );
      } else if (
        ["subscription_create", "subscription_cycle"].includes(
          args.billingReason,
        )
      ) {
        if (
          !args.periodStart ||
          !args.periodEnd ||
          args.periodEnd <= args.periodStart
        )
          throw new Error("Missing paid billing period");
        const key = `polar:${args.environment}:allowance:${args.subscriptionId}:${args.periodStart}`;
        const existing = await ctx.db
          .query("fundingPools")
          .withIndex("by_key", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("key", key),
          )
          .unique();
        pool =
          existing ??
          (await fund(
            ctx,
            args.workspaceId,
            key,
            5_000_000,
            "included",
            args.periodEnd,
          ));
        granted = existing ? 0 : 5_000_000;
      }
      const id = await ctx.db.insert("paymentOrders", {
        workspaceId: args.workspaceId,
        environment: args.environment,
        orderId: args.orderId,
        subscriptionId: args.subscriptionId,
        kind: args.kind,
        netCents: args.netCents,
        refundedCents: 0,
        grantedUsdMicros: granted,
        reversedUsdMicros: 0,
        poolId: pool?._id,
        createdAt: args.createdAt,
      });
      row = (await ctx.db.get(id))!;
      if (args.intentId) {
        const intent = await ctx.db.get(args.intentId);
        if (intent?.workspaceId === args.workspaceId)
          await ctx.db.patch(intent._id, {
            state: "paid",
            ...(args.kind === "topup" ? { fundedOrderId: args.orderId } : {}),
          });
      }
    }
    if (
      args.kind === "subscription" &&
      args.subscriptionId === state.subscriptionId &&
      args.seats &&
      args.periodEnd &&
      args.createdAt >= state.paidOrderAt &&
      args.periodEnd >= state.paidPeriodEnd
    ) {
      if (
        !Number.isSafeInteger(args.seats) ||
        args.seats < 1 ||
        args.seats > 100
      )
        throw new Error("Invalid paid seats");
      await ctx.db.patch(state._id, {
        paidSeats: args.seats,
        paidPeriodEnd: args.periodEnd,
        paidOrderAt: args.createdAt,
      });
    }
    // Refund snapshots are cumulative; older deliveries cannot undo a refund.
    const refunded = Math.max(
      row.refundedCents,
      Math.min(args.netCents, args.refundedCents),
    );
    const reversed =
      args.netCents === 0
        ? 0
        : Math.min(
            row.grantedUsdMicros,
            Math.ceil((row.grantedUsdMicros * refunded) / args.netCents),
          );
    const due = reversed - row.reversedUsdMicros;
    if (due > 0 && row.poolId) {
      const pool = await ctx.db.get(row.poolId);
      if (!pool) throw new Error("Funding pool missing");
      const remove = Math.min(pool.remaining, due);
      if (remove > 0)
        await appendLedgerEntry(ctx, {
          workspaceId: args.workspaceId,
          userId: workspace.ownerUserId,
          delta: -remove,
          reason: "funding_reversal",
          requestId: `polar:refund:${args.orderId}:${reversed}`,
        });
      await ctx.db.patch(pool._id, {
        remaining: pool.remaining - remove,
        revoked: refunded === args.netCents ? true : pool.revoked,
      });
      if (remove < due || (args.kind === "subscription" && refunded > 0))
        await ctx.db.patch(state._id, {
          reviewReason:
            "A refunded payment includes used or subscription funds. Operator review is required before further generation.",
        });
    }
    if (args.kind === "subscription" && refunded > 0)
      await ctx.db.patch(state._id, {
        reviewReason:
          "A subscription payment was refunded. Operator review is required.",
      });
    await ctx.db.patch(row._id, {
      refundedCents: refunded,
      reversedUsdMicros: reversed,
    });
    await expireFunding(ctx, args.workspaceId, workspace.ownerUserId);
  },
});
export const clearReview = internalMutation({
  args: { ...workspaceArgs, note: v.string() },
  handler: async (ctx, { workspaceId, note }) => {
    if (note.trim().length < 10)
      throw new Error("Record the reconciliation decision");
    const state = await paymentState(ctx, workspaceId);
    if (!state) return;
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) throw new Error("Workspace missing");
    await ctx.db.patch(state._id, { reviewReason: undefined });
    await appendAuditLog(ctx, {
      actorUserId: workspace.ownerUserId,
      action: "billing.review_resolved",
      targetId: workspaceId,
      meta: { note },
    });
  },
});
export const expireAllowances = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pools = await ctx.db
      .query("fundingPools")
      .withIndex("by_expiry", (q) =>
        q.gt("expiresAt", 0).lte("expiresAt", Date.now()),
      )
      .take(100);
    for (const pool of pools) {
      const workspace = await ctx.db.get(pool.workspaceId);
      if (workspace)
        await expireFunding(ctx, pool.workspaceId, workspace.ownerUserId);
      if (pool.held === 0)
        await ctx.db.patch(pool._id, { expiresAt: undefined, revoked: true });
    }
  },
});

export const deploymentEnvironment = internalQuery({
  args: {},
  handler: () => ({
    environment: convexEnv("POLAR_ENVIRONMENT") ?? "sandbox",
    mock: convexEnv("USE_MOCK_ADAPTERS") === "true",
    paywall: convexEnv("SUBSCRIPTION_PAYWALL_ENABLED") === "true",
  }),
});

export const entitlements = query({
  args: workspaceArgs,
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMembership(ctx, workspaceId);
    return productionEntitlement(ctx, workspaceId);
  },
});
export const assertProjectWrite = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProjectWrite(ctx, projectId);
    return true;
  },
});
