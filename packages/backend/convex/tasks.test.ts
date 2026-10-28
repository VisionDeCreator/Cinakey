import { afterEach, describe, expect, it, vi } from "vitest";
import { authIdentity, createFundedTestUser, makeTest } from "../test/helpers";
import { api, internal } from "./_generated/api";

afterEach(() => vi.useRealTimers());
describe("API worker persistence", () => {
  it("claims exclusively, reclaims expired leases, and rejects stale owners", async () => {
    vi.useFakeTimers();
    const t = makeTest();
    const id = await t.mutation(internal.tasks.enqueue, {
      operation: "email:sendNotificationEmail",
      args: {},
      delay: 0,
    });
    expect(
      await t.mutation(internal.tasks.claim, { owner: "a", limit: 4 }),
    ).toHaveLength(1);
    expect(
      await t.mutation(internal.tasks.claim, { owner: "b", limit: 4 }),
    ).toHaveLength(0);
    vi.advanceTimersByTime(121_000);
    expect(
      await t.mutation(internal.tasks.claim, { owner: "b", limit: 4 }),
    ).toHaveLength(1);
    await t.mutation(internal.tasks.complete, { id, owner: "a" });
    expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull();
    await t.mutation(internal.tasks.complete, { id, owner: "b" });
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  });
  it("deduplicates job callbacks", async () => {
    const t = makeTest();
    const first = await t.mutation(internal.tasks.enqueue, {
      operation: "generation:pollJob",
      args: { jobId: "test-job" },
      delay: 0,
    });
    const second = await t.mutation(internal.tasks.enqueue, {
      operation: "generation:submitAndTrack",
      args: { jobId: "test-job" },
      delay: 0,
    });
    expect(second).toBe(first);
    expect(
      await t.run((ctx) => ctx.db.query("apiTasks").collect()),
    ).toHaveLength(1);
  });
  it("atomically queues a reservation and settles it only once", async () => {
    const t = makeTest();
    const userId = await createFundedTestUser(t, "worker@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    const workspaceId = await asUser.mutation(
      api.users.ensurePersonalWorkspace,
      {},
    );
    const projectId = await asUser.mutation(api.projects.create, {
      title: "Film",
    });
    const { balance } = await asUser.query(api.billing.getBalance, {});
    const inputsFileId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["{}"], { type: "application/json" })),
    );
    const jobId = await t.mutation(internal.generation.createQueuedJob, {
      inputsFileId,
      workspaceId,
      projectId,
      model: "gpt-image-2",
      modelVersion: "test",
      kind: "text-to-image",
      prompt: "Film",
      estimatedCostUsdMicros: 10,
      createdBy: userId,
    });
    expect(
      await t.run((ctx) => ctx.db.query("apiTasks").collect()),
    ).toHaveLength(1);
    expect((await asUser.query(api.billing.getBalance, {})).balance).toBe(
      balance - 10,
    );
    await t.mutation(internal.generation.markSucceeded, {
      jobId,
      outputAssetIds: [],
      actualCostUsdMicros: 6,
    });
    await t.mutation(internal.generation.markSucceeded, {
      jobId,
      outputAssetIds: [],
      actualCostUsdMicros: 6,
    });
    await t.mutation(internal.generation.markRefunded, { jobId });
    expect((await asUser.query(api.billing.getBalance, {})).balance).toBe(
      balance - 6,
    );
    expect(
      (await t.query(internal.generation.getJobInternal, { jobId }))?.status,
    ).toBe("succeeded");
    const notifications = await asUser.query(api.notifications.listUnread, {});
    expect(
      notifications.filter((note) => note.kind === "job_succeeded"),
    ).toHaveLength(1);
  });
  it("keeps private projects isolated through authenticated database operations", async () => {
    const t = makeTest();
    const owner = await createFundedTestUser(t, "owner@test.com"),
      stranger = await createFundedTestUser(t, "stranger@test.com");
    const projectId = await t
      .withIdentity(authIdentity(owner))
      .mutation(api.projects.create, { title: "Private" });
    expect(
      await t
        .withIdentity(authIdentity(stranger))
        .query(api.projects.get, { projectId }),
    ).toBeNull();
    await expect(
      t
        .withIdentity(authIdentity(stranger))
        .query(api.projects.get, { projectId }),
    ).resolves.toBeNull();
  });
  it("keeps request-bound text jobs out of the provider queue and recovers interrupted reservations", async () => {
    vi.useFakeTimers();
    const t = makeTest();
    const userId = await createFundedTestUser(t, "text@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    const workspaceId = await asUser.mutation(
      api.users.ensurePersonalWorkspace,
      {},
    );
    const projectId = await asUser.mutation(api.projects.create, {
      title: "Text",
    });
    const before = (await asUser.query(api.billing.getBalance, {})).balance;
    const jobId = await t.mutation(internal.generation.createQueuedJob, {
      workspaceId,
      projectId,
      model: "deepseek",
      modelVersion: "test",
      kind: "chat",
      prompt: "Text",
      estimatedCostUsdMicros: 3,
      createdBy: userId,
    });
    expect(
      await t.run((ctx) => ctx.db.query("apiTasks").collect()),
    ).toHaveLength(0);
    vi.advanceTimersByTime(31 * 60_000);
    await t.mutation(internal.tasks.reconcileGeneration, {
      status: "queued",
      cursor: null,
    });
    await t.mutation(internal.tasks.reconcileGeneration, {
      status: "queued",
      cursor: null,
    });
    expect(
      (await t.query(internal.generation.getJobInternal, { jobId }))?.status,
    ).toBe("refunded");
    expect((await asUser.query(api.billing.getBalance, {})).balance).toBe(
      before,
    );
  });
});

describe("paid submission recovery", () => {
  it("fences duplicate dispatches and holds uncertain outcomes without refund or replay", async () => {
    const t = makeTest();
    const userId = await createFundedTestUser(t, "fence@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    const workspaceId = await asUser.mutation(
      api.users.ensurePersonalWorkspace,
      {},
    );
    const projectId = await asUser.mutation(api.projects.create, {
      title: "Fence",
    });
    const inputsFileId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["{}"], { type: "application/json" })),
    );
    const before = (await asUser.query(api.billing.getBalance, {})).balance;
    const jobId = await t.mutation(internal.generation.createQueuedJob, {
      workspaceId,
      projectId,
      inputsFileId,
      model: "gpt-image-2",
      modelVersion: "test",
      kind: "text-to-image",
      prompt: "Test",
      estimatedCostUsdMicros: 10,
      createdBy: userId,
    });
    expect(
      await t.mutation(internal.generation.beginSubmission, {
        jobId,
        attempt: 1,
      }),
    ).toBe("submit");
    expect(
      await t.mutation(internal.generation.beginSubmission, {
        jobId,
        attempt: 2,
      }),
    ).toBe("review");
    await t.mutation(internal.generation.markSubmissionUncertain, { jobId });
    expect(
      await t.mutation(internal.generation.beginSubmission, {
        jobId,
        attempt: 2,
      }),
    ).toBe("review");
    const tasks = await t.mutation(internal.tasks.claim, {
      owner: "worker",
      limit: 1,
    });
    await t.mutation(internal.tasks.retry, {
      id: tasks[0]!._id,
      owner: "worker",
      permanent: true,
      error: "Review required",
    });
    await t.mutation(internal.tasks.reconcileGeneration, {
      status: "queued",
      cursor: null,
    });
    expect(
      await t.mutation(internal.tasks.claim, { owner: "worker", limit: 1 }),
    ).toHaveLength(0);
    expect((await asUser.query(api.billing.getBalance, {})).balance).toBe(
      before - 10,
    );
  });
  it("resumes accepted synchronous outputs from a durable checkpoint after worker restart", async () => {
    const t = makeTest();
    const userId = await createFundedTestUser(t, "checkpoint@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    const workspaceId = await asUser.mutation(
      api.users.ensurePersonalWorkspace,
      {},
    );
    const projectId = await asUser.mutation(api.projects.create, {
      title: "Checkpoint",
    });
    const inputsFileId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["{}"], { type: "application/json" })),
    );
    const jobId = await t.mutation(internal.generation.createQueuedJob, {
      workspaceId,
      projectId,
      inputsFileId,
      model: "gpt-image-2",
      modelVersion: "test",
      kind: "text-to-image",
      prompt: "Test",
      estimatedCostUsdMicros: 10,
      createdBy: userId,
    });
    const providerResultFileId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([JSON.stringify({ outputs: [] })], {
          type: "application/json",
        }),
      ),
    );
    await t.mutation(internal.generation.beginSubmission, {
      jobId,
      attempt: 1,
    });
    await t.mutation(internal.generation.markSubmitted, {
      jobId,
      providerJobId: "already-accepted",
      attempts: 1,
      providerResultFileId,
      providerActualUnits: 1,
    });
    expect(
      await t.mutation(internal.generation.beginSubmission, {
        jobId,
        attempt: 2,
      }),
    ).toBe("resume");
    const { internal: services } =
      await import("../../../apps/api/src/operations");
    await t.action(services.generation.pollJob, { jobId, pollAttempt: 0 });
    expect(
      (await t.query(internal.generation.getJobInternal, { jobId }))?.status,
    ).toBe("succeeded");
    expect(
      (await t.query(internal.generation.getJobInternal, { jobId }))?.attempts,
    ).toBe(1);
    expect(
      (await t.query(internal.generation.getJobInternal, { jobId }))
        ?.providerResultFileId,
    ).toBeUndefined();
    expect(
      await t.run((ctx) => ctx.storage.get(providerResultFileId)),
    ).toBeNull();
  });
});
