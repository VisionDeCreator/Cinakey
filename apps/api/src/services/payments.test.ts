import { beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { ActionCtx } from "../runtime/operation";
import { polarWebhook, validatePolarProduct } from "./payments";
import { polarConfiguration, polarRedirect } from "../config/polar";
import { api, internal } from "../operations";
import {
  authIdentity,
  createTestUser,
  makeTest,
} from "../../../../packages/backend/test/helpers";
import type { models } from "@polar-sh/sdk/2026-10";
import { safeErrorMessage } from "../providers/errors";

const mocks = vi.hoisted(() => ({
  product: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  portal: vi.fn(),
  update: vi.fn(),
  order: vi.fn(),
  subscription: vi.fn(),
  subscriptions: vi.fn(),
  orders: vi.fn(),
  customer: vi.fn(),
  createCustomer: vi.fn(),
}));
vi.mock("@polar-sh/sdk/2026-10", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@polar-sh/sdk/2026-10")>();
  return {
    ...actual,
    createPolar: () => ({
      products: { get: mocks.product },
      customers: { getExternal: mocks.customer, create: mocks.createCustomer },
      checkouts: { create: mocks.create, list: mocks.list },
      customerSessions: { create: mocks.portal },
      subscriptions: {
        get: mocks.subscription,
        list: mocks.subscriptions,
        update: mocks.update,
      },
      orders: { get: mocks.order, list: mocks.orders },
    }),
  };
});
const secretBytes = Buffer.from("cinakey-test-webhook-key-not-live");
const secret = `whsec_${secretBytes.toString("base64")}`;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("USE_MOCK_ADAPTERS", "false");
  vi.stubEnv("ALLOW_DEV_USD", "false");
  for (const [name, value] of Object.entries({
    POLAR_PAYMENTS_ENABLED: "true",
    POLAR_ENVIRONMENT: "sandbox",
    POLAR_ACCESS_TOKEN: "test-token",
    POLAR_WEBHOOK_SECRET: secret,
    POLAR_WORKSPACE_PRODUCT_ID: "subscription-product",
    POLAR_TOPUP_10_PRODUCT_ID: "topup-10",
    POLAR_TOPUP_25_PRODUCT_ID: "topup-25",
    POLAR_TOPUP_50_PRODUCT_ID: "topup-50",
    SITE_URL: "http://localhost:5173",
  }))
    vi.stubEnv(name, value);
  mocks.customer.mockRejectedValue(
    Object.assign(new Error("Customer not found"), { statusCode: 404 }),
  );
  mocks.createCustomer.mockImplementation(async (args) => ({
    id: "customer",
    type: "team",
    external_id: args.external_id,
  }));
  mocks.subscriptions.mockResolvedValue({ items: [] });
  mocks.product.mockResolvedValue(product());
  mocks.create.mockResolvedValue({
    id: "checkout",
    url: "https://sandbox.polar.sh/checkout/test",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });
});
function product() {
  return {
    is_archived: false,
    is_recurring: true,
    recurring_interval: "month",
    recurring_interval_count: 1,
    prices: [
      {
        is_archived: false,
        price_currency: "usd",
        tax_behavior: "exclusive",
        amount_type: "seat_based",
        seat_tiers: {
          seat_tier_type: "graduated",
          tiers: [
            { min_seats: 1, max_seats: 1, price_per_seat: 2900 },
            { min_seats: 2, max_seats: null, price_per_seat: 1500 },
          ],
        },
      },
    ],
  } as unknown as models.Product;
}
function signed(
  body: string,
  time = String(Math.floor(Date.now() / 1000)),
  id = "event-test",
) {
  const signature = createHmac("sha256", secretBytes)
    .update(`${id}.${time}.${body}`)
    .digest("base64");
  return new Request("https://api.cinakey.test/webhooks/polar", {
    method: "POST",
    body,
    headers: {
      "webhook-id": id,
      "webhook-timestamp": time,
      "webhook-signature": `v1,${signature}`,
    },
  });
}
async function fixture() {
  const t = makeTest();
  const userId = await createTestUser(t, "owner@polar.test");
  const owner = t.withIdentity(authIdentity(userId));
  const workspaceId = await owner.mutation(
    api.users.ensurePersonalWorkspace,
    {},
  );
  return { t, owner, workspaceId };
}
it("defaults disabled, rejects incomplete activation and requires HTTPS for production", () => {
  vi.stubEnv("POLAR_PAYMENTS_ENABLED", "false");
  vi.stubEnv("POLAR_ACCESS_TOKEN", "");
  expect(polarConfiguration().enabled).toBe(false);
  vi.stubEnv("POLAR_PAYMENTS_ENABLED", "true");
  expect(() => polarConfiguration()).toThrow("POLAR_ACCESS_TOKEN");
  vi.stubEnv("POLAR_ACCESS_TOKEN", "test-token");
  vi.stubEnv("POLAR_ENVIRONMENT", "production");
  expect(() => polarConfiguration()).toThrow("HTTPS");
});
it("validates the agreed subscription tiers and fixed top-up prices", () => {
  expect(() =>
    validatePolarProduct(product(), "subscription", 2900),
  ).not.toThrow();
  const bad = product();
  (bad.prices[0] as models.ProductPriceSeatBased).seat_tiers.seat_tier_type =
    "volume";
  expect(() => validatePolarProduct(bad, "subscription", 2900)).toThrow(
    "graduated",
  );
  const top = {
    ...product(),
    is_recurring: false,
    prices: [
      {
        amount_type: "fixed",
        price_currency: "usd",
        price_amount: 1000,
        tax_behavior: "exclusive",
        is_archived: false,
      },
    ],
  } as unknown as models.Product;
  expect(() => validatePolarProduct(top, "topup", 1000)).not.toThrow();
  expect(() => validatePolarProduct(top, "topup", 2500)).toThrow(
    "does not match",
  );
});
it("restricts redirects and redacts Polar secrets", () => {
  expect(() => polarRedirect("https://polar.sh.evil.test/checkout")).toThrow();
  expect(() => polarRedirect("javascript:alert(1)")).toThrow();
  expect(
    safeErrorMessage(
      new Error(`failed ${process.env.POLAR_ACCESS_TOKEN} ${secret}`),
    ),
  ).not.toContain(secret);
});
it("verifies actual Standard Webhooks signatures before durable admission; rejects tampering and stale signatures", async () => {
  const runMutation = vi.fn().mockResolvedValue(null);
  const ctx = { runMutation } as unknown as ActionCtx;
  const body = JSON.stringify({
    type: "order.paid",
    timestamp: new Date().toISOString(),
    data: { id: "order" },
  });
  const request = signed(body);
  expect(
    (await polarWebhook(ctx, request, new TextEncoder().encode(body))).status,
  ).toBe(202);
  expect(runMutation).toHaveBeenCalledWith(internal.payments.receiveEvent, {
    environment: "sandbox",
    eventId: "event-test",
    eventType: "order.paid",
    objectId: "order",
  });
  runMutation.mockClear();
  expect(
    (await polarWebhook(ctx, request, new TextEncoder().encode(body + " ")))
      .status,
  ).toBe(403);
  const stale = signed(body, String(Math.floor(Date.now() / 1000) - 3600));
  expect(
    (await polarWebhook(ctx, stale, new TextEncoder().encode(body))).status,
  ).toBe(403);
  expect(runMutation).not.toHaveBeenCalled();
});
it("acknowledges signed future event types and ignores unrelated events", async () => {
  const runMutation = vi.fn();
  const ctx = { runMutation } as unknown as ActionCtx;
  for (const type of ["future.event", "customer.updated"]) {
    const body = JSON.stringify({
      type,
      timestamp: new Date().toISOString(),
      data: { id: "id" },
    });
    expect(
      (await polarWebhook(ctx, signed(body), new TextEncoder().encode(body)))
        .status,
    ).toBe(202);
  }
  expect(runMutation).not.toHaveBeenCalled();
});
it("creates workspace-bound server-priced checkout and never grants funds from a return URL", async () => {
  const f = await fixture();
  const result = await f.owner.action(api.payments.checkout, {
    workspaceId: f.workspaceId,
    kind: "subscription",
    seats: 2,
    requestId: crypto.randomUUID(),
  });
  expect(result.url).toContain("sandbox.polar.sh");
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      customer_id: "customer",
      products: ["subscription-product"],
      seats: 2,
      min_seats: 2,
      max_seats: 2,
      allow_discount_codes: false,
      allow_trial: false,
      success_url: `http://localhost:5173/billing/${f.workspaceId}?billing=returned`,
      return_url: `http://localhost:5173/billing/${f.workspaceId}`,
    }),
  );
  expect(
    await f.t.run((ctx) => ctx.db.query("paymentOrders").collect()),
  ).toHaveLength(0);
  expect(
    await f.t.run((ctx) => ctx.db.query("paymentWorkspaces").collect()),
  ).toHaveLength(0);
});
it("recovers an unknown checkout outcome without another creation POST", async () => {
  const f = await fixture();
  const args = {
    workspaceId: f.workspaceId,
    kind: "subscription" as const,
    seats: 1,
    requestId: crypto.randomUUID(),
  };
  mocks.create.mockRejectedValue(new Error("network timeout"));
  await expect(f.owner.action(api.payments.checkout, args)).rejects.toThrow(
    "Resume checkout",
  );
  const intent = await f.t.run((ctx) =>
    ctx.db.query("paymentCheckouts").first(),
  );
  mocks.list.mockResolvedValue({
    items: [
      {
        id: "recovered",
        url: "https://sandbox.polar.sh/checkout/recovered",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        metadata: { cinakey_intent: intent!._id },
      },
    ],
  });
  expect(
    (
      await f.owner.action(api.payments.resumeCheckout, {
        workspaceId: f.workspaceId,
      })
    ).url,
  ).toContain("recovered");
  expect((await f.owner.action(api.payments.checkout, args)).url).toContain(
    "recovered",
  );
  expect(mocks.create).toHaveBeenCalledOnce();
});
it("blocks a non-owner before any checkout creation", async () => {
  const f = await fixture();
  const member = await createTestUser(f.t, "creator@polar.test");
  await expect(
    f.t.withIdentity(authIdentity(member)).action(api.payments.checkout, {
      workspaceId: f.workspaceId,
      kind: "subscription",
      requestId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("Only the workspace owner");
  expect(mocks.create).not.toHaveBeenCalled();
});
it("refetches the authoritative order on worker replay rather than trusting webhook amount data", async () => {
  const f = await fixture();
  await f.t.mutation(internal.payments.receiveEvent, {
    environment: "sandbox",
    eventId: "evt",
    eventType: "order.paid",
    objectId: "unknown-product-order",
  });
  const event = await f.t.run((ctx) => ctx.db.query("paymentEvents").first());
  mocks.order.mockResolvedValue({
    id: "unknown-product-order",
    product_id: "unrelated",
  });
  await f.t.action(internal.payments.processEvent, { eventId: event!._id });
  await f.t.action(internal.payments.processEvent, { eventId: event!._id });
  expect(mocks.order).toHaveBeenCalledOnce();
  expect(
    (await f.t.run((ctx) => ctx.db.get(event!._id)))?.processedAt,
  ).toBeTypeOf("number");
});

async function paidFixture() {
  const f = await fixture();
  await f.owner.action(api.payments.checkout, {
    workspaceId: f.workspaceId,
    kind: "subscription",
    seats: 2,
    requestId: crypto.randomUUID(),
  });
  const intent = await f.t.run((ctx) =>
    ctx.db.query("paymentCheckouts").first(),
  );
  const now = new Date().toISOString();
  const end = new Date(Date.now() + 28 * 86400_000).toISOString();
  const sub = {
    id: "sub",
    checkout_id: "checkout",
    product_id: "subscription-product",
    customer_id: "customer",
    customer: { external_id: f.workspaceId },
    metadata: { cinakey_intent: intent!._id },
    status: "active",
    currency: "usd",
    recurring_interval: "month",
    recurring_interval_count: 1,
    seats: 3,
    current_period_start: now,
    current_period_end: end,
    cancel_at_period_end: false,
    modified_at: now,
    created_at: now,
    pending_update: null,
  };
  const order = {
    id: "paid-sub-order",
    product_id: "subscription-product",
    customer_id: "customer",
    customer: { external_id: f.workspaceId },
    metadata: { cinakey_intent: intent!._id },
    subscription_id: "sub",
    subscription: sub,
    checkout_id: "checkout",
    subtotal_amount: 4400,
    net_amount: 4400,
    refunded_amount: 0,
    paid: true,
    currency: "usd",
    billing_reason: "subscription_create",
    created_at: now,
    items: [{ proration: false, start_timestamp: now, end_timestamp: end }],
  };
  mocks.subscription.mockResolvedValue(sub);
  mocks.subscriptions.mockResolvedValue({ items: [sub] });
  mocks.order.mockResolvedValue(order);
  mocks.orders.mockResolvedValue({ items: [order] });
  return { ...f, intent: intent!, sub, order, now, end };
}
it("runs signed paid/refund events through the durable worker and real ledger, without trusting mutable seat snapshots", async () => {
  const f = await paidFixture();
  const ctx = {
    runMutation: (
      ref: Parameters<typeof f.t.mutation>[0],
      args: Record<string, unknown>,
    ) => f.t.mutation(ref, args),
  } as unknown as ActionCtx;
  const paid = JSON.stringify({
    type: "order.paid",
    timestamp: f.now,
    data: f.order,
  });
  await polarWebhook(ctx, signed(paid), new TextEncoder().encode(paid));
  await f.t.finishAllScheduledFunctions(() => {});
  const summary = await f.owner.query(api.payments.summary, {
    workspaceId: f.workspaceId,
  });
  expect(summary.state?.paidSeats).toBe(2); // $44 invoice, even if nested subscription has since changed to 3.
  expect(summary.includedAvailable).toBe(5_000_000);
  mocks.product.mockResolvedValue({
    ...product(),
    is_recurring: false,
    prices: [
      {
        amount_type: "fixed",
        price_currency: "usd",
        price_amount: 1000,
        tax_behavior: "exclusive",
        is_archived: false,
      },
    ],
  });
  await f.owner.action(api.payments.checkout, {
    workspaceId: f.workspaceId,
    kind: "topup",
    amountUsd: 10,
    requestId: crypto.randomUUID(),
  });
  const topIntent = await f.t.run(async (ctx) =>
    (await ctx.db.query("paymentCheckouts").collect()).find(
      (p) => p.kind === "topup",
    ),
  );
  const top = {
    ...f.order,
    id: "paid-topup",
    product_id: "topup-10",
    subscription_id: null,
    subscription: null,
    metadata: { cinakey_intent: topIntent!._id },
    billing_reason: "purchase",
    subtotal_amount: 1000,
    net_amount: 1000,
    items: [],
  };
  mocks.order.mockResolvedValue(top);
  const topPaid = JSON.stringify({
    type: "order.paid",
    timestamp: f.now,
    data: top,
  });
  await polarWebhook(
    ctx,
    signed(topPaid, undefined, "event-top"),
    new TextEncoder().encode(topPaid),
  );
  await f.t.finishAllScheduledFunctions(() => {});
  expect((await f.owner.query(api.billing.getBalance, {})).balance).toBe(
    15_000_000,
  );
  mocks.order.mockResolvedValue({ ...top, refunded_amount: 1000 });
  const refunded = JSON.stringify({
    type: "order.refunded",
    timestamp: f.now,
    data: { id: top.id },
  });
  await polarWebhook(
    ctx,
    signed(refunded, undefined, "event-refund"),
    new TextEncoder().encode(refunded),
  );
  await f.t.finishAllScheduledFunctions(() => {});
  expect((await f.owner.query(api.billing.getBalance, {})).balance).toBe(
    5_000_000,
  );
  expect(
    (await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }))
      .consistent,
  ).toBe(true);
});
it("uses immediate invoice proration for increases and next-period changes for decreases", async () => {
  const f = await paidFixture();
  await f.owner.action(api.payments.refresh, { workspaceId: f.workspaceId });
  mocks.update.mockResolvedValue(f.sub);
  expect(
    await f.owner.action(api.payments.changeSeats, {
      workspaceId: f.workspaceId,
      seats: 4,
    }),
  ).toEqual({ scheduled: false });
  expect(mocks.update).toHaveBeenCalledWith("sub", {
    seats: 4,
    proration_behavior: "invoice",
  });
  expect(
    (await f.owner.query(api.payments.summary, { workspaceId: f.workspaceId }))
      .state?.paidSeats,
  ).toBe(2);
  mocks.update.mockResolvedValue({ ...f.sub, pending_update: { seats: 1 } });
  expect(
    await f.owner.action(api.payments.changeSeats, {
      workspaceId: f.workspaceId,
      seats: 1,
    }),
  ).toEqual({ scheduled: true });
  expect(mocks.update).toHaveBeenLastCalledWith("sub", {
    seats: 1,
    proration_behavior: "next_period",
  });
});
it("rejects a duplicate checkout while a remote subscription is waiting for reconciliation", async () => {
  const f = await fixture();
  mocks.subscriptions.mockResolvedValue({
    items: [{ product_id: "subscription-product", status: "active" }],
  });
  await expect(
    f.owner.action(api.payments.checkout, {
      workspaceId: f.workspaceId,
      kind: "subscription",
      requestId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("already exists");
  expect(mocks.create).not.toHaveBeenCalled();
});
it("bounds paid access to invoice line periods rather than a mutable subscription renewal date", async () => {
  const f = await paidFixture();
  await f.owner.action(api.payments.refresh, { workspaceId: f.workspaceId });
  const state = (
    await f.owner.query(api.payments.summary, { workspaceId: f.workspaceId })
  ).state!;
  expect(state.paidPeriodEnd).toBe(Date.parse(f.end));
  mocks.subscription.mockResolvedValue({
    ...f.sub,
    current_period_start: f.end,
    current_period_end: new Date(
      Date.parse(f.end) + 28 * 86400_000,
    ).toISOString(),
    modified_at: new Date(Date.now() + 1000).toISOString(),
  });
  mocks.order.mockResolvedValue({
    ...f.order,
    id: "late-proration",
    billing_reason: "subscription_update",
    subtotal_amount: 500,
    net_amount: 500,
    created_at: new Date(Date.now() + 1).toISOString(),
    items: [{ proration: true, start_timestamp: f.now, end_timestamp: f.end }],
  });
  await f.t.mutation(internal.payments.receiveEvent, {
    environment: "sandbox",
    eventId: "late",
    eventType: "order.paid",
    objectId: "late-proration",
    paidSeats: 3,
  });
  await f.t.finishAllScheduledFunctions(() => {});
  expect(
    (await f.owner.query(api.payments.summary, { workspaceId: f.workspaceId }))
      .state?.paidPeriodEnd,
  ).toBe(state.paidPeriodEnd);
});
it("creates distinct team billing identities for workspaces with the same owner email", async () => {
  const f = await fixture();
  mocks.createCustomer.mockImplementation(async (args) => ({
    id: `team-${args.external_id}`,
    type: "team",
    external_id: args.external_id,
  }));
  await f.owner.action(api.payments.checkout, {
    workspaceId: f.workspaceId,
    kind: "subscription",
    requestId: crypto.randomUUID(),
  });
  const other = await f.t.run(async (ctx) => {
    const user = await ctx.db.get(
      (await ctx.db.get(f.workspaceId))!.ownerUserId,
    );
    return ctx.db.insert("workspaces", {
      name: "Other workspace",
      ownerUserId: user!._id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  await f.owner.action(api.payments.checkout, {
    workspaceId: other,
    kind: "subscription",
    requestId: crypto.randomUUID(),
  });
  expect(mocks.createCustomer).toHaveBeenCalledTimes(2);
  expect(
    mocks.createCustomer.mock.calls.map(([args]) => args.external_id),
  ).toEqual([f.workspaceId, other]);
  for (const [args] of mocks.createCustomer.mock.calls) {
    expect(args).toMatchObject({
      type: "team",
      owner: { email: "owner@polar.test" },
    });
    expect(args).not.toHaveProperty("email");
  }
  expect(mocks.create.mock.calls.map(([args]) => args.customer_id)).toEqual([
    `team-${f.workspaceId}`,
    `team-${other}`,
  ]);
  for (const [args] of mocks.create.mock.calls)
    expect(args).not.toHaveProperty("customer_email");
});
it("recovers a previously created team customer without another customer POST", async () => {
  const f = await fixture();
  mocks.customer.mockResolvedValue({
    id: "recovered-customer",
    type: "team",
    external_id: f.workspaceId,
  });
  await f.owner.action(api.payments.checkout, {
    workspaceId: f.workspaceId,
    kind: "subscription",
    requestId: crypto.randomUUID(),
  });
  expect(mocks.createCustomer).not.toHaveBeenCalled();
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({ customer_id: "recovered-customer" }),
  );
});

it("creates an owner-only portal session returning to the same workspace billing page", async () => {
  const f = await fixture();
  const now = Date.now();
  await f.t.run((ctx) =>
    ctx.db.insert("paymentWorkspaces", {
      workspaceId: f.workspaceId,
      environment: "sandbox",
      customerId: "customer",
      subscriptionId: "subscription",
      status: "active",
      seats: 1,
      paidSeats: 1,
      paidPeriodEnd: now + 86400_000,
      paidOrderAt: now,
      periodStart: now,
      periodEnd: now + 86400_000,
      cancelAtPeriodEnd: false,
      providerUpdatedAt: now,
    }),
  );
  mocks.portal.mockResolvedValue({
    customer_portal_url: "https://sandbox.polar.sh/portal/session",
  });
  const result = await f.owner.action(api.payments.portal, {
    workspaceId: f.workspaceId,
  });
  expect(result.url).toBe("https://sandbox.polar.sh/portal/session");
  expect(mocks.portal).toHaveBeenCalledWith(
    expect.objectContaining({
      customer_id: "customer",
      return_url: `http://localhost:5173/billing/${f.workspaceId}`,
    }),
  );
  const adminId = await createTestUser(f.t, "billing-admin@polar.test");
  await f.t.run((ctx) =>
    ctx.db.insert("workspaceMembers", {
      workspaceId: f.workspaceId,
      userId: adminId,
      role: "admin",
      createdAt: now,
    }),
  );
  const admin = f.t.withIdentity(authIdentity(adminId));
  await expect(
    admin.action(api.payments.portal, { workspaceId: f.workspaceId }),
  ).rejects.toThrow("Only the workspace owner");
  expect(mocks.portal).toHaveBeenCalledTimes(1);
  vi.stubEnv("POLAR_PAYMENTS_ENABLED", "false");
  await expect(
    f.owner.action(api.payments.portal, { workspaceId: f.workspaceId }),
  ).rejects.toThrow();
  expect(mocks.portal).toHaveBeenCalledTimes(1);
});
