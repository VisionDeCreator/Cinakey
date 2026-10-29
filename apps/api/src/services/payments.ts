import {
  WORKSPACE_MONTHLY_USD_MICROS,
  ADDITIONAL_SEAT_MONTHLY_USD_MICROS,
} from "@cinakey/shared";
import { webhooks, type models } from "@polar-sh/sdk/2026-10";
import { v } from "convex/values";
import type { Id } from "../../../../packages/backend/convex/_generated/dataModel";
import type { ActionCtx } from "../runtime/operation";
import { action, internalAction } from "../runtime/operation";
import { internal, api } from "../operations";
import {
  polarClient,
  polarConfiguration,
  polarRedirect,
} from "../config/polar";
import { subscriptionUsable } from "../../../../packages/backend/convex/lib/paymentAccess";

const workspaceArgs = { workspaceId: v.id("workspaces") };
const productFor = (amount: number) => {
  const p = polarConfiguration().products;
  if (amount === 10) return p.topup10;
  if (amount === 25) return p.topup25;
  if (amount === 50) return p.topup50;
  throw new Error("Choose a $10, $25 or $50 top-up");
};
const timestamp = (value: string | null | undefined) =>
  value ? Date.parse(value) : undefined;
function validTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error("Invalid Polar timestamp");
  return time;
}
export function validatePolarProduct(
  product: models.Product,
  kind: "subscription" | "topup",
  amountCents: number,
) {
  if (product.is_archived) throw new Error("Polar product is archived");
  const prices = product.prices.filter((p) => !p.is_archived);
  if (prices.length !== 1)
    throw new Error(
      "Configure exactly one active USD price on each Polar product",
    );
  const price = prices[0]!;
  if (price.price_currency !== "usd" || price.tax_behavior !== "exclusive")
    throw new Error("Configure USD prices with exclusive tax");
  if (kind === "subscription") {
    if (
      !product.is_recurring ||
      product.recurring_interval !== "month" ||
      product.recurring_interval_count !== 1 ||
      price.amount_type !== "seat_based"
    )
      throw new Error(
        "Workspace product must be a monthly seat-based subscription",
      );
    const tiers = price.seat_tiers;
    if (
      tiers.seat_tier_type !== "graduated" ||
      tiers.tiers.length !== 2 ||
      tiers.tiers[0]?.min_seats !== 1 ||
      tiers.tiers[0]?.max_seats !== 1 ||
      tiers.tiers[0]?.price_per_seat !==
        WORKSPACE_MONTHLY_USD_MICROS / 10_000 ||
      tiers.tiers[1]?.min_seats !== 2 ||
      tiers.tiers[1]?.max_seats != null ||
      tiers.tiers[1]?.price_per_seat !==
        ADDITIONAL_SEAT_MONTHLY_USD_MICROS / 10_000
    )
      throw new Error(
        "Configure graduated seats: first seat $29, remaining seats $15",
      );
  } else if (
    product.is_recurring ||
    price.amount_type !== "fixed" ||
    price.price_amount !== amountCents
  )
    throw new Error("Top-up product price does not match its USD amount");
}
export const configuration = action({
  args: {},
  handler: async (ctx) => {
    if (!(await ctx.runQuery(api.users.viewer, {})))
      throw new Error("Sign in first");
    const config = polarConfiguration();
    return { enabled: config.enabled, environment: config.environment };
  },
});
export const checkout = action({
  args: {
    ...workspaceArgs,
    kind: v.union(v.literal("subscription"), v.literal("topup")),
    seats: v.optional(v.number()),
    amountUsd: v.optional(v.number()),
    requestId: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const config = polarConfiguration();
    const client = polarClient();
    const context = await ctx.runQuery(internal.payments.ownerContext, {
      workspaceId: args.workspaceId,
    });
    if (!context.verified || !context.email)
      throw new Error("Verify your email before checkout");
    const seats =
      args.kind === "subscription" ? (args.seats ?? context.occupiedSeats) : 1;
    const amountCents =
      args.kind === "topup"
        ? (args.amountUsd ?? 0) * 100
        : WORKSPACE_MONTHLY_USD_MICROS / 10_000 +
          (ADDITIONAL_SEAT_MONTHLY_USD_MICROS / 10_000) * (seats - 1);
    const productId =
      args.kind === "subscription"
        ? config.products.subscription
        : productFor(args.amountUsd ?? 0);
    if (args.kind === "subscription" && !context.state?.subscriptionId) {
      const existing = await client.subscriptions.list({
        external_customer_id: args.workspaceId,
        limit: 100,
      });
      if (
        existing.items.some(
          (s) =>
            s.product_id === config.products.subscription &&
            !["canceled", "unpaid", "incomplete_expired"].includes(s.status),
        )
      )
        throw new Error(
          "A Polar subscription already exists. Refresh billing to synchronize it before starting another checkout",
        );
    }
    validatePolarProduct(
      await client.products.get(productId),
      args.kind,
      amountCents,
    );
    const { intent, fresh } = await ctx.runMutation(
      internal.payments.prepareCheckout,
      {
        workspaceId: args.workspaceId,
        environment: config.environment,
        kind: args.kind,
        seats,
        amountCents,
        productId,
        requestId: args.requestId,
      },
    );
    if (intent.state === "paid")
      throw new Error("This checkout has already been paid");
    if (intent.checkoutUrl && intent.expiresAt > Date.now())
      return { url: polarRedirect(intent.checkoutUrl) };
    if (!fresh)
      throw new Error(
        "Checkout creation is pending or uncertain. Use Resume checkout to reconcile it before trying again",
      );
    try {
      // A team customer can omit the globally unique customer email and identify its
      // billing owner as a member. This supports one email owning multiple workspaces.
      let customer;
      try {
        customer = await client.customers.getExternal(args.workspaceId);
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("statusCode" in error) ||
          error.statusCode !== 404
        )
          throw error; // The outer checkout boundary returns a sanitized recovery message.
        try {
          customer = await client.customers.create({
            type: "team",
            external_id: args.workspaceId,
            name: context.name,
            owner: { email: context.email, external_id: context.userId },
          });
        } catch {
          throw new Error(
            "Workspace billing identity could not be confirmed. Retry to recover it by workspace ID",
          );
        }
      }
      if (
        customer.type !== "team" ||
        customer.external_id !== args.workspaceId ||
        (context.state?.customerId && context.state.customerId !== customer.id)
      )
        throw new Error(
          "This workspace needs billing identity reconciliation before checkout",
        );
      const result = await client.checkouts.create({
        products: [productId],
        customer_id: customer.id,
        ...(args.kind === "subscription"
          ? { seats, min_seats: seats, max_seats: seats }
          : {}),
        allow_trial: false,
        allow_discount_codes: false,
        metadata: {
          cinakey_workspace: args.workspaceId,
          cinakey_intent: intent._id,
        },
        success_url: `${config.siteUrl}/billing/${args.workspaceId}?billing=returned`,
        return_url: `${config.siteUrl}/billing/${args.workspaceId}`,
      });
      const url = polarRedirect(result.url);
      await ctx.runMutation(internal.payments.finishCheckout, {
        id: intent._id,
        checkoutId: result.id,
        url,
        expiresAt: validTime(result.expires_at),
      });
      return { url };
    } catch {
      await ctx.runMutation(internal.payments.uncertainCheckout, {
        id: intent._id,
      });
      throw new Error(
        "Checkout could not be confirmed. Resume checkout before creating another payment",
      );
    }
  },
});
export const resumeCheckout = action({
  args: workspaceArgs,
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    const config = polarConfiguration();
    const client = polarClient();
    const intent = await ctx.runQuery(internal.payments.checkoutForOwner, {
      ...args,
      environment: config.environment,
    });
    if (!intent) return { url: null };
    if (intent.checkoutUrl) return { url: polarRedirect(intent.checkoutUrl) };
    // Recover an unknown POST outcome without issuing another checkout creation.
    const list = await client.checkouts.list({
      external_customer_id: args.workspaceId,
      limit: 100,
      sorting: ["-created_at"],
    });
    const matches = list.items.filter(
      (c) => c.metadata.cinakey_intent === intent._id,
    );
    if (matches.length !== 1)
      throw new Error(
        "Checkout needs reconciliation in Polar. No new charge was started",
      );
    const checkout = matches[0]!;
    const url = polarRedirect(checkout.url);
    await ctx.runMutation(internal.payments.finishCheckout, {
      id: intent._id,
      checkoutId: checkout.id,
      url,
      expiresAt: validTime(checkout.expires_at),
    });
    return { url };
  },
});
export const portal = action({
  args: workspaceArgs,
  handler: async (ctx, args): Promise<{ url: string }> => {
    const client = polarClient();
    const config = polarConfiguration();
    const { state, userId } = await ctx.runQuery(
      internal.payments.ownerContext,
      args,
    );
    if (!state?.customerId || state.environment !== config.environment)
      throw new Error("No Polar customer is linked to this workspace");
    const session = await client.customerSessions.create({
      customer_id: state.customerId,
      external_member_id: userId,
      return_url: `${config.siteUrl}/billing/${args.workspaceId}`,
    });
    return { url: polarRedirect(session.customer_portal_url) };
  },
});
export const changeSeats = action({
  args: { ...workspaceArgs, seats: v.number() },
  handler: async (ctx, args): Promise<{ scheduled: boolean }> => {
    const client = polarClient();
    const config = polarConfiguration();
    const context = await ctx.runQuery(internal.payments.ownerContext, {
      workspaceId: args.workspaceId,
    });
    const state = context.state;
    if (
      !state?.subscriptionId ||
      state.environment !== config.environment ||
      !subscriptionUsable(state)
    )
      throw new Error("An active paid subscription is required");
    if (
      !Number.isSafeInteger(args.seats) ||
      args.seats < context.occupiedSeats ||
      args.seats > 100
    )
      throw new Error(
        "Seat quantity must cover current members and be at most 100",
      );
    if (args.seats === state.seats)
      throw new Error("Seat quantity is unchanged");
    try {
      const result = await client.subscriptions.update(state.subscriptionId, {
        seats: args.seats,
        proration_behavior:
          args.seats > state.seats ? "invoice" : "next_period",
      });
      await syncSubscription(ctx, result);
      return { scheduled: args.seats < state.seats };
    } catch {
      throw new Error(
        "Seat change could not be confirmed. Refresh billing before trying again; extra seats activate only after payment confirmation",
      );
    }
  },
});
async function resolveBinding(
  ctx: ActionCtx,
  data: {
    customer_id: string;
    checkout_id?: string | null;
    customer: { external_id?: string | null };
    metadata: Record<string, unknown>;
  },
) {
  const config = polarConfiguration();
  const intentId =
    typeof data.metadata.cinakey_intent === "string"
      ? (data.metadata.cinakey_intent as Id<"paymentCheckouts">)
      : undefined;
  if (!data.customer.external_id) return null;
  return ctx.runQuery(internal.payments.binding, {
    environment: config.environment,
    customerId: data.customer_id,
    externalId: data.customer.external_id,
    checkoutId: data.checkout_id ?? undefined,
    intentId,
  });
}
async function syncSubscription(ctx: ActionCtx, sub: models.Subscription) {
  const config = polarConfiguration();
  if (sub.product_id !== config.products.subscription) return;
  if (
    sub.currency !== "usd" ||
    sub.recurring_interval !== "month" ||
    sub.recurring_interval_count !== 1
  )
    throw new Error("Unexpected subscription currency or interval");
  const bound = await resolveBinding(ctx, sub);
  if (!bound) return;
  if (
    bound.state?.subscriptionId &&
    bound.state.subscriptionId !== sub.id &&
    ["canceled", "unpaid", "incomplete_expired"].includes(sub.status)
  )
    return;
  await ctx.runMutation(internal.payments.applySubscription, {
    workspaceId: bound.workspaceId,
    environment: config.environment,
    customerId: sub.customer_id,
    subscriptionId: sub.id,
    status: sub.status,
    seats: sub.seats ?? 0,
    periodStart: validTime(sub.current_period_start),
    periodEnd: validTime(sub.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    pendingSeats: sub.pending_update?.seats ?? undefined,
    pastDueAt: timestamp(sub.past_due_at),
    providerUpdatedAt: validTime(sub.modified_at ?? sub.created_at),
  });
}
export async function syncOrder(
  ctx: ActionCtx,
  order: models.Order,
  receiptSeats?: number,
) {
  const config = polarConfiguration();
  const client = polarClient();
  const product = order.product_id;
  if (!product || !Object.values(config.products).includes(product)) return;
  const kind =
    product === config.products.subscription ? "subscription" : "topup";
  if (order.currency !== "usd")
    throw new Error("Only USD orders can fund a workspace");
  if (kind === "subscription") {
    if (!order.subscription_id)
      throw new Error("Subscription order is missing its subscription");
    await syncSubscription(
      ctx,
      await client.subscriptions.get(order.subscription_id),
    );
  }
  const bound = await resolveBinding(ctx, order);
  if (!bound) return;
  const intentId =
    typeof order.metadata.cinakey_intent === "string"
      ? (order.metadata.cinakey_intent as Id<"paymentCheckouts">)
      : undefined;
  const topup =
    product === config.products.topup10
      ? 10_000_000
      : product === config.products.topup25
        ? 25_000_000
        : 50_000_000;
  const isCycle = ["subscription_create", "subscription_cycle"].includes(
    order.billing_reason,
  );
  const lines = order.items.filter(
    (i) => (!isCycle || !i.proration) && i.start_timestamp && i.end_timestamp,
  );
  const start = lines[0]?.start_timestamp;
  const end = lines[0]?.end_timestamp;
  if (
    lines.some(
      (i) =>
        i.end_timestamp !== end || (isCycle && i.start_timestamp !== start),
    )
  )
    throw new Error("Ambiguous order billing period");
  // Full monthly invoices encode the graduated quantity in their pre-discount subtotal.
  // A proration does not: only its signed order.paid receipt can authorize more seats.
  const inferredSeats =
    1 +
    (order.subtotal_amount - WORKSPACE_MONTHLY_USD_MICROS / 10_000) /
      (ADDITIONAL_SEAT_MONTHLY_USD_MICROS / 10_000);
  const seats =
    isCycle &&
    Number.isSafeInteger(inferredSeats) &&
    inferredSeats >= 1 &&
    inferredSeats <= 100
      ? inferredSeats
      : receiptSeats;
  await ctx.runMutation(internal.payments.applyOrder, {
    workspaceId: bound.workspaceId,
    environment: config.environment,
    orderId: order.id,
    checkoutId: order.checkout_id ?? undefined,
    customerId: order.customer_id,
    subscriptionId: order.subscription_id ?? undefined,
    intentId,
    kind,
    netCents: order.net_amount,
    refundedCents: order.refunded_amount,
    paid: order.paid,
    createdAt: validTime(order.created_at),
    billingReason: order.billing_reason,
    seats,
    periodStart: start ? validTime(start) : undefined,
    periodEnd: end ? validTime(end) : undefined,
    topupUsdMicros: kind === "topup" ? topup : undefined,
  });
}
export const processEvent = internalAction({
  args: { eventId: v.id("paymentEvents") },
  handler: async (ctx, { eventId }): Promise<void> => {
    const config = polarConfiguration();
    const client = polarClient();
    const event = await ctx.runQuery(internal.payments.event, { eventId });
    if (!event || event.processedAt) return;
    if (event.environment !== config.environment)
      throw new Error("Payment event environment mismatch");
    try {
      if (event.eventType.startsWith("order."))
        await syncOrder(
          ctx,
          await client.orders.get(event.objectId),
          event.paidSeats,
        );
      else if (event.eventType.startsWith("subscription."))
        await syncSubscription(
          ctx,
          await client.subscriptions.get(event.objectId),
        );
      await ctx.runMutation(internal.payments.completeEvent, { eventId });
    } catch {
      throw new Error(
        "Polar reconciliation failed. Review this payment event and retry",
      );
    }
  },
});
export const refresh = action({
  args: workspaceArgs,
  handler: async (ctx, args): Promise<void> => {
    const config = polarConfiguration();
    const client = polarClient();
    const { state } = await ctx.runQuery(internal.payments.ownerContext, args);
    if (!state?.customerId) {
      const subscriptions = await client.subscriptions.list({
        external_customer_id: args.workspaceId,
        limit: 100,
      });
      for (const sub of subscriptions.items)
        if (sub.product_id === config.products.subscription)
          await syncSubscription(ctx, sub);
      const orders = await client.orders.list({
        external_customer_id: args.workspaceId,
        limit: 100,
        sorting: ["-created_at"],
      });
      for (const order of orders.items) await syncOrder(ctx, order);
      return;
    }
    if (state.environment !== config.environment)
      throw new Error("Payment environment mismatch");
    if (state.subscriptionId)
      await syncSubscription(
        ctx,
        await client.subscriptions.get(state.subscriptionId),
      );
    // Recover missed deliveries, bounded for an interactive owner request. Webhook tasks remain authoritative for older orders.
    const orders = await client.orders.list({
      customer_id: state.customerId,
      limit: 100,
      sorting: ["-created_at"],
    });
    for (const order of orders.items) await syncOrder(ctx, order);
  },
});
export async function polarWebhook(
  ctx: ActionCtx,
  request: Request,
  body: Uint8Array,
): Promise<Response> {
  const config = polarConfiguration();
  if (!config.enabled)
    return new Response("Payments disabled", { status: 503 });
  let event;
  try {
    event = await webhooks.validateEvent(
      body,
      {
        "webhook-id": request.headers.get("webhook-id") ?? "",
        "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
        "webhook-signature": request.headers.get("webhook-signature") ?? "",
      },
      process.env.POLAR_WEBHOOK_SECRET!,
    );
  } catch (error) {
    if (error instanceof webhooks.PolarWebhookUnknownTypeError)
      return new Response(null, { status: 202 });
    return new Response("Invalid webhook signature or payload", {
      status: 403,
    });
  }
  if (
    !event.type.startsWith("order.") &&
    !event.type.startsWith("subscription.")
  )
    return new Response(null, { status: 202 });
  await ctx.runMutation(internal.payments.receiveEvent, {
    environment: config.environment,
    eventId: request.headers.get("webhook-id")!,
    eventType: event.type,
    objectId: event.data.id,
    ...(event.type === "order.paid" && event.data.subscription?.seats
      ? { paidSeats: event.data.subscription.seats }
      : {}),
  });
  return new Response(null, { status: 202 });
}
