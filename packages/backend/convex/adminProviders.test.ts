import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import {
  authIdentity,
  createFundedTestUser,
  createTestUser,
  makeTest,
} from "../test/helpers";
afterEach(() => vi.useRealTimers());
async function fixture() {
  const t = makeTest(),
    userId = await createFundedTestUser(t, "control-owner@test.com"),
    adminId = await createTestUser(t, "control-admin@test.com", {
      isStaff: true,
    }),
    opsId = await createTestUser(t, "control-ops@test.com", { isStaff: true }),
    supportId = await createTestUser(t, "control-support@test.com", {
      isStaff: true,
    });
  await t.run(async (ctx) => {
    await ctx.db.patch(opsId, { adminRoles: ["operations"] });
    await ctx.db.patch(supportId, { adminRoles: ["support"] });
  });
  const user = t.withIdentity(authIdentity(userId)),
    admin = t.withIdentity(authIdentity(adminId)),
    ops = t.withIdentity(authIdentity(opsId)),
    support = t.withIdentity(authIdentity(supportId));
  const projectId = await user.mutation(api.projects.create, {
      title: "Provider controls",
    }),
    workspaceId = (await user.query(api.projects.get, { projectId }))!
      .workspaceId;
  const create = (amount = 1000000, model = "seedance-2.5") =>
    t.mutation(internal.generation.createQueuedJob, {
      projectId,
      workspaceId,
      createdBy: userId,
      model,
      modelVersion: "sume/seedance-2.5",
      kind: "text-to-video",
      prompt: "Provider control test",
      estimatedCostUsdMicros: amount,
    });
  const config = {
    key: "global",
    paused: false,
    maxRequest: null,
    dailyCap: null,
    monthlyCap: null,
    maxOutstanding: null,
    expectedRevision: 0,
    reason: "Apply reviewed platform usage policy",
    requestId: "configure-1",
  };
  const initialize = async () => {
    await admin.mutation(api.adminProviders.initialize, {
      reason: "Initialize historical provider accounting",
      requestId: crypto.randomUUID(),
    });
    for (let i = 0; i < 20; i++) {
      await t.mutation(internal.adminProviders.backfill, {});
      if (
        (await admin.query(api.adminProviders.overview, {})).accounting?.ready
      )
        return;
    }
    throw new Error("Backfill did not complete");
  };
  const refund = (
    jobId: Awaited<ReturnType<typeof create>>,
    amount = 1000000,
  ) =>
    t.mutation(internal.billing.refund, {
      jobId,
      workspaceId,
      userId,
      projectId,
      amount,
    });
  const settle = (
    jobId: Awaited<ReturnType<typeof create>>,
    estimated = 1000000,
    actual = 400000,
  ) =>
    t.mutation(internal.billing.settle, {
      jobId,
      workspaceId,
      userId,
      projectId,
      estimated,
      actual,
    });
  const snapshot = async (key = "global") =>
    (await admin.query(api.adminProviders.overview, {})).scopes.find(
      (s) => s.key === key,
    )!;
  return {
    t,
    user,
    admin,
    ops,
    support,
    userId,
    adminId,
    projectId,
    workspaceId,
    create,
    config,
    initialize,
    refund,
    settle,
    snapshot,
  };
}
it("separates operational pauses from configuration and private usage access", async () => {
  const f = await fixture();
  for (const client of [f.user, f.support])
    await expect(client.query(api.adminProviders.overview, {})).rejects.toThrow(
      /Staff/,
    );
  await f.ops.mutation(api.adminProviders.pause, {
    key: "provider:sume",
    reason: "Stop new paid work during an outage",
    requestId: "pause-1",
  });
  await expect(
    f.ops.mutation(api.adminProviders.configure, {
      ...f.config,
      key: "provider:sume",
      expectedRevision: 1,
    }),
  ).rejects.toThrow(/permission/);
  expect(
    (await f.user.query(api.adminProviders.availability, {})).models.find(
      (m) => m.id === "seedance-2.5",
    )?.available,
  ).toBe(false);
  expect(
    JSON.stringify(await f.user.query(api.adminProviders.availability, {})),
  ).not.toContain("Stop new paid work");
});
it("enforces global, provider and model pauses for new text and video reservations", async () => {
  const f = await fixture();
  await f.admin.mutation(api.adminProviders.pause, {
    key: "provider:sume",
    reason: "Pause a provider during investigation",
    requestId: "pause-sume",
  });
  await expect(f.create()).rejects.toThrow(/paused/);
  const text = await f.t.mutation(internal.textJobs.createChatJob, {
    projectId: f.projectId,
    workspaceId: f.workspaceId,
    userId: f.userId,
    prompt: "Analyze",
    estimatedCostUsdMicros: 1000,
  });
  expect(text).toBeTruthy();
  await f.admin.mutation(api.adminProviders.pause, {
    key: "model:deepseek",
    reason: "Pause text model after an incident",
    requestId: "pause-text",
  });
  await expect(
    f.t.mutation(internal.textJobs.createChatJob, {
      projectId: f.projectId,
      workspaceId: f.workspaceId,
      userId: f.userId,
      prompt: "Analyze",
      estimatedCostUsdMicros: 1000,
    }),
  ).rejects.toThrow(/paused/);
});
it("rejects stale configurations, changed replays and unknown policy scopes", async () => {
  const f = await fixture();
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    maxRequest: 500000,
  });
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    maxRequest: 500000,
  });
  await expect(
    f.admin.mutation(api.adminProviders.configure, {
      ...f.config,
      maxRequest: 600000,
    }),
  ).rejects.toThrow(/mismatch/);
  await expect(
    f.admin.mutation(api.adminProviders.configure, {
      ...f.config,
      requestId: "stale",
    }),
  ).rejects.toThrow(/controls changed/);
  await expect(
    f.admin.mutation(api.adminProviders.configure, {
      ...f.config,
      key: "provider:unpriced",
    }),
  ).rejects.toThrow(/Unknown/);
  await expect(
    f.admin.mutation(api.adminProviders.configure, {
      ...f.config,
      maxRequest: -1,
    }),
  ).rejects.toThrow(/non-negative/);
});
it("enforces per-request ceilings without requiring a historical scan", async () => {
  const f = await fixture();
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    maxRequest: 500000,
  });
  await expect(f.create(500001)).rejects.toThrow(/per-request limit/);
  expect(await f.create(500000)).toBeTruthy();
});
it("requires completed historical initialization before aggregate limits can be enabled", async () => {
  const f = await fixture();
  await f.create();
  await expect(
    f.admin.mutation(api.adminProviders.configure, {
      ...f.config,
      dailyCap: 2000000,
    }),
  ).rejects.toThrow(/Initialize provider accounting/);
  await f.initialize();
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    dailyCap: 2000000,
  });
  expect((await f.snapshot()).all?.reserved).toBe(1000000);
});
it("counts unresolved reservations and releases unused funds exactly once", async () => {
  const f = await fixture();
  await f.initialize();
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    dailyCap: 1500000,
  });
  const job = await f.create();
  await expect(f.create()).rejects.toThrow(/UTC spend limit/);
  await f.settle(job);
  await f.settle(job);
  const snapshot = await f.snapshot();
  expect(snapshot.all).toMatchObject({ reserved: 0, spent: 400000, active: 0 });
  expect(snapshot.day?.spent).toBe(400000);
  expect(await f.create()).toBeTruthy();
});
it("limits outstanding reservations across video models sharing a provider", async () => {
  const f = await fixture();
  await f.initialize();
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    key: "provider:sume",
    maxOutstanding: 1,
  });
  const job = await f.create();
  await expect(f.create(1000000, "sume-remix-lite")).rejects.toThrow(
    /outstanding-reservation limit/,
  );
  await f.refund(job);
  await f.refund(job);
  expect(await f.create(1000000, "sume-remix-lite")).toBeTruthy();
});
it("includes old outstanding holds across UTC day and month rollover", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T23:59:59Z"));
  const f = await fixture();
  await f.initialize();
  const job = await f.create();
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    monthlyCap: 1000000,
    dailyCap: 1000000,
  });
  vi.setSystemTime(new Date("2026-11-01T00:00:01Z"));
  await expect(f.create(1)).rejects.toThrow(/UTC spend limit/);
  await f.settle(job);
  const snapshot = await f.snapshot();
  expect(snapshot.month?.spent).toBe(400000);
  expect(snapshot.day?.spent).toBe(400000);
  expect(await f.create(600000)).toBeTruthy();
});
it("pauses proven unsubmitted work with one release while preserving accepted and uncertain jobs", async () => {
  const f = await fixture(),
    queued = await f.create(),
    accepted = await f.create(),
    uncertain = await f.create();
  await f.t.mutation(internal.generation.markSubmitted, {
    jobId: accepted,
    providerJobId: "provider-id",
    attempts: 1,
  });
  await f.t.mutation(internal.generation.markSubmissionUncertain, {
    jobId: uncertain,
  });
  await f.ops.mutation(api.adminProviders.pause, {
    key: "global",
    reason: "Stop requests during provider outage",
    requestId: "stop-1",
  });
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId: queued,
      attempt: 1,
    }),
  ).toBe("terminal");
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId: queued,
      attempt: 1,
    }),
  ).toBe("terminal");
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId: accepted,
      attempt: 2,
    }),
  ).toBe("resume");
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId: uncertain,
      attempt: 2,
    }),
  ).toBe("review");
  expect((await f.snapshot()).all).toMatchObject({
    reserved: 2000000,
    active: 2,
  });
});
it("preserves admitted work when limits are lowered rather than paused", async () => {
  const f = await fixture();
  await f.initialize();
  const job = await f.create();
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    dailyCap: 0,
  });
  expect(
    await f.t.mutation(internal.generation.beginSubmission, {
      jobId: job,
      attempt: 1,
    }),
  ).toBe("submit");
  await expect(f.create(1)).rejects.toThrow(/UTC spend limit/);
});
it("accounts company-funded work at its standard authorized price", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.workspaceId, { billingMode: "internal" }),
  );
  await f.initialize();
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    dailyCap: 1000000,
  });
  const job = await f.create();
  await expect(f.create(1)).rejects.toThrow(/UTC spend limit/);
  await f.settle(job);
  expect((await f.snapshot()).day?.spent).toBe(400000);
});
it("rebuilds legacy jobs without double counting settlements arriving during backfill", async () => {
  const f = await fixture(),
    a = await f.create(),
    b = await f.create();
  await f.t.run(async (ctx) => {
    for (const row of await ctx.db.query("providerTotals").collect())
      await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("providerJobAccounting").collect())
      await ctx.db.delete(row._id);
  });
  await f.admin.mutation(api.adminProviders.initialize, {
    reason: "Initialize missing historical provider totals",
    requestId: "initialize-1",
  });
  await f.settle(a);
  await f.t.mutation(internal.adminProviders.backfill, {});
  expect((await f.snapshot()).all).toMatchObject({
    reserved: 1000000,
    spent: 400000,
    active: 1,
  });
  await f.initialize();
  expect((await f.snapshot()).all).toMatchObject({
    reserved: 1000000,
    spent: 400000,
    active: 1,
  });
  expect(await f.t.run((ctx) => ctx.db.get(b))).toBeTruthy();
});
it("paginates historical jobs to completion and remains idempotent", async () => {
  const f = await fixture();
  for (let i = 0; i < 65; i++) await f.create(1000);
  await f.initialize();
  const before = await f.snapshot();
  expect(before.all).toMatchObject({ reserved: 65000, active: 65 });
  await f.initialize();
  expect((await f.snapshot()).all).toEqual(before.all);
});
it("keeps unresolved billing review holds committed and blocks account purge", async () => {
  const f = await fixture(),
    job = await f.create();
  await f.t.run((ctx) =>
    ctx.db.patch(job, { status: "succeeded", billingNeedsReview: true }),
  );
  await f.initialize();
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    maxOutstanding: 1,
  });
  await expect(f.create()).rejects.toThrow(/outstanding-reservation limit/);
  await expect(
    f.user.mutation(api.users.deleteAccount, { confirm: "DELETE" }),
  ).rejects.toThrow(/outstanding usage/);
  await expect(
    f.t.mutation(internal.users.purgeUserData, { userId: f.userId }),
  ).rejects.toThrow(/outstanding usage/);
});
it("rejects admission when simultaneous reservations contend for the same remaining cap", async () => {
  const f = await fixture();
  await f.initialize();
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    dailyCap: 1000000,
  });
  const results = await Promise.allSettled([f.create(), f.create()]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await f.snapshot()).all?.reserved).toBe(1000000);
});
it("fails initialization safely when an accepted historical job lacks reservation evidence", async () => {
  const f = await fixture();
  const jobId = await f.t.run((ctx) =>
    ctx.db.insert("generationJobs", {
      projectId: f.projectId,
      workspaceId: f.workspaceId,
      createdBy: f.userId,
      model: "seedance-2.5",
      modelVersion: "legacy",
      kind: "text-to-video",
      prompt: "Legacy request",
      estimatedCostUsdMicros: 1000000,
      status: "running",
      outputAssetIds: [],
      attempts: 1,
      providerJobId: "legacy-provider-id",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  await f.admin.mutation(api.adminProviders.initialize, {
    reason: "Initialize existing provider accounting",
    requestId: "initialize-1",
  });
  await expect(
    f.t.mutation(internal.adminProviders.backfill, {}),
  ).rejects.toThrow(/Missing provider reservation/);
  expect(
    (await f.admin.query(api.adminProviders.overview, {})).accounting?.ready,
  ).toBe(false);
  await expect(
    f.admin.mutation(api.adminProviders.configure, {
      ...f.config,
      dailyCap: 1000000,
    }),
  ).rejects.toThrow(/Initialize provider accounting/);
  expect(await f.t.run((ctx) => ctx.db.get(jobId))).toBeTruthy();
});
it("lets model-specific limits coexist with a stricter global cap", async () => {
  const f = await fixture();
  await f.initialize();
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    dailyCap: 1000000,
  });
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    key: "model:seedance-2.5",
    dailyCap: 2000000,
    requestId: "model-1",
  });
  await f.create();
  await expect(f.create(1)).rejects.toThrow(/global UTC spend limit/);
});
it("keeps accounting incomplete and aggregate admission blocked during a rescan", async () => {
  const f = await fixture();
  await f.initialize();
  await f.admin.mutation(api.adminProviders.configure, {
    ...f.config,
    dailyCap: 1000000,
  });
  await f.admin.mutation(api.adminProviders.initialize, {
    reason: "Rescan historical provider accounting safely",
    requestId: "rescan-1",
  });
  await expect(f.create()).rejects.toThrow(
    /awaiting accounting initialization/,
  );
  await f.t.mutation(internal.adminProviders.backfill, {});
  expect(await f.create()).toBeTruthy();
});
