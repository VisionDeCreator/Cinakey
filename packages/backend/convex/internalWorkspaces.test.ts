import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";

afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const t = makeTest();
  const ownerId = await createTestUser(t, "company-owner@test.com");
  const staffId = await createTestUser(t, "platform@test.com", {
    isStaff: true,
  });
  const owner = t.withIdentity(authIdentity(ownerId));
  const staff = t.withIdentity(authIdentity(staffId));
  const workspaceId = await staff.mutation(api.staff.createInternalWorkspace, {
    ownerEmail: "company-owner@test.com",
    name: "Dirrio Internal",
    monthlyCapUsdMicros: 2_000_000,
    reason: "Company testing",
  });
  const projectId = await owner.mutation(api.projects.create, {
    title: "Internal film",
    workspaceId,
  });
  return { t, owner, staff, ownerId, workspaceId, projectId };
}
it("restricts company funding to platform administrators and audits creation", async () => {
  const f = await fixture();
  await expect(
    f.owner.mutation(api.staff.enableInternalWorkspace, {
      workspaceId: f.workspaceId,
      monthlyCapUsdMicros: 1,
      reason: "Owner request",
    }),
  ).rejects.toThrow("Staff access required");
  await expect(
    f.owner.mutation(api.staff.createInternalWorkspace, {
      ownerEmail: "company-owner@test.com",
      name: "Free",
      monthlyCapUsdMicros: 1,
      reason: "Owner request",
    }),
  ).rejects.toThrow("Staff access required");
  const logs = await f.staff.query(api.staff.listAuditLog, {});
  expect(logs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        action: "workspace.internal.enable",
        targetId: f.workspaceId,
      }),
    ]),
  );
  expect(
    (await f.owner.query(api.teams.list, {})).some(
      (w) => w.workspace._id === f.workspaceId,
    ),
  ).toBe(true);
});
it("allows free team seats with the subscription paywall enabled, without exempting other workspaces", async () => {
  const f = await fixture();
  vi.stubEnv("SUBSCRIPTION_PAYWALL_ENABLED", "true");
  expect(
    await f.owner.query(api.payments.entitlements, {
      workspaceId: f.workspaceId,
    }),
  ).toMatchObject({ canWrite: true });
  const memberId = await createTestUser(f.t, "teammate@test.com");
  const invite = await f.owner.mutation(api.teams.invite, {
    workspaceId: f.workspaceId,
    email: "teammate@test.com",
    role: "creator",
  });
  const member = f.t.withIdentity(authIdentity(memberId));
  await member.mutation(api.teams.accept, { invitationId: invite });
  expect(
    await member.query(api.payments.entitlements, {
      workspaceId: f.workspaceId,
    }),
  ).toMatchObject({ canWrite: true });
  const other = await f.t.run((ctx) =>
    ctx.db.insert("workspaces", {
      ownerUserId: f.ownerId,
      name: "Customer",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  expect(
    await f.owner.query(api.payments.entitlements, { workspaceId: other }),
  ).toMatchObject({ canWrite: false });
  await expect(
    f.owner.query(internal.payments.ownerContext, {
      workspaceId: f.workspaceId,
    }),
  ).rejects.toThrow("do not accept payments");
});
it("funds real reservations without a purchase, settles provider budgets and standard prices, and rebuilds faithfully", async () => {
  const f = await fixture();
  const jobId = await f.t.mutation(internal.textJobs.createChatJob, {
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    userId: f.ownerId,
    prompt: "Internal",
    estimatedCostUsdMicros: 1_000_000,
  });
  await expect(
    f.staff.mutation(api.staff.enableInternalWorkspace, {
      workspaceId: f.workspaceId,
      monthlyCapUsdMicros: 1,
      reason: "Reset",
    }),
  ).rejects.toThrow("without payment or usage history");
  await f.t.run((ctx) =>
    ctx.db.patch(jobId, { supplierActualCostUsdMicros: 600_000 }),
  );
  const settle = {
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    userId: f.ownerId,
    jobId,
    estimated: 1_000_000,
    actual: 630_000,
  };
  await f.t.mutation(internal.billing.settle, settle);
  await f.t.mutation(internal.billing.settle, settle);
  const report = await f.owner.query(api.billing.budgets, {
    workspaceId: f.workspaceId,
  });
  expect(report).toMatchObject({
    billingMode: "internal",
    account: { spent: 630_000, reserved: 0 },
    workspace: {
      spentUsdMicros: 600_000,
      standardPriceUsdMicros: 630_000,
      providerCostUsdMicros: 600_000,
      reservedUsdMicros: 0,
    },
  });
  expect(
    await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }),
  ).toMatchObject({ consistent: true });
  await f.owner.mutation(api.billing.setBudget, {
    workspaceId: f.workspaceId,
    cap: 600_000,
  });
  await expect(
    f.t.mutation(internal.textJobs.createChatJob, {
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      userId: f.ownerId,
      prompt: "Over budget",
      estimatedCostUsdMicros: 1,
    }),
  ).rejects.toThrow("spend cap reached");
  const ledger = await f.owner.query(api.billing.listLedger, {
    workspaceId: f.workspaceId,
  });
  expect(
    ledger.filter((e) => e.reason === "grant" && e.companyFunded),
  ).toHaveLength(1);
});
it("releases refunds and reserves conservatively when provider cost is unknown", async () => {
  const f = await fixture();
  const args = {
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    userId: f.ownerId,
  };
  const jobId = await f.t.mutation(internal.textJobs.createChatJob, {
    ...args,
    prompt: "Refund",
    estimatedCostUsdMicros: 1_000_000,
  });
  await f.t.mutation(internal.billing.refund, {
    ...args,
    jobId,
    amount: 1_000_000,
  });
  expect(
    (await f.owner.query(api.billing.budgets, { workspaceId: f.workspaceId }))
      .workspace,
  ).toMatchObject({ spentUsdMicros: 0, reservedUsdMicros: 0 });
  const second = await f.t.mutation(internal.textJobs.createChatJob, {
    ...args,
    prompt: "Unknown receipt",
    estimatedCostUsdMicros: 1_000_000,
  });
  await f.t.mutation(internal.billing.settle, {
    ...args,
    jobId: second,
    estimated: 1_000_000,
    actual: 500_000,
  });
  expect(
    (await f.owner.query(api.billing.budgets, { workspaceId: f.workspaceId }))
      .workspace,
  ).toMatchObject({
    spentUsdMicros: 500_000,
    providerCostUsdMicros: 0,
    standardPriceUsdMicros: 500_000,
  });
  expect(
    await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }),
  ).toMatchObject({ consistent: true });
});

it("meters text provider evidence directly into budgets and retains caps for missing evidence", async () => {
  const f = await fixture();
  const args = {
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    userId: f.ownerId,
  };
  const jobId = await f.t.mutation(internal.textJobs.createChatJob, {
    ...args,
    prompt: "Measured text",
    estimatedCostUsdMicros: 100_000,
  });
  await f.t.mutation(internal.textJobs.settleChatJob, {
    ...args,
    jobId,
    actualCostUsdMicros: 0,
    succeeded: true,
    batches: [
      {
        inputTokens: 1000,
        cachedInputTokens: 0,
        outputTokens: 1000,
        period: "peak",
        providerCreatedAt: Date.UTC(2026, 9, 28, 2),
      },
    ],
  });
  const job = await f.t.run((ctx) => ctx.db.get(jobId));
  const report = await f.owner.query(api.billing.budgets, {
    workspaceId: f.workspaceId,
  });
  expect(job?.supplierActualCostUsdMicros).toBeGreaterThan(0);
  expect(report.workspace.providerCostUsdMicros).toBe(
    job?.supplierActualCostUsdMicros,
  );
  expect(report.workspace.spentUsdMicros).toBe(
    job?.supplierActualCostUsdMicros,
  );
  expect(report.workspace.standardPriceUsdMicros).toBe(
    job?.actualCostUsdMicros,
  );
  const missing = await f.t.mutation(internal.textJobs.createChatJob, {
    ...args,
    prompt: "Missing evidence",
    estimatedCostUsdMicros: 100_000,
  });
  await f.t.mutation(internal.textJobs.settleChatJob, {
    ...args,
    jobId: missing,
    actualCostUsdMicros: 0,
    succeeded: true,
    usageMissing: true,
  });
  expect(
    (await f.owner.query(api.billing.budgets, { workspaceId: f.workspaceId }))
      .workspace.reservedUsdMicros,
  ).toBe(100_000);
  expect(
    await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }),
  ).toMatchObject({ consistent: true });
});

it("keeps captured provider costs in the company budget even when the user gets a full refund", async () => {
  const f = await fixture();
  const args = {
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    userId: f.ownerId,
  };
  const jobId = await f.t.mutation(internal.textJobs.createChatJob, {
    ...args,
    prompt: "Provider charged before failure",
    estimatedCostUsdMicros: 100_000,
  });
  await f.t.run((ctx) =>
    ctx.db.patch(jobId, { supplierActualCostUsdMicros: 50_000 }),
  );
  await f.t.mutation(internal.billing.refund, {
    ...args,
    jobId,
    amount: 100_000,
  });
  expect(
    (await f.owner.query(api.billing.budgets, { workspaceId: f.workspaceId }))
      .workspace,
  ).toMatchObject({
    spentUsdMicros: 50_000,
    providerCostUsdMicros: 50_000,
    standardPriceUsdMicros: 0,
    reservedUsdMicros: 0,
  });
  expect(
    await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }),
  ).toMatchObject({ consistent: true });
});

it("rejects converting payment-bound workspaces and enforces project caps before granting company funds", async () => {
  const f = await fixture();
  const paidWorkspace = await f.t.run(async (ctx) => {
    const id = await ctx.db.insert("workspaces", {
      ownerUserId: f.ownerId,
      name: "Checkout in progress",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("paymentCheckouts", {
      workspaceId: id,
      environment: "sandbox",
      userId: f.ownerId,
      requestId: "pending-checkout-1",
      kind: "subscription",
      productId: "test",
      seats: 1,
      amountCents: 2900,
      state: "creating",
      expiresAt: Date.now() + 1000,
      createdAt: Date.now(),
    });
    return id;
  });
  await expect(
    f.staff.mutation(api.staff.enableInternalWorkspace, {
      workspaceId: paidWorkspace,
      monthlyCapUsdMicros: 100_000,
      reason: "Cannot override checkout",
    }),
  ).rejects.toThrow("without payment or usage history");
  await f.owner.mutation(api.billing.setBudget, {
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    cap: 0,
  });
  await expect(
    f.t.mutation(internal.textJobs.createChatJob, {
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      userId: f.ownerId,
      prompt: "Blocked",
      estimatedCostUsdMicros: 1,
    }),
  ).rejects.toThrow("Project spend cap reached");
  expect(
    await f.owner.query(api.billing.listLedger, { workspaceId: f.workspaceId }),
  ).toHaveLength(0);
});
