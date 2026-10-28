import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createFundedTestUser, makeTest } from "../test/helpers";

async function fixture() {
  const t = makeTest();
  const userId = await createFundedTestUser(t, "budget@test.com");
  const owner = t.withIdentity(authIdentity(userId));
  const projectId = await owner.mutation(api.projects.create, {
    title: "Episode",
  });
  const project = await owner.query(api.projects.get, { projectId });
  const workspaceId = project!.workspaceId;
  const reserve = async (amount = 10) => {
    const id = await t.mutation(internal.textJobs.createChatJob, {
      workspaceId,
      projectId,
      userId,
      estimatedCostUsdMicros: amount,
      prompt: "Analysis",
    });
    await t.run((ctx) => ctx.db.patch(id, { usageMarkupBps: undefined }));
    return id;
  };
  const report = () => owner.query(api.billing.budgets, { workspaceId });
  const settle = (
    jobId: Awaited<ReturnType<typeof reserve>>,
    actual = 7,
    succeeded = true,
  ) =>
    t.mutation(internal.textJobs.settleChatJob, {
      workspaceId,
      projectId,
      userId,
      jobId,
      actualCostUsdMicros: actual,
      // Supply verified usage corresponding to the integer budget fixture.
      usage: {
        inputTokens: Math.floor((actual * 1000) / 315),
        cachedInputTokens: 0,
        outputTokens: 0,
      },
      succeeded,
    });
  return { t, owner, userId, projectId, workspaceId, reserve, report, settle };
}
afterEach(() => vi.useRealTimers());

describe("production budgets", () => {
  it("separates holds from settled spending and returns unused capacity", async () => {
    const f = await fixture();
    await f.owner.mutation(api.billing.setBudget, {
      workspaceId: f.workspaceId,
      cap: 12,
    });
    const jobId = await f.reserve();
    expect((await f.report()).workspace).toMatchObject({
      spentUsdMicros: 0,
      reservedUsdMicros: 10,
      remaining: 2,
    });
    await expect(f.reserve(3)).rejects.toThrow("Workspace monthly spend cap");
    await f.settle(jobId);
    expect((await f.report()).workspace).toMatchObject({
      spentUsdMicros: 7,
      reservedUsdMicros: 0,
      remaining: 5,
    });
    await f.settle(jobId); // a retried completion must not charge twice
    const failed = await f.reserve(5);
    await f.settle(failed, 0, false);
    expect((await f.report()).workspace).toMatchObject({
      spentUsdMicros: 7,
      reservedUsdMicros: 0,
      remaining: 5,
    });
  });

  it("pins series attribution even when an episode is moved before settlement", async () => {
    const f = await fixture();
    const first = await f.owner.mutation(api.series.create, { title: "First" });
    const second = await f.owner.mutation(api.series.create, {
      title: "Second",
    });
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { seriesId: first }));
    await f.owner.mutation(api.billing.setBudget, {
      workspaceId: f.workspaceId,
      seriesId: first,
      cap: 10,
    });
    const jobId = await f.reserve();
    await expect(f.reserve(1)).rejects.toThrow("Series spend cap");
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { seriesId: second }));
    await f.settle(jobId, 6);
    const report = await f.report();
    expect(report.series.find((s) => s.id === first)).toMatchObject({
      spentUsdMicros: 6,
      reservedUsdMicros: 0,
    });
    expect(report.series.find((s) => s.id === second)).toMatchObject({
      spentUsdMicros: 0,
      reservedUsdMicros: 0,
    });
    expect(report.projects[0]).toMatchObject({ spentUsdMicros: 6 });
  });

  it("releases an old month hold without consuming the next month's cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T23:59:00Z"));
    const f = await fixture();
    await f.owner.mutation(api.billing.setBudget, {
      workspaceId: f.workspaceId,
      cap: 10,
    });
    const previous = await f.reserve();
    vi.setSystemTime(new Date("2026-11-01T00:01:00Z"));
    const next = await f.reserve();
    await f.settle(previous, 8);
    expect(await f.report()).toMatchObject({
      month: "2026-11",
      workspace: { spentUsdMicros: 0, reservedUsdMicros: 10, remaining: 0 },
    });
    await f.settle(next, 7);
    expect((await f.report()).projects[0]).toMatchObject({
      spentUsdMicros: 15,
      reservedUsdMicros: 0,
    });
  });

  it("applies a workspace cap across different projects and concurrent requests", async () => {
    const f = await fixture();
    const other = await f.owner.mutation(api.projects.create, {
      title: "Other",
    });
    await f.owner.mutation(api.billing.setBudget, {
      workspaceId: f.workspaceId,
      cap: 10,
    });
    const results = await Promise.allSettled([
      f.reserve(),
      f.t.mutation(internal.textJobs.createChatJob, {
        workspaceId: f.workspaceId,
        projectId: other,
        userId: f.userId,
        estimatedCostUsdMicros: 10,
        prompt: "Other",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await f.report()).workspace.reservedUsdMicros).toBe(10);
  });

  it("rejects fractional budgets, forged settlement scopes and excess releases", async () => {
    const f = await fixture();
    await expect(
      f.owner.mutation(api.billing.setBudget, {
        workspaceId: f.workspaceId,
        cap: 1.5,
      }),
    ).rejects.toThrow("non-negative integer");
    await expect(
      f.owner.mutation(api.projects.update, {
        projectId: f.projectId,
        spendCapUsdMicros: -1,
      }),
    ).rejects.toThrow("non-negative integer");
    const jobId = await f.reserve();
    const otherUserId = await createFundedTestUser(f.t, "forged@test.com");
    await expect(
      f.t.mutation(internal.textJobs.settleChatJob, {
        workspaceId: f.workspaceId,
        projectId: f.projectId,
        userId: otherUserId,
        jobId,
        actualCostUsdMicros: 0,
        succeeded: true,
      }),
    ).rejects.toThrow("scope mismatch");
    await expect(f.settle(jobId, -1)).rejects.toThrow("Invalid actual cost");
    await expect(
      f.t.mutation(internal.billing.refund, {
        workspaceId: f.workspaceId,
        projectId: f.projectId,
        userId: f.userId,
        jobId,
        amount: 11,
      }),
    ).rejects.toThrow("Invalid reservation release");
    expect((await f.report()).workspace.reservedUsdMicros).toBe(10);
  });

  it("lets assigned Creators see project usage but denies workspace finances and cap edits", async () => {
    const f = await fixture();
    const creatorId = await createFundedTestUser(
      f.t,
      "creator-budget@test.com",
    );
    const creator = f.t.withIdentity(authIdentity(creatorId));
    await f.t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        workspaceId: f.workspaceId,
        userId: creatorId,
        role: "creator",
        createdAt: Date.now(),
      });
      await ctx.db.insert("productionAssignments", {
        workspaceId: f.workspaceId,
        userId: creatorId,
        projectId: f.projectId,
        manageReviews: false,
      });
    });
    await f.reserve();
    expect(
      await creator.query(api.workspace.spend, { projectId: f.projectId }),
    ).toMatchObject({ spentUsdMicros: 0, reservedUsdMicros: 10 });
    const failure = await f.t
      .mutation(internal.textJobs.createChatJob, {
        workspaceId: f.workspaceId,
        projectId: f.projectId,
        userId: creatorId,
        estimatedCostUsdMicros: 6_000_000,
        prompt: "Unfunded analysis",
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConvexError);
    if (failure instanceof ConvexError) {
      const data: unknown =
        typeof failure.data === "string"
          ? JSON.parse(failure.data)
          : failure.data;
      expect(data).toMatchObject({
        code: "INSUFFICIENT_FUNDS",
        required: 6_000_000,
      });
      expect(data).not.toHaveProperty("balance");
    }
    await expect(
      creator.query(api.billing.budgets, { workspaceId: f.workspaceId }),
    ).rejects.toThrow();
    await expect(
      creator.mutation(api.billing.setBudget, {
        workspaceId: f.workspaceId,
        projectId: f.projectId,
        cap: 100,
      }),
    ).rejects.toThrow();
  });
});
