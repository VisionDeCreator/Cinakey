import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";
async function fixture() {
  const t = makeTest();
  const userId = await createTestUser(t, "usd@test.com");
  const owner = t.withIdentity(authIdentity(userId));
  const projectId = await owner.mutation(api.projects.create, {
    title: "Film",
  });
  const workspaceId = (await owner.query(api.projects.get, { projectId }))!
    .workspaceId;
  const quote = () =>
    owner.mutation(api.generation.quote, {
      projectId,
      adapterId: "seedance-2.5",
      kind: "text-to-video",
      durationSec: 5,
      resolution: "720p",
      maxCostUsdMicros: 1_700_000,
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
        maxCostUsdMicros: 1_700_000,
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
    vi.stubEnv("ALLOW_DEV_USD", "true");
    const request = { amount: 1_000_000, requestId: "manual-test-funding" };
    await f.owner.mutation(api.billing.grantDev, request);
    await f.owner.mutation(api.billing.grantDev, request);
    expect((await f.owner.query(api.billing.getBalance, {})).balance).toBe(
      6_000_000,
    );
    await expect(
      f.owner.mutation(api.billing.grantDev, { ...request, amount: 2_000_000 }),
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
  it("does not grant development fixture dollars outside explicit development mode", async () => {
    vi.stubEnv("USE_MOCK_ADAPTERS", "false");
    vi.stubEnv("ALLOW_DEV_USD", "false");
    const f = await fixture();
    expect((await f.owner.query(api.billing.getBalance, {})).balance).toBe(0);
    await expect(
      f.owner.mutation(api.billing.grantDev, { amount: 5_000_000 }),
    ).rejects.toThrow("require staff");
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
      actualTokens: 2000,
    });
    await f.t.mutation(internal.textJobs.settleChatJob, {
      ...args,
      actualCostUsdMicros: 4_000,
    });
    expect(
      (await f.owner.query(api.billing.budgets, { workspaceId: f.workspaceId }))
        .account,
    ).toMatchObject({ reserved: 0, spent: 4_000 });
  });
});
