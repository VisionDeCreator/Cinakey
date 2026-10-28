import { setTestProviders } from "../../../apps/api/test/setup";
import { beforeEach, expect, it } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";

beforeEach(() => {
  setTestProviders(false);
});
async function fixture() {
  const t = makeTest();
  const userId = await createTestUser(t, "owner@billing.test");
  const memberId = await createTestUser(t, "member@billing.test");
  const owner = t.withIdentity(authIdentity(userId));
  const creator = t.withIdentity(authIdentity(memberId));
  const workspaceId = await owner.mutation(
    api.users.ensurePersonalWorkspace,
    {},
  );
  const projectId = await owner.mutation(api.projects.create, {
    title: "Billing test",
  });
  const now = Date.now();
  const periodStart = now - 1000;
  const periodEnd = now + 28 * 86400_000;
  const subscription = {
    workspaceId,
    environment: "sandbox" as const,
    customerId: "customer",
    subscriptionId: "subscription",
    status: "active",
    seats: 2,
    periodStart,
    periodEnd,
    cancelAtPeriodEnd: false,
    providerUpdatedAt: now,
  };
  const order = {
    workspaceId,
    environment: "sandbox" as const,
    customerId: "customer",
    subscriptionId: "subscription",
    orderId: "order-sub",
    kind: "subscription" as const,
    netCents: 4400,
    refundedCents: 0,
    paid: true,
    createdAt: now,
    billingReason: "subscription_create",
    seats: 2,
    periodStart,
    periodEnd,
  };
  async function activate() {
    await t.mutation(internal.payments.applySubscription, subscription);
    await t.mutation(internal.payments.applyOrder, order);
  }
  async function job(amount: number) {
    return t.run((ctx) =>
      ctx.db.insert("generationJobs", {
        projectId,
        createdBy: userId,
        model: "test",
        modelVersion: "test",
        kind: "video",
        prompt: "test",
        estimatedCostUsdMicros: amount,
        status: "queued",
        outputAssetIds: [],
        attempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
  }
  async function reserve(amount: number) {
    const jobId = await job(amount);
    await t.mutation(internal.billing.reserve, {
      workspaceId,
      userId,
      projectId,
      jobId,
      amount,
    });
    return jobId;
  }
  async function topup() {
    const result = await owner.mutation(internal.payments.prepareCheckout, {
      workspaceId,
      environment: "sandbox",
      requestId: crypto.randomUUID(),
      kind: "topup",
      productId: "topup-10",
      seats: 1,
      amountCents: 1000,
    });
    const top = {
      workspaceId,
      environment: "sandbox" as const,
      customerId: "customer",
      orderId: "order-top",
      kind: "topup" as const,
      netCents: 1000,
      refundedCents: 0,
      paid: true,
      createdAt: Date.now(),
      billingReason: "purchase",
      intentId: result.intent._id,
      topupUsdMicros: 10_000_000,
    };
    await t.mutation(internal.payments.applyOrder, top);
    return top;
  }
  return {
    t,
    userId,
    memberId,
    owner,
    creator,
    workspaceId,
    projectId,
    subscription,
    order,
    activate,
    job,
    reserve,
    topup,
  };
}
it("requires Owner for checkout and portal context; Admin gets read-only summary", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.insert("workspaceMembers", {
      workspaceId: f.workspaceId,
      userId: f.memberId,
      role: "admin",
      createdAt: Date.now(),
    }),
  );
  await expect(
    f.creator.query(internal.payments.ownerContext, {
      workspaceId: f.workspaceId,
    }),
  ).rejects.toThrow("Only the workspace owner");
  expect(
    (
      await f.creator.query(api.payments.summary, {
        workspaceId: f.workspaceId,
      })
    ).isOwner,
  ).toBe(false);
  await f.t.run(async (ctx) => {
    const m = await ctx.db.query("workspaceMembers").first();
    await ctx.db.patch(m!._id, { role: "creator" });
  });
  await expect(
    f.creator.query(api.payments.summary, { workspaceId: f.workspaceId }),
  ).rejects.toThrow("billing access denied");
});
it("deduplicates checkout requests, rejects mutations and prevents parallel subscription checkouts", async () => {
  const f = await fixture();
  const args = {
    workspaceId: f.workspaceId,
    environment: "sandbox" as const,
    requestId: crypto.randomUUID(),
    kind: "subscription" as const,
    productId: "sub",
    seats: 2,
    amountCents: 4400,
  };
  const first = await f.owner.mutation(internal.payments.prepareCheckout, args);
  expect(first.fresh).toBe(true);
  expect(
    (await f.owner.mutation(internal.payments.prepareCheckout, args)).intent
      ._id,
  ).toBe(first.intent._id);
  await expect(
    f.owner.mutation(internal.payments.prepareCheckout, { ...args, seats: 3 }),
  ).rejects.toThrow("mismatch");
  await expect(
    f.owner.mutation(internal.payments.prepareCheckout, {
      ...args,
      requestId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("already open");
});
it("deduplicates webhook deliveries and enqueues one durable task", async () => {
  const f = await fixture();
  const args = {
    environment: "sandbox" as const,
    eventId: "event",
    eventType: "order.paid",
    objectId: "order",
  };
  await f.t.mutation(internal.payments.receiveEvent, args);
  await f.t.mutation(internal.payments.receiveEvent, args);
  const rows = await f.t.run(async (ctx) => ({
    events: await ctx.db.query("paymentEvents").collect(),
    tasks: await ctx.db.query("apiTasks").collect(),
  }));
  expect(rows.events).toHaveLength(1);
  expect(
    rows.tasks.filter((t) => t.operation === "payments:processEvent"),
  ).toHaveLength(1);
  await expect(
    f.t.mutation(internal.payments.receiveEvent, {
      ...args,
      objectId: "different",
    }),
  ).rejects.toThrow("mismatch");
});
it("does not activate from a subscription or unpaid order alone; grants one $5 allowance for the paid period", async () => {
  const f = await fixture();
  await f.t.mutation(internal.payments.applySubscription, f.subscription);
  await expect(f.reserve(100)).rejects.toThrow("active paid");
  await f.t.mutation(internal.payments.applyOrder, { ...f.order, paid: false });
  expect((await f.owner.query(api.billing.getBalance, {})).balance).toBe(0);
  await f.t.mutation(internal.payments.applyOrder, f.order);
  await f.t.mutation(internal.payments.applyOrder, f.order);
  await f.t.mutation(internal.payments.applyOrder, {
    ...f.order,
    orderId: "duplicate-cycle-order",
  });
  expect((await f.owner.query(api.billing.getBalance, {})).balance).toBe(
    5_000_000,
  );
  await f.reserve(100);
  expect(
    (await f.owner.query(api.payments.summary, { workspaceId: f.workspaceId }))
      .state?.paidSeats,
  ).toBe(2);
});
it("keeps purchased funds separate and spends included funds first", async () => {
  const f = await fixture();
  await f.activate();
  const top = await f.topup();
  await f.t.mutation(internal.payments.applyOrder, top);
  const jobId = await f.reserve(6_000_000);
  await f.t.mutation(internal.billing.settle, {
    workspaceId: f.workspaceId,
    userId: f.userId,
    projectId: f.projectId,
    jobId,
    estimated: 6_000_000,
    actual: 3_000_000,
  });
  const summary = await f.owner.query(api.payments.summary, {
    workspaceId: f.workspaceId,
  });
  expect(summary.includedAvailable).toBe(2_000_000);
  expect(summary.purchasedAvailable).toBe(10_000_000);
  expect(
    (await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }))
      .consistent,
  ).toBe(true);
});
it("expires unused allowance, preserves purchases and does not roll released old holds into a new period", async () => {
  const f = await fixture();
  await f.activate();
  await f.topup();
  const jobId = await f.reserve(4_000_000);
  await f.t.run(async (ctx) => {
    const p = await ctx.db
      .query("fundingPools")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", f.workspaceId))
      .collect();
    for (const pool of p)
      if (pool.kind === "included")
        await ctx.db.patch(pool._id, { expiresAt: Date.now() - 1 });
  });
  expect((await f.owner.query(api.billing.getBalance, {})).balance).toBe(
    10_000_000,
  );
  await f.t.mutation(internal.payments.expireAllowances, {});
  await f.t.mutation(internal.billing.refund, {
    workspaceId: f.workspaceId,
    userId: f.userId,
    projectId: f.projectId,
    jobId,
    amount: 4_000_000,
  });
  expect((await f.owner.query(api.billing.getBalance, {})).balance).toBe(
    10_000_000,
  );
  expect(
    (await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }))
      .consistent,
  ).toBe(true);
});
it("grants no extra allowance on seat upgrade and activates extra seats only after a paid order", async () => {
  const f = await fixture();
  await f.activate();
  await f.t.mutation(internal.payments.applySubscription, {
    ...f.subscription,
    seats: 3,
    providerUpdatedAt: Date.now() + 1,
  });
  expect(
    (await f.owner.query(api.payments.summary, { workspaceId: f.workspaceId }))
      .state?.paidSeats,
  ).toBe(2);
  await f.t.mutation(internal.payments.applyOrder, {
    ...f.order,
    orderId: "upgrade",
    billingReason: "subscription_update",
    netCents: 800,
    seats: 3,
    createdAt: Date.now() + 5,
  });
  const summary = await f.owner.query(api.payments.summary, {
    workspaceId: f.workspaceId,
  });
  expect(summary.state?.paidSeats).toBe(3);
  expect(summary.includedAvailable).toBe(5_000_000);
});
it("does not revert current subscription state or paid seat capacity from older records", async () => {
  const f = await fixture();
  await f.activate();
  await f.t.mutation(internal.payments.applySubscription, {
    ...f.subscription,
    status: "canceled",
    providerUpdatedAt: Date.now() + 100,
  });
  await f.t.mutation(internal.payments.applySubscription, f.subscription);
  await expect(f.reserve(100)).rejects.toThrow("active paid");
});
it("grants a new $5 only after a paid renewal and expires the previous period", async () => {
  const f = await fixture();
  await f.activate();
  const periodStart = Date.now();
  const periodEnd = periodStart + 28 * 86400_000;
  await f.t.run(async (ctx) => {
    for (const p of await ctx.db.query("fundingPools").collect())
      await ctx.db.patch(p._id, { expiresAt: Date.now() - 1 });
  });
  await f.t.mutation(internal.payments.applyOrder, {
    ...f.order,
    orderId: "renewal",
    billingReason: "subscription_cycle",
    periodStart,
    periodEnd,
    createdAt: Date.now() + 1,
  });
  expect((await f.owner.query(api.billing.getBalance, {})).balance).toBe(
    5_000_000,
  );
});
it("honors a seven-day overdue grace period, then blocks new reservations while keeping read access", async () => {
  const f = await fixture();
  await f.activate();
  await f.t.mutation(internal.payments.applySubscription, {
    ...f.subscription,
    status: "past_due",
    pastDueAt: Date.now() - 2 * 86400_000,
    providerUpdatedAt: Date.now() + 1,
  });
  await f.reserve(100);
  await f.t.mutation(internal.payments.applySubscription, {
    ...f.subscription,
    status: "past_due",
    pastDueAt: Date.now() - 8 * 86400_000,
    providerUpdatedAt: Date.now() + 2,
  });
  await expect(f.reserve(100)).rejects.toThrow("active paid");
  expect(
    await f.owner.query(api.projects.get, { projectId: f.projectId }),
  ).not.toBeNull();
});
it("enforces seats atomically on invitation acceptance and Reviewer promotion", async () => {
  const f = await fixture();
  await f.activate();
  await f.t.mutation(internal.payments.applySubscription, {
    ...f.subscription,
    seats: 1,
    providerUpdatedAt: Date.now() + 1,
  });
  const invite = await f.owner.mutation(api.teams.invite, {
    workspaceId: f.workspaceId,
    email: "member@billing.test",
    role: "creator",
  });
  await expect(
    f.creator.mutation(api.teams.accept, { invitationId: invite }),
  ).rejects.toThrow("No paid creator seat");
  await f.owner.mutation(api.teams.revoke, { invitationId: invite });
  const reviewer = await f.owner.mutation(api.teams.invite, {
    workspaceId: f.workspaceId,
    email: "member@billing.test",
    role: "reviewer",
  });
  await f.creator.mutation(api.teams.accept, { invitationId: reviewer });
  await expect(
    f.owner.mutation(api.teams.changeMember, {
      workspaceId: f.workspaceId,
      userId: f.memberId,
      role: "creator",
    }),
  ).rejects.toThrow("No paid creator seat");
});
it("applies cumulative partial refunds exactly once and rejects late snapshots that undo them", async () => {
  const f = await fixture();
  await f.activate();
  const top = await f.topup();
  await f.t.mutation(internal.payments.applyOrder, {
    ...top,
    refundedCents: 250,
  });
  await f.t.mutation(internal.payments.applyOrder, {
    ...top,
    refundedCents: 250,
  });
  await f.t.mutation(internal.payments.applyOrder, top);
  expect(
    (await f.owner.query(api.payments.summary, { workspaceId: f.workspaceId }))
      .purchasedAvailable,
  ).toBe(7_500_000);
  await f.t.mutation(internal.payments.applyOrder, {
    ...top,
    refundedCents: 1000,
  });
  expect((await f.owner.query(api.billing.getBalance, {})).balance).toBe(
    5_000_000,
  );
  expect(
    (await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }))
      .consistent,
  ).toBe(true);
});
it("freezes new spending if refunded funds are already used and permits existing job settlement", async () => {
  const f = await fixture();
  await f.activate();
  const top = await f.topup();
  const jobId = await f.reserve(14_000_000);
  await f.t.mutation(internal.payments.applyOrder, {
    ...top,
    refundedCents: 1000,
  });
  await expect(f.reserve(100)).rejects.toThrow("active paid");
  await f.t.mutation(internal.billing.refund, {
    workspaceId: f.workspaceId,
    userId: f.userId,
    projectId: f.projectId,
    jobId,
    amount: 14_000_000,
  });
  expect(
    (await f.owner.query(api.payments.summary, { workspaceId: f.workspaceId }))
      .purchasedAvailable,
  ).toBe(0);
  expect(
    (await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }))
      .consistent,
  ).toBe(true);
});
it("does not accept a top-up for another workspace or switch sandbox/live bindings", async () => {
  const f = await fixture();
  await f.activate();
  const top = await f.topup();
  await expect(
    f.t.mutation(internal.payments.applyOrder, { ...top, customerId: "other" }),
  ).rejects.toThrow("Unbound");
  await expect(
    f.t.mutation(internal.payments.applySubscription, {
      ...f.subscription,
      environment: "production",
    }),
  ).rejects.toThrow("binding");
});
it("prevents account purge while its Polar subscription is active", async () => {
  const f = await fixture();
  await f.activate();
  await expect(
    f.owner.mutation(api.users.deleteAccount, { confirm: "DELETE" }),
  ).rejects.toThrow("Cancel the workspace subscription");
});
it("cannot fund two separate orders from one top-up checkout", async () => {
  const f = await fixture();
  await f.activate();
  const top = await f.topup();
  await expect(
    f.t.mutation(internal.payments.applyOrder, {
      ...top,
      orderId: "another-order",
    }),
  ).rejects.toThrow("approved checkout");
  expect(
    (await f.owner.query(api.payments.summary, { workspaceId: f.workspaceId }))
      .purchasedAvailable,
  ).toBe(10_000_000);
});
it("blocks billing-linked ownership transfer until portal access is reconciled", async () => {
  const f = await fixture();
  await f.activate();
  await f.t.run((ctx) =>
    ctx.db.insert("workspaceMembers", {
      workspaceId: f.workspaceId,
      userId: f.memberId,
      role: "creator",
      createdAt: Date.now(),
    }),
  );
  await expect(
    f.owner.mutation(api.teams.transferOwnership, {
      workspaceId: f.workspaceId,
      newOwnerId: f.memberId,
    }),
  ).rejects.toThrow("billing support");
});
it("requeues a failed payment event on redelivery without duplicating active work", async () => {
  const f = await fixture();
  const event = {
    environment: "sandbox" as const,
    eventId: "retry-event",
    eventType: "order.paid",
    objectId: "order",
  };
  await f.t.mutation(internal.payments.receiveEvent, event);
  const original = await f.t.run((ctx) =>
    ctx.db.query("paymentEvents").first(),
  );
  await f.t.run((ctx) =>
    ctx.db.patch(original!.taskId!, {
      state: "failed",
      error: "Temporary configuration failure",
    }),
  );
  await f.t.mutation(internal.payments.receiveEvent, event);
  await f.t.mutation(internal.payments.receiveEvent, event);
  const latest = await f.t.run((ctx) => ctx.db.get(original!._id));
  expect(latest!.taskId).not.toBe(original!.taskId);
  const pending = await f.t.run((ctx) =>
    ctx.db
      .query("apiTasks")
      .withIndex("by_state_due", (q) => q.eq("state", "pending"))
      .collect(),
  );
  expect(
    pending.filter((t) => t.operation === "payments:processEvent"),
  ).toHaveLength(1);
});
