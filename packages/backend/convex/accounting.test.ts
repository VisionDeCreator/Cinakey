import { fundTestWorkspace } from "../test/helpers";
import { setTestProviders } from "../../../apps/api/test/setup";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";
async function fixture(funded = true) {
  const t = makeTest();
  const userId = await createTestUser(t, "usd@test.com");
  const owner = t.withIdentity(authIdentity(userId));
  const projectId = await owner.mutation(api.projects.create, {
    title: "Film",
  });
  const workspaceId = (await owner.query(api.projects.get, { projectId }))!
    .workspaceId;
  if (funded) await fundTestWorkspace(t, userId, 5_000_000);
  const quote = () =>
    owner.mutation(api.generation.quote, {
      projectId,
      adapterId: "seedance-2.5",
      kind: "text-to-video",
      durationSec: 5,
      resolution: "720p",
      maxCostUsdMicros: 1_218_000,
    });
  const start = (
    quoteId: Awaited<ReturnType<typeof quote>>["quoteId"],
    requestId = "generation",
  ) =>
    owner.action(api.generation.startGeneration, {
      projectId,
      adapterId: "seedance-2.5",
      kind: "text-to-video",
      prompt: "Film",
      input: { durationSec: 5, resolution: "720p", mockDelayMs: 0 },
      quoteId,
      requestId,
    });
  return { t, userId, owner, projectId, workspaceId, quote, start };
}
afterEach(() => vi.useRealTimers());
describe("USD authorizations and accounting", () => {
  it("locks quoted prices and snapshots instead of using today's adapter price", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const quote = await f.quote();
    // Fixture for an unexpired authorization issued under an earlier USD rate card.
    await f.t.run((ctx) =>
      ctx.db.patch(quote.quoteId, {
        priceVersion: "dev-prior",
        unitUsdMicros: 600_000,
        maximumUsdMicros: 3_000_000,
      }),
    );
    const { jobId, estimatedCostUsdMicros } = await f.start(quote.quoteId);
    expect(estimatedCostUsdMicros).toBe(3_000_000);
    const job = await f.owner.query(api.generation.getJob, { jobId });
    expect(job).toMatchObject({
      priceVersion: "dev-prior",
      unitUsdMicros: 600_000,
      estimatedCostUsdMicros: 3_000_000,
    });
    await f.t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
    });
    expect(
      (await f.owner.query(api.generation.getJob, { jobId }))
        ?.actualCostUsdMicros,
    ).toBe(3_000_000);
    expect(
      (await f.owner.query(api.billing.budgets, { workspaceId: f.workspaceId }))
        .account,
    ).toEqual({ available: 2_000_000, spent: 3_000_000, reserved: 0 });
    expect(
      (await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }))
        .consistent,
    ).toBe(true);
  });
  it("rejects expired, reused and changed-input authorizations while replaying the same request", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const quote = await f.quote();
    const first = await f.start(quote.quoteId);
    expect((await f.start(quote.quoteId)).jobId).toBe(first.jobId);
    await expect(f.start(quote.quoteId, "different")).rejects.toThrow(
      "already used",
    );
    const expired = await f.quote();
    vi.advanceTimersByTime(600_001);
    await expect(f.start(expired.quoteId, "expired")).rejects.toThrow(
      "expired",
    );
    const changed = await f.quote();
    await expect(
      f.owner.action(api.generation.startGeneration, {
        projectId: f.projectId,
        adapterId: "seedance-2.5",
        kind: "text-to-video",
        prompt: "Film",
        quoteId: changed.quoteId,
        input: { durationSec: 6 },
      }),
    ).rejects.toThrow("Quote scope or price mismatch");
  });
  it("rejects a price above the user's accepted maximum and another user's quote", async () => {
    const f = await fixture();
    await expect(
      f.owner.mutation(api.generation.quote, {
        projectId: f.projectId,
        adapterId: "seedance-2.5",
        kind: "text-to-video",
        durationSec: 5,
        resolution: "1080p",
        maxCostUsdMicros: 1_218_000,
      }),
    ).rejects.toThrow("accepted maximum");
    const quote = await f.quote();
    const otherId = await createTestUser(f.t, "other-usd@test.com");
    const other = f.t.withIdentity(authIdentity(otherId));
    const otherProject = await other.mutation(api.projects.create, {
      title: "Other",
    });
    await expect(
      other.action(api.generation.startGeneration, {
        projectId: otherProject,
        adapterId: "seedance-2.5",
        kind: "text-to-video",
        prompt: "Film",
        quoteId: quote.quoteId,
        input: { durationSec: 5 },
      }),
    ).rejects.toThrow("Quote scope or price mismatch");
  });
  it("deduplicates identified development funding and rejects conflicting replays", async () => {
    const f = await fixture();
    const request = { amount: 1_000_000, requestId: "manual-test-funding" };
    await fundTestWorkspace(f.t, f.userId, request.amount, request.requestId);
    await fundTestWorkspace(f.t, f.userId, request.amount, request.requestId);
    expect((await f.owner.query(api.billing.getBalance, {})).balance).toBe(
      6_000_000,
    );
    await expect(
      fundTestWorkspace(f.t, f.userId, 2_000_000, request.requestId),
    ).rejects.toThrow("Funding request mismatch");
  });
  it("rebuilds corrupted aggregates from the ledger and rejects a stale rebuild sequence", async () => {
    const f = await fixture();
    const quote = await f.quote();
    const { jobId } = await f.start(quote.quoteId);
    await f.t.mutation(internal.generation.markRefunded, { jobId });
    const before = await f.t.query(internal.billing.audit, {
      workspaceId: f.workspaceId,
    });
    expect(before.consistent).toBe(true);
    await f.t.run(async (ctx) => {
      const account = await ctx.db
        .query("billingAccounts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", f.workspaceId))
        .unique();
      await ctx.db.patch(account!._id, { reserved: 123 });
      const totals = await ctx.db.query("spendTotals").collect();
      await ctx.db.patch(totals[0]!._id, { spentUsdMicros: 12 });
    });
    expect(
      (await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }))
        .consistent,
    ).toBe(false);
    await expect(
      f.t.mutation(internal.billing.rebuildTotals, {
        workspaceId: f.workspaceId,
        expectedSequence: before.account.sequence - 1,
      }),
    ).rejects.toThrow("Account changed");
    await f.t.mutation(internal.billing.rebuildTotals, {
      workspaceId: f.workspaceId,
      expectedSequence: before.account.sequence,
    });
    expect(
      (await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }))
        .consistent,
    ).toBe(true);
  });
  it("never grants automatic dollars on workspace creation or repeat visits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T02:00:00Z"));
    setTestProviders(false);
    const f = await fixture(false);
    await f.owner.mutation(api.users.ensurePersonalWorkspace, {});
    await f.owner.mutation(api.users.ensurePersonalWorkspace, {});
    expect((await f.owner.query(api.billing.getBalance, {})).balance).toBe(0);
    expect(await f.owner.query(api.billing.listLedger, {})).toEqual([]);
  });
  it("keeps missing text usage reserved for review and settles it once when reconciled", async () => {
    const f = await fixture();
    const jobId = await f.t.mutation(internal.textJobs.createChatJob, {
      projectId: f.projectId,
      workspaceId: f.workspaceId,
      userId: f.userId,
      estimatedCostUsdMicros: 20_000,
      prompt: "Analysis",
    });
    const args = {
      jobId,
      projectId: f.projectId,
      workspaceId: f.workspaceId,
      userId: f.userId,
      actualCostUsdMicros: 0,
      succeeded: true,
    };
    await f.t.mutation(internal.textJobs.settleChatJob, {
      ...args,
      usageMissing: true,
    });
    expect(
      (await f.owner.query(api.billing.budgets, { workspaceId: f.workspaceId }))
        .account.reserved,
    ).toBe(20_000);
    await f.t.mutation(internal.textJobs.settleChatJob, {
      ...args,
      usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 1000 },
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
    await f.t.mutation(internal.textJobs.settleChatJob, {
      ...args,
      actualCostUsdMicros: 4_000,
    });
    expect(
      (await f.owner.query(api.billing.budgets, { workspaceId: f.workspaceId }))
        .account,
    ).toMatchObject({ reserved: 0, spent: 1_575 });
  });
});
it("settles token categories at the authorized snapshot and stores peak supplier cost separately", async () => {
  const f = await fixture();
  const jobId = await f.t.mutation(internal.textJobs.createChatJob, {
    projectId: f.projectId,
    workspaceId: f.workspaceId,
    userId: f.userId,
    estimatedCostUsdMicros: 20_000,
    prompt: "Categories",
  });
  // A historical accepted snapshot must win even when today's shared card differs.
  await f.t.run((ctx) =>
    ctx.db.patch(jobId, {
      priceVersion: "saved-token-price",
      usageMarkupBps: 2500,
      supplierTokenRateSnapshot: {
        cachedInput: 500_000,
        input: 1_000_000,
        output: 2_000_000,
      },
    }),
  );
  const usage = {
    inputTokens: 1000,
    cachedInputTokens: 500,
    outputTokens: 500,
  };
  const args = {
    jobId,
    projectId: f.projectId,
    workspaceId: f.workspaceId,
    userId: f.userId,
    actualCostUsdMicros: 19_999,
    usage,
    batches: [
      {
        ...usage,
        period: "peak" as const,
        providerCreatedAt: Date.UTC(2026, 9, 28, 2),
      },
    ],
    succeeded: true,
  };
  await f.t.mutation(internal.textJobs.settleChatJob, args);
  const job = await f.t.run((ctx) => ctx.db.get(jobId));
  expect(job).toMatchObject({
    modelVersion: "deepseek-flash",
    priceVersion: "saved-token-price",
    actualCostUsdMicros: 2188,
    supplierCostUpperBoundUsdMicros: 1750,
    supplierActualCostUsdMicros: 1750,
    tokenUsage: usage,
    billingNeedsReview: false,
  });
  await f.t.mutation(internal.textJobs.settleChatJob, {
    ...args,
    usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 1000 },
  });
  expect((await f.t.run((ctx) => ctx.db.get(jobId)))?.actualCostUsdMicros).toBe(
    2188,
  );
  expect(
    (await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }))
      .consistent,
  ).toBe(true);
});
it("never charges beyond a text reservation and flags unexpected provider usage for review", async () => {
  const f = await fixture();
  const jobId = await f.t.mutation(internal.textJobs.createChatJob, {
    projectId: f.projectId,
    workspaceId: f.workspaceId,
    userId: f.userId,
    estimatedCostUsdMicros: 10,
    prompt: "Bound",
  });
  await f.t.mutation(internal.textJobs.settleChatJob, {
    jobId,
    projectId: f.projectId,
    workspaceId: f.workspaceId,
    userId: f.userId,
    actualCostUsdMicros: 0,
    usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 1000 },
    batches: [
      {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 1000,
        period: "peak",
        providerCreatedAt: Date.UTC(2026, 9, 28, 2),
      },
    ],
    succeeded: true,
  });
  expect(await f.t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
    actualCostUsdMicros: 10,
    billingNeedsReview: true,
  });
});
it("autofill settles measured token categories instead of charging its fixed maximum", async () => {
  const f = await fixture();
  const entityId = await f.owner.mutation(api.entities.create, {
    projectId: f.projectId,
    kind: "character",
    name: "Hero",
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T02:00:00Z"));
  setTestProviders(false);
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture-key");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        created: Math.floor(Date.now() / 1000),
        choices: [
          {
            message: {
              content: JSON.stringify({
                description: "A hero",
                look: "Red coat",
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 1000,
          prompt_cache_hit_tokens: 0,
          total_tokens: 2000,
        },
      }),
    ),
  );
  const result = await f.owner.action(api.entities.autofillSheet, { entityId });
  expect(result.actualCostUsdMicros).toBe(1575);
  expect(result.actualCostUsdMicros).toBeLessThan(
    result.estimatedCostUsdMicros,
  );
  const jobs = await f.t.run((ctx) => ctx.db.query("generationJobs").collect());
  expect(jobs[0]).toMatchObject({
    entityId,
    kind: "look-dev-autofill",
    status: "succeeded",
    actualCostUsdMicros: 1575,
    tokenUsage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 1000 },
  });
});

it.each([
  ["seedance-2.5", "720p", 1218000, 1160000, 1218000],
  ["seedance-2.5", "1080p", 2992500, 2840000, 2982000],
  ["sume-remix-lite", "720p", 525000, 500000, 525000],
  ["sume-remix-lite", "1080p", 1050000, 1000000, 1050000],
] as const)(
  "settles %s %s from the captured supplier receipt, releasing unused quote funds",
  async (model, resolution, maximum, supplier, charged) => {
    const f = await fixture();
    const kind = "text-to-video";
    const quote = await f.owner.mutation(api.generation.quote, {
      projectId: f.projectId,
      adapterId: model,
      kind,
      durationSec: 5,
      resolution,
      maxCostUsdMicros: maximum,
    });
    const jobId = await f.t.mutation(internal.generation.createQueuedJob, {
      projectId: f.projectId,
      workspaceId: f.workspaceId,
      createdBy: f.userId,
      model,
      modelVersion: "fixture",
      kind,
      prompt: "Receipt",
      estimatedCostUsdMicros: maximum,
      quoteId: quote.quoteId,
      durationSec: 5,
      resolution,
    });
    await f.t.mutation(internal.generation.recordSupplierCharge, {
      jobId,
      amount: supplier,
    });
    const args = { jobId, outputAssetIds: [], actualCostUsdMicros: maximum };
    await f.t.mutation(internal.generation.markSucceeded, args);
    await f.t.mutation(internal.generation.markSucceeded, args);
    expect(await f.t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      actualCostUsdMicros: charged,
      supplierActualCostUsdMicros: supplier,
      usageMarkupBps: 500,
      billingNeedsReview: false,
    });
    expect(
      (await f.owner.query(api.billing.budgets, { workspaceId: f.workspaceId }))
        .account,
    ).toMatchObject({
      reserved: 0,
      spent: charged,
      available: 5000000 - charged,
    });
    await expect(
      f.t.mutation(internal.generation.recordSupplierCharge, {
        jobId,
        amount: supplier + 1,
      }),
    ).rejects.toThrow("receipt changed");
    expect(
      (await f.t.query(internal.billing.audit, { workspaceId: f.workspaceId }))
        .consistent,
    ).toBe(true);
  },
);
it("settles mixed peak and off-peak DeepSeek calls from cache-aware batches instead of the peak reserve", async () => {
  const f = await fixture();
  const jobId = await f.t.mutation(internal.textJobs.createChatJob, {
    projectId: f.projectId,
    workspaceId: f.workspaceId,
    userId: f.userId,
    estimatedCostUsdMicros: 20000,
    prompt: "Mixed",
  });
  const batch = {
    inputTokens: 1000,
    cachedInputTokens: 500,
    outputTokens: 500,
  };
  await f.t.mutation(internal.textJobs.settleChatJob, {
    jobId,
    projectId: f.projectId,
    workspaceId: f.workspaceId,
    userId: f.userId,
    actualCostUsdMicros: 19999,
    succeeded: true,
    usage: { inputTokens: 2000, cachedInputTokens: 1000, outputTokens: 1000 },
    batches: [
      { ...batch, period: "peak", providerCreatedAt: Date.UTC(2026, 9, 28, 2) },
      {
        ...batch,
        period: "off_peak",
        providerCreatedAt: Date.UTC(2026, 9, 28, 12),
      },
    ],
  });
  expect(await f.t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
    supplierActualCostUsdMicros: 1130,
    actualCostUsdMicros: 1187,
    billingNeedsReview: false,
  });
  expect(
    (await f.owner.query(api.billing.budgets, { workspaceId: f.workspaceId }))
      .account,
  ).toMatchObject({ reserved: 0, spent: 1187 });
});
