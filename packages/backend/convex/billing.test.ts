import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";
import { STARTER_USD_MICROS } from "./lib/limits";

describe("usdMicros ledger", () => {
  beforeEach(() => {
    process.env.ALLOW_DEV_USD = "true";
  });

  it("grants usdMicros and reports balance", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "usdMicros@test.com");
    const asUser = t.withIdentity(authIdentity(userId));

    await asUser.mutation(api.users.ensurePersonalWorkspace, {});
    const before = await asUser.query(api.billing.getBalance, {});
    expect(before.balance).toBe(STARTER_USD_MICROS);

    const grant = await asUser.mutation(api.billing.grantDev, { amount: 100 });
    expect(grant.balanceAfter).toBe(STARTER_USD_MICROS + 100);

    const after = await asUser.query(api.billing.getBalance, {});
    expect(after.balance).toBe(STARTER_USD_MICROS + 100);
  });

  it("rejects reserve that would go negative", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "poor@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    await asUser.mutation(api.users.ensurePersonalWorkspace, {});
    const balance = await asUser.query(api.billing.getBalance, {});
    const workspaceId = balance.workspaceId!;
    const projectId = await asUser.mutation(api.projects.create, {
      title: "P",
    });

    const jobId = await t.run(async (ctx) => {
      return await ctx.db.insert("generationJobs", {
        projectId,
        model: "gpt-image-2",
        modelVersion: "gpt-image-2",
        kind: "text-to-video",
        prompt: "x",
        estimatedCostUsdMicros: STARTER_USD_MICROS + 50,
        status: "queued",
        outputAssetIds: [],
        attempts: 0,
        createdBy: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(internal.billing.reserve, {
        workspaceId,
        userId,
        projectId,
        jobId,
        amount: STARTER_USD_MICROS + 50,
      }),
    ).rejects.toThrow(/Insufficient USD balance/);
  });

  it("settle returns unused reserved usdMicros", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "settle@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    await asUser.mutation(api.users.ensurePersonalWorkspace, {});
    await asUser.mutation(api.billing.grantDev, { amount: 100 });
    const { workspaceId } = await asUser.query(api.billing.getBalance, {});
    const projectId = await asUser.mutation(api.projects.create, {
      title: "P",
    });

    const jobId = await t.run(async (ctx) => {
      return await ctx.db.insert("generationJobs", {
        projectId,
        model: "gpt-image-2",
        modelVersion: "gpt-image-2",
        kind: "text-to-video",
        prompt: "x",
        estimatedCostUsdMicros: 10,
        status: "queued",
        outputAssetIds: [],
        attempts: 0,
        createdBy: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const base = STARTER_USD_MICROS + 100;
    await t.mutation(internal.billing.reserve, {
      workspaceId: workspaceId!,
      userId,
      projectId,
      jobId,
      amount: 10,
    });
    expect((await asUser.query(api.billing.getBalance, {})).balance).toBe(
      base - 10,
    );

    await t.mutation(internal.billing.settle, {
      workspaceId: workspaceId!,
      userId,
      projectId,
      jobId,
      estimated: 10,
      actual: 7,
    });
    expect((await asUser.query(api.billing.getBalance, {})).balance).toBe(
      base - 7,
    );
  });

  it("refund restores the full reserve", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "refund@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    await asUser.mutation(api.users.ensurePersonalWorkspace, {});
    await asUser.mutation(api.billing.grantDev, { amount: 50 });
    const { workspaceId } = await asUser.query(api.billing.getBalance, {});
    const projectId = await asUser.mutation(api.projects.create, {
      title: "P",
    });

    const jobId = await t.run(async (ctx) => {
      return await ctx.db.insert("generationJobs", {
        projectId,
        model: "gpt-image-2",
        modelVersion: "gpt-image-2",
        kind: "text-to-video",
        prompt: "x",
        estimatedCostUsdMicros: 10,
        status: "queued",
        outputAssetIds: [],
        attempts: 0,
        createdBy: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const base = STARTER_USD_MICROS + 50;
    await t.mutation(internal.billing.reserve, {
      workspaceId: workspaceId!,
      userId,
      projectId,
      jobId,
      amount: 10,
    });
    await t.mutation(internal.billing.refund, {
      workspaceId: workspaceId!,
      userId,
      projectId,
      jobId,
      amount: 10,
    });
    expect((await asUser.query(api.billing.getBalance, {})).balance).toBe(base);
  });
});

describe("generation jobs with mock adapter", () => {
  beforeEach(() => {
    process.env.USE_MOCK_ADAPTERS = "true";
    process.env.ALLOW_DEV_USD = "true";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.USE_MOCK_ADAPTERS;
  });

  async function drain(t: ReturnType<typeof makeTest>) {
    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
    });
  }

  it("succeeds and settles usdMicros", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "job-ok@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    await asUser.mutation(api.users.ensurePersonalWorkspace, {});
    await asUser.mutation(api.billing.grantDev, { amount: 100 });
    const projectId = await asUser.mutation(api.projects.create, {
      title: "Gen",
    });

    const { jobId, estimatedCostUsdMicros } = await asUser.action(
      api.generation.startGeneration,
      {
        projectId,
        adapterId: "seedance-2.5",
        kind: "text-to-video",
        prompt: "a cat",
        input: { mockDelayMs: 0 },
      },
    );
    expect(estimatedCostUsdMicros).toBe(1_218_000);

    await drain(t);

    const job = await asUser.query(api.generation.getJob, { jobId });
    expect(job?.status).toBe("succeeded");
    expect(job?.outputAssetIds.length).toBeGreaterThan(0);
    expect(job?.actualCostUsdMicros).toBeDefined();

    const bal = await asUser.query(api.billing.getBalance, {});
    expect(bal.balance).toBe(
      STARTER_USD_MICROS + 100 - (job?.actualCostUsdMicros ?? 10),
    );

    const notes = await asUser.query(api.notifications.listUnread, {});
    expect(
      notes.some((n: { kind: string }) => n.kind === "job_succeeded"),
    ).toBe(true);
  });

  it("forceFail refunds usdMicros", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "job-fail@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    await asUser.mutation(api.users.ensurePersonalWorkspace, {});
    await asUser.mutation(api.billing.grantDev, { amount: 100 });
    const projectId = await asUser.mutation(api.projects.create, {
      title: "Gen",
    });

    const { jobId } = await asUser.action(api.generation.startGeneration, {
      projectId,
      adapterId: "seedance-2.5",
      kind: "text-to-video",
      prompt: "will fail",
      input: { forceFail: true, mockDelayMs: 0 },
    });

    await drain(t);

    const job = await asUser.query(api.generation.getJob, { jobId });
    expect(job?.status).toBe("refunded");

    const bal = await asUser.query(api.billing.getBalance, {});
    expect(bal.balance).toBe(STARTER_USD_MICROS + 100);

    const notes = await asUser.query(api.notifications.listUnread, {});
    expect(notes.some((n: { kind: string }) => n.kind === "job_failed")).toBe(
      true,
    );
  });

  it("retries transient errors then succeeds", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "job-retry@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    await asUser.mutation(api.users.ensurePersonalWorkspace, {});
    await asUser.mutation(api.billing.grantDev, { amount: 100 });
    const projectId = await asUser.mutation(api.projects.create, {
      title: "Gen",
    });

    const { jobId } = await asUser.action(api.generation.startGeneration, {
      projectId,
      adapterId: "seedance-2.5",
      kind: "text-to-video",
      prompt: "retry me",
      input: { failUntilAttempt: 2, mockDelayMs: 0 },
    });

    await drain(t);

    const job = await asUser.query(api.generation.getJob, { jobId });
    expect(job?.status).toBe("succeeded");
    expect(job?.attempts).toBeGreaterThanOrEqual(2);
  });
});
