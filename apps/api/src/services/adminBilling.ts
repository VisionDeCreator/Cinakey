import { paymentMetadata } from "./paymentMetadata";
import { v } from "convex/values";
import { action } from "../runtime/operation";
import { internal } from "../operations";
import { polarClient, polarConfiguration } from "../config/polar";
import { syncOrder } from "./payments";
const args = { orderId: v.id("paymentOrders") };
export const refund = action({
  args: {
    ...args,
    amountCents: v.number(),
    reason: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const order = await ctx.runQuery(internal.adminBilling.refundContext, {
      orderId: args.orderId,
    });
    if (order.environment !== polarConfiguration().environment)
      throw new Error("Payment environment mismatch");
    const client = polarClient();
    const authoritative = await client.orders.get(order.orderId);
    if (
      authoritative.id !== order.orderId ||
      authoritative.currency !== "usd" ||
      !authoritative.paid
    )
      throw new Error("Order is not refundable");
    await syncOrder(ctx, authoritative);
    const refunds = await client.refunds.list({
      order_id: order.orderId,
      limit: 100,
    });
    if (
      refunds.items.length >= 100 ||
      refunds.items.some(
        (r) => !["succeeded", "failed", "canceled"].includes(r.status),
      )
    )
      throw new Error("Reconcile existing provider refunds first");
    const intent = await ctx.runMutation(
      internal.adminBilling.prepareRefund,
      args,
    );
    if (!intent.dispatch)
      return { status: "already requested; reconcile to check outcome" };
    let receipt;
    try {
      // One dispatch only. Ambiguous transport failures are never retried automatically.
      receipt = await client.refunds.create({
        order_id: order.orderId,
        amount: args.amountCents,
        reason: "customer_request",
        comment: args.reason,
        metadata: { dirrio_refund: intent.id },
      });
    } catch {
      await ctx.runMutation(internal.adminBilling.recordRefund, {
        refundId: intent.id,
        status: "uncertain",
      });
      return { status: "uncertain; reconcile before taking further action" };
    }
    if (
      receipt.order_id !== order.orderId ||
      receipt.amount !== args.amountCents ||
      receipt.currency !== "usd"
    ) {
      await ctx.runMutation(internal.adminBilling.recordRefund, {
        refundId: intent.id,
        status: "uncertain",
      });
      return { status: "uncertain; provider receipt requires investigation" };
    }
    await ctx.runMutation(internal.adminBilling.recordRefund, {
      refundId: intent.id,
      status: receipt.status,
      providerRefundId: receipt.id,
    });
    await syncOrder(ctx, await client.orders.get(order.orderId));
    return { status: receipt.status };
  },
});
export const reconcileRefunds = action({
  args,
  handler: async (ctx, args): Promise<{ matched: number }> => {
    const order = await ctx.runQuery(internal.adminBilling.refundContext, args);
    if (order.environment !== polarConfiguration().environment)
      throw new Error("Payment environment mismatch");
    const client = polarClient();
    const refunds = await client.refunds.list({
      order_id: order.orderId,
      limit: 100,
    });
    const intents = await ctx.runQuery(
      internal.adminBilling.refundIntents,
      args,
    );
    let matched = 0;
    for (const intent of intents) {
      const matches = refunds.items.filter(
        (r) =>
          r.order_id === order.orderId &&
          (r.id === intent.providerRefundId ||
            paymentMetadata(r.metadata, "refund") === intent._id),
      );
      if (matches.length !== 1) continue;
      const receipt = matches[0]!;
      if (receipt.amount !== intent.amountCents || receipt.currency !== "usd")
        continue;
      await ctx.runMutation(internal.adminBilling.recordRefund, {
        refundId: intent._id,
        status: receipt.status,
        providerRefundId: receipt.id,
      });
      matched++;
    }
    // Absence from this bounded provider page is never evidence that a request failed.
    await syncOrder(ctx, await client.orders.get(order.orderId));
    return { matched };
  },
});
