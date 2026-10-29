import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import {
  authIdentity,
  createFundedTestUser,
  createTestUser,
  makeTest,
} from "../test/helpers";
import * as polar from "../../../apps/api/src/config/polar";
import * as payments from "../../../apps/api/src/services/payments";
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const t = makeTest();
  const userId = await createFundedTestUser(t, "billing-owner@test.com");
  const adminId = await createTestUser(t, "billing-admin@test.com", {
    isStaff: true,
  });
  const supportId = await createTestUser(t, "billing-support@test.com", {
    isStaff: true,
  });
  await t.run((ctx) => ctx.db.patch(supportId, { adminRoles: ["support"] }));
  const user = t.withIdentity(authIdentity(userId)),
    admin = t.withIdentity(authIdentity(adminId)),
    support = t.withIdentity(authIdentity(supportId));
  const workspaceId = await user.mutation(
    api.users.ensurePersonalWorkspace,
    {},
  );
  await t.mutation(internal.payments.applySubscription, {
    workspaceId,
    environment: "sandbox",
    customerId: "customer",
    subscriptionId: "subscription",
    status: "active",
    seats: 1,
    periodStart: Date.now() - 1000,
    periodEnd: Date.now() + 86400000,
    cancelAtPeriodEnd: false,
    providerUpdatedAt: Date.now(),
  });
  const orderId = await t.run((ctx) =>
    ctx.db.insert("paymentOrders", {
      workspaceId,
      environment: "sandbox",
      orderId: "provider-order",
      kind: "topup",
      netCents: 1000,
      refundedCents: 0,
      grantedUsdMicros: 10000000,
      reversedUsdMicros: 0,
      createdAt: Date.now(),
    }),
  );
  const request = {
    orderId,
    amountCents: 500,
    reason: "Customer requested a partial refund",
    requestId: "refund-1",
  };
  const prepare = () =>
    admin.mutation(internal.adminBilling.prepareRefund, request);
  return {
    t,
    user,
    admin,
    support,
    workspaceId,
    orderId,
    request,
    prepare,
    adminId,
  };
}
it("denies financial reads and writes to customers and support", async () => {
  const f = await fixture();
  for (const client of [f.user, f.support]) {
    await expect(
      client.query(api.adminBilling.workspace, { workspaceId: f.workspaceId }),
    ).rejects.toThrow(/Staff/);
    await expect(
      client.query(api.adminBilling.events, {
        paginationOpts: { cursor: null, numItems: 25 },
      }),
    ).rejects.toThrow(/Staff/);
    await expect(
      client.mutation(internal.adminBilling.prepareRefund, f.request),
    ).rejects.toThrow(/Staff/);
  }
});
it("paginates workspace ledger and redacts customer checkout URLs", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.insert("paymentCheckouts", {
      workspaceId: f.workspaceId,
      environment: "sandbox",
      userId: f.adminId,
      requestId: "checkout",
      kind: "topup",
      productId: "product",
      seats: 1,
      amountCents: 1000,
      state: "ready",
      checkoutUrl: "https://polar.sh/customer-secret",
      createdAt: Date.now(),
      expiresAt: Date.now() + 1000,
    }),
  );
  const result = await f.admin.query(api.adminBilling.history, {
    workspaceId: f.workspaceId,
    kind: "checkouts",
    paginationOpts: { cursor: null, numItems: 1 },
  });
  expect(JSON.stringify(result)).not.toContain("customer-secret");
  expect(result.page).toHaveLength(1);
  await expect(
    f.admin.query(api.adminBilling.history, {
      workspaceId: f.workspaceId,
      kind: "ledger",
      paginationOpts: { cursor: null, numItems: 101 },
    }),
  ).rejects.toThrow(/Page size/);
});
it("requeues failed events once, audits the real actor and rejects changed replay", async () => {
  const f = await fixture();
  await f.t.mutation(internal.payments.receiveEvent, {
    environment: "sandbox",
    eventId: "evt-1",
    eventType: "order.paid",
    objectId: "provider-order",
  });
  const event = await f.t.run((ctx) => ctx.db.query("paymentEvents").first());
  await f.t.run((ctx) => ctx.db.patch(event!.taskId!, { state: "failed" }));
  const args = {
    eventId: event!._id,
    reason: "Retry failed authoritative provider fetch",
    requestId: "retry-1",
  };
  await f.admin.mutation(api.adminBilling.reprocess, args);
  await f.admin.mutation(api.adminBilling.reprocess, args);
  expect(
    await f.t.run((ctx) => ctx.db.query("apiTasks").collect()),
  ).toHaveLength(1);
  const audit = await f.t.run((ctx) =>
    ctx.db
      .query("auditLog")
      .filter((q) => q.eq(q.field("action"), "payment.reprocess"))
      .collect(),
  );
  expect(audit).toHaveLength(1);
  expect(audit[0]?.actorUserId).toBe(f.adminId);
  await expect(
    f.admin.mutation(api.adminBilling.reprocess, {
      ...args,
      reason: "Different replay reason",
    }),
  ).rejects.toThrow(/mismatch/);
  await expect(
    f.admin.mutation(api.adminBilling.reprocess, {
      ...args,
      requestId: "retry-2",
    }),
  ).rejects.toThrow(/queued or running/);
});
it("rejects processed and wrong-environment event retries", async () => {
  const f = await fixture();
  for (const environment of ["sandbox", "production"] as const) {
    await f.t.mutation(internal.payments.receiveEvent, {
      environment,
      eventId: `evt-${environment}`,
      eventType: "order.paid",
      objectId: "provider-order",
    });
  }
  const rows = await f.t.run((ctx) => ctx.db.query("paymentEvents").collect());
  for (const row of rows) {
    if (row.environment === "sandbox")
      await f.t.mutation(internal.payments.completeEvent, { eventId: row._id });
    await expect(
      f.admin.mutation(api.adminBilling.reprocess, {
        eventId: row._id,
        reason: "Investigate failed payment event",
        requestId: row._id,
      }),
    ).rejects.toThrow(
      row.environment === "sandbox"
        ? /already processed/
        : /environment mismatch/,
    );
  }
});
it("rebuilds corrupted derived balances from authoritative ledger without issuing credits", async () => {
  const f = await fixture();
  const before = await f.admin.query(api.adminBilling.audit, {
    workspaceId: f.workspaceId,
  });
  await f.t.run(async (ctx) => {
    const account = await ctx.db
      .query("billingAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", f.workspaceId))
      .unique();
    await ctx.db.patch(account!._id, { available: 123 });
  });
  expect(
    (
      await f.admin.query(api.adminBilling.audit, {
        workspaceId: f.workspaceId,
      })
    ).consistent,
  ).toBe(false);
  const request = {
    workspaceId: f.workspaceId,
    reason: "Restore totals after accounting investigation",
    requestId: "repair-1",
    expectedSequence: before.account!.sequence,
  };
  await f.admin.mutation(api.adminBilling.repair, request);
  await f.admin.mutation(api.adminBilling.repair, request);
  expect(
    await f.admin.query(api.adminBilling.audit, { workspaceId: f.workspaceId }),
  ).toEqual(before);
});
it("rejects stale repairs and invalid authoritative ledger", async () => {
  const f = await fixture();
  const request = {
    workspaceId: f.workspaceId,
    reason: "Restore verified accounting totals",
    requestId: "repair-1",
    expectedSequence: 0,
  };
  await expect(
    f.admin.mutation(api.adminBilling.repair, request),
  ).rejects.toThrow(/Ledger changed/);
  await f.t.run(async (ctx) => {
    const entry = await ctx.db.query("usageLedger").first();
    await ctx.db.patch(entry!._id, { balanceAfter: 1 });
  });
  expect(
    (
      await f.admin.query(api.adminBilling.audit, {
        workspaceId: f.workspaceId,
      })
    ).error,
  ).toMatch(/does not reconcile/);
});
it("deduplicates refund intents, blocks concurrent refunds and puts generation in review", async () => {
  const f = await fixture();
  const first = await f.prepare();
  expect(first.dispatch).toBe(true);
  expect(await f.prepare()).toEqual({ id: first.id, dispatch: false });
  await expect(
    f.admin.mutation(internal.adminBilling.prepareRefund, {
      ...f.request,
      amountCents: 1,
    }),
  ).rejects.toThrow(/mismatch/);
  await expect(
    f.admin.mutation(internal.adminBilling.prepareRefund, {
      ...f.request,
      requestId: "refund-2",
    }),
  ).rejects.toThrow(/unresolved refund/);
  const detail = await f.admin.query(api.adminBilling.workspace, {
    workspaceId: f.workspaceId,
  });
  expect(detail?.payment?.reviewReason).toContain("refund");
  await expect(
    f.admin.mutation(api.adminBilling.resolveReview, {
      workspaceId: f.workspaceId,
      reason: "Reviewed all provider evidence and funds",
      requestId: "resolve-1",
    }),
  ).rejects.toThrow(/unresolved refunds/);
});
it("validates positive safe refund cents and authoritative refundable limits", async () => {
  const f = await fixture();
  for (const amountCents of [0, -1, 0.1, 1001, Number.MAX_SAFE_INTEGER])
    await expect(
      f.admin.mutation(internal.adminBilling.prepareRefund, {
        ...f.request,
        amountCents,
      }),
    ).rejects.toThrow(/Invalid refundable amount/);
  expect(
    await f.t.run((ctx) => ctx.db.query("adminRefunds").collect()),
  ).toHaveLength(0);
});
it("resolves a reviewed workspace only after refunds are terminal and accounting matches", async () => {
  const f = await fixture();
  const intent = await f.prepare();
  await f.t.mutation(internal.adminBilling.recordRefund, {
    refundId: intent.id,
    status: "succeeded",
    providerRefundId: "refund-provider",
  });
  await f.t.run((ctx) => ctx.db.patch(f.orderId, { refundedCents: 500 }));
  await f.admin.mutation(api.adminBilling.resolveReview, {
    workspaceId: f.workspaceId,
    reason: "Provider refund confirmed and used funds reviewed",
    requestId: "resolve-1",
  });
  expect(
    (
      await f.admin.query(api.adminBilling.workspace, {
        workspaceId: f.workspaceId,
      })
    )?.payment?.reviewReason,
  ).toBeUndefined();
  await expect(
    f.t.mutation(internal.adminBilling.recordRefund, {
      refundId: intent.id,
      status: "uncertain",
    }),
  ).rejects.toThrow(/Terminal refund/);
});
function mockProvider() {
  const create = vi.fn(),
    list = vi.fn().mockResolvedValue({ items: [] }),
    get = vi
      .fn()
      .mockResolvedValue({ id: "provider-order", paid: true, currency: "usd" });
  vi.spyOn(polar, "polarClient").mockReturnValue({
    orders: { get },
    refunds: { create, list },
  } as unknown as ReturnType<typeof polar.polarClient>);
  vi.spyOn(polar, "polarConfiguration").mockReturnValue({
    environment: "sandbox",
  } as ReturnType<typeof polar.polarConfiguration>);
  vi.spyOn(payments, "syncOrder").mockResolvedValue(undefined);
  return { create, list, get };
}
it("does not resend an ambiguous provider refund, even on repeated action requests", async () => {
  const f = await fixture(),
    provider = mockProvider();
  provider.create.mockRejectedValue(new Error("response lost"));
  expect(
    (await f.admin.action(api.adminBilling.refund, f.request)).status,
  ).toContain("uncertain");
  await f.admin.action(api.adminBilling.refund, f.request);
  expect(provider.create).toHaveBeenCalledTimes(1);
  expect(
    (await f.t.run((ctx) => ctx.db.query("adminRefunds").first()))?.status,
  ).toBe("uncertain");
});
it("matches uncertain refunds by provider metadata without issuing another refund", async () => {
  const f = await fixture(),
    provider = mockProvider();
  const intent = await f.prepare();
  await f.t.mutation(internal.adminBilling.recordRefund, {
    refundId: intent.id,
    status: "uncertain",
  });
  provider.list.mockResolvedValue({
    items: [
      {
        id: "refund-provider",
        order_id: "provider-order",
        currency: "usd",
        amount: 500,
        status: "succeeded",
        metadata: { cinakey_refund: intent.id },
      },
    ],
  });
  expect(
    await f.admin.action(api.adminBilling.reconcileRefunds, {
      orderId: f.orderId,
    }),
  ).toEqual({ matched: 1 });
  expect((await f.t.run((ctx) => ctx.db.get(intent.id)))?.status).toBe(
    "succeeded",
  );
  expect(provider.create).not.toHaveBeenCalled();
});
it("keeps absent provider refunds uncertain and rejects wrong receipt amounts", async () => {
  const f = await fixture(),
    provider = mockProvider();
  const intent = await f.prepare();
  await f.t.mutation(internal.adminBilling.recordRefund, {
    refundId: intent.id,
    status: "uncertain",
  });
  expect(
    await f.admin.action(api.adminBilling.reconcileRefunds, {
      orderId: f.orderId,
    }),
  ).toEqual({ matched: 0 });
  provider.list.mockResolvedValue({
    items: [
      {
        id: "refund-provider",
        order_id: "provider-order",
        currency: "usd",
        amount: 999,
        status: "succeeded",
        metadata: { cinakey_refund: intent.id },
      },
    ],
  });
  expect(
    await f.admin.action(api.adminBilling.reconcileRefunds, {
      orderId: f.orderId,
    }),
  ).toEqual({ matched: 0 });
  expect((await f.t.run((ctx) => ctx.db.get(intent.id)))?.status).toBe(
    "uncertain",
  );
});
it("records a successful refund receipt and refreshes order accounting", async () => {
  const f = await fixture(),
    provider = mockProvider();
  provider.create.mockResolvedValue({
    id: "refund-provider",
    order_id: "provider-order",
    amount: 500,
    currency: "usd",
    status: "succeeded",
  });
  expect(await f.admin.action(api.adminBilling.refund, f.request)).toEqual({
    status: "succeeded",
  });
  expect(payments.syncOrder).toHaveBeenCalledTimes(2);
  expect(
    (await f.t.run((ctx) => ctx.db.query("adminRefunds").first()))
      ?.providerRefundId,
  ).toBe("refund-provider");
});
it("credits the selected workspace once and rejects changed amount replays", async () => {
  const f = await fixture();
  const before = await f.admin.query(api.adminBilling.audit, {
    workspaceId: f.workspaceId,
  });
  const args = {
    workspaceId: f.workspaceId,
    amountUsdMicros: 1230000,
    requestId: "credit-1",
    reason: "Customer support goodwill credit",
  };
  await f.admin.mutation(api.adminBilling.credit, args);
  await f.admin.mutation(api.adminBilling.credit, args);
  const after = await f.admin.query(api.adminBilling.audit, {
    workspaceId: f.workspaceId,
  });
  expect(after.account!.available - before.account!.available).toBe(1230000);
  expect(after.consistent).toBe(true);
  await expect(
    f.admin.mutation(api.adminBilling.credit, {
      ...args,
      amountUsdMicros: 9999999,
    }),
  ).rejects.toThrow(/mismatch/);
  const ledger = await f.admin.query(api.adminBilling.history, {
    workspaceId: f.workspaceId,
    kind: "ledger",
    search: "adjustment",
    paginationOpts: { cursor: null, numItems: 25 },
  });
  expect(ledger.page).toHaveLength(1);
});
it("requires provider order accounting before clearing a completed refund review", async () => {
  const f = await fixture();
  const intent = await f.prepare();
  await f.t.mutation(internal.adminBilling.recordRefund, {
    refundId: intent.id,
    status: "succeeded",
    providerRefundId: "refund-provider",
  });
  await expect(
    f.admin.mutation(api.adminBilling.resolveReview, {
      workspaceId: f.workspaceId,
      reason: "Provider receipt reviewed but order not synced",
      requestId: "resolve-1",
    }),
  ).rejects.toThrow(/Refresh provider order accounting/);
});
it("refuses partial audits and repairs when the ledger exceeds the interactive bound", async () => {
  const f = await fixture();
  const before = await f.t.run((ctx) =>
    ctx.db
      .query("billingAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", f.workspaceId))
      .unique(),
  );
  await f.t.run(async (ctx) => {
    const entry = await ctx.db.query("usageLedger").first();
    if (!entry) throw new Error("Missing fixture ledger");
    const { _id, _creationTime, ...fields } = entry;
    for (let n = 0; n < 1000; n++) await ctx.db.insert("usageLedger", fields);
  });
  expect(
    (
      await f.admin.query(api.adminBilling.audit, {
        workspaceId: f.workspaceId,
      })
    ).error,
  ).toContain("interactive audit limit");
  await expect(
    f.admin.mutation(api.adminBilling.repair, {
      workspaceId: f.workspaceId,
      expectedSequence: before!.sequence,
      reason: "Investigate a large ledger safely",
      requestId: "large-repair",
    }),
  ).rejects.toThrow(/interactive audit limit/);
  expect(await f.t.run((ctx) => ctx.db.get(before!._id))).toEqual(before);
});
it("blocks refunds against another deployment environment before calling Polar", async () => {
  const f = await fixture(),
    provider = mockProvider();
  await f.t.run((ctx) =>
    ctx.db.patch(f.orderId, { environment: "production" }),
  );
  await expect(
    f.admin.action(api.adminBilling.refund, f.request),
  ).rejects.toThrow(/environment mismatch/);
  expect(provider.get).not.toHaveBeenCalled();
  expect(provider.create).not.toHaveBeenCalled();
});
it("blocks new refund dispatch while Polar reports another pending refund", async () => {
  const f = await fixture(),
    provider = mockProvider();
  provider.list.mockResolvedValue({ items: [{ status: "pending" }] });
  await expect(
    f.admin.action(api.adminBilling.refund, f.request),
  ).rejects.toThrow(/existing provider refunds/);
  expect(provider.create).not.toHaveBeenCalled();
  expect(
    await f.t.run((ctx) => ctx.db.query("adminRefunds").collect()),
  ).toHaveLength(0);
});
it("keeps conflicting refund receipts unresolved", async () => {
  const f = await fixture(),
    provider = mockProvider();
  provider.create.mockResolvedValue({
    id: "wrong-refund",
    order_id: "another-order",
    currency: "usd",
    amount: 500,
    status: "succeeded",
  });
  expect(
    (await f.admin.action(api.adminBilling.refund, f.request)).status,
  ).toContain("uncertain");
  expect(
    (await f.t.run((ctx) => ctx.db.query("adminRefunds").first()))?.status,
  ).toBe("uncertain");
});
it("blocks another refund until the previous successful refund reaches order accounting", async () => {
  const f = await fixture();
  const intent = await f.prepare();
  await f.t.mutation(internal.adminBilling.recordRefund, {
    refundId: intent.id,
    status: "succeeded",
    providerRefundId: "refund-provider",
  });
  await expect(
    f.admin.mutation(internal.adminBilling.prepareRefund, {
      ...f.request,
      requestId: "refund-2",
    }),
  ).rejects.toThrow(/unresolved refund/);
});
