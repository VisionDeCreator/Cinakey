import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";
import { csvCell } from "./lib/adminAnalytics";
afterEach(() => vi.useRealTimers());
const day = 86400000;
async function fixture() {
  vi.useFakeTimers();
  const to = Date.UTC(2026, 9, 29),
    from = to - day;
  vi.setSystemTime(from + 1000);
  const t = makeTest();
  const userId = await createTestUser(t, "private-customer@test.com");
  const adminId = await createTestUser(t, "analytics-admin@test.com", {
    isStaff: true,
  });
  const opsId = await createTestUser(t, "analytics-ops@test.com", {
    isStaff: true,
  });
  const supportId = await createTestUser(t, "analytics-support@test.com", {
    isStaff: true,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(opsId, { adminRoles: ["operations"] });
    await ctx.db.patch(supportId, { adminRoles: ["support"] });
  });
  const admin = t.withIdentity(authIdentity(adminId)),
    ops = t.withIdentity(authIdentity(opsId)),
    support = t.withIdentity(authIdentity(supportId));
  await t.run(async (ctx) => {
    for (let i = 0; i < 31; i++)
      await ctx.db.insert("analyticsEvents", {
        userId,
        name: "activation.starter_created",
        createdAt: from + 1000 + i,
      });
    await ctx.db.insert("analyticsEvents", {
      userId,
      name: "activation.export_completed",
      createdAt: from - 1000,
    });
    await ctx.db.insert("analyticsEvents", {
      userId: adminId,
      name: "activation.export_completed",
      createdAt: from + 1000,
    });
    await ctx.db.insert("analyticsEvents", {
      name: "export.finished_minutes",
      value: -1,
      createdAt: from + 1000,
    });
  });
  vi.setSystemTime(to + 1000);
  const args = {
    from,
    to,
    reason: "Review product activity for launch",
    requestId: "report-1",
  };
  const reportId = await admin.mutation(api.adminAnalytics.request, args);
  async function finish() {
    for (let i = 0; i < 60; i++) {
      await t.mutation(internal.adminAnalytics.build, { reportId });
      const report = await admin.query(api.adminAnalytics.detail, { reportId });
      if (report?.status === "completed") return report;
    }
    throw new Error("Report failed to finish");
  }
  return { t, admin, ops, support, userId, reportId, args, finish };
}
it("builds paginated completed reports, deduplicates activity and exposes coverage without PII", async () => {
  const f = await fixture();
  expect(await f.admin.mutation(api.adminAnalytics.request, f.args)).toBe(
    f.reportId,
  );
  await expect(
    f.admin.query(api.adminAnalytics.rows, {
      reportId: f.reportId,
      dimension: "day",
      paginationOpts: { numItems: 20, cursor: null },
    }),
  ).rejects.toThrow("not complete");
  const report = await f.finish();
  expect(report.metrics).toMatchObject({
    newAccounts: 1,
    activeAccounts: 1,
    priorActiveAccounts: 1,
    returningAccounts: 1,
    starterAccounts: 1,
    starterEvents: 31,
    invalidEventValues: 1,
  });
  expect(JSON.stringify(report)).not.toContain("private-customer");
  const csv = await f.admin.mutation(api.adminAnalytics.exportCsv, {
    reportId: f.reportId,
    dimension: "day",
    reason: "Export reviewed daily metrics",
    requestId: "export-1",
  });
  expect(csv.csv).toContain("starterEvents");
  expect(csv.csv).not.toContain("private-customer");
  expect(await f.finish()).toMatchObject({
    processed: report.processed,
    metrics: report.metrics,
  });
});
it("enforces analytics and financial permissions on detail, groups and exports", async () => {
  const f = await fixture();
  await f.finish();
  await f.t.run(async (ctx) => {
    const row = await ctx.db
      .query("analyticsReportRows")
      .withIndex("by_report_dimension_key", (q) =>
        q.eq("reportId", f.reportId).eq("dimension", "total").eq("key", "all"),
      )
      .unique();
    await ctx.db.patch(row!._id, {
      metrics: { ...row!.metrics, usageCustomerMicros: 12345 },
    });
  });
  expect(
    (await f.admin.query(api.adminAnalytics.detail, { reportId: f.reportId }))
      ?.metrics?.usageCustomerMicros,
  ).toBe(12345);
  expect(
    (await f.ops.query(api.adminAnalytics.detail, { reportId: f.reportId }))
      ?.metrics,
  ).not.toHaveProperty("usageCustomerMicros");
  const rows = await f.ops.query(api.adminAnalytics.rows, {
    reportId: f.reportId,
    dimension: "total",
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(rows.page[0]?.metrics).not.toHaveProperty("usageCustomerMicros");
  const csv = await f.ops.mutation(api.adminAnalytics.exportCsv, {
    reportId: f.reportId,
    dimension: "total",
    reason: "Export nonfinancial report metrics",
    requestId: "ops-export",
  });
  expect(csv.csv).not.toContain("usageCustomerMicros");
  await expect(
    f.support.query(api.adminAnalytics.detail, { reportId: f.reportId }),
  ).rejects.toThrow();
  await expect(
    f.support.mutation(api.adminAnalytics.request, {
      ...f.args,
      requestId: "support",
    }),
  ).rejects.toThrow();
});
it("cancels without revealing partial totals and deletes bounded report data", async () => {
  const f = await fixture();
  await f.t.mutation(internal.adminAnalytics.build, { reportId: f.reportId });
  await f.admin.mutation(api.adminAnalytics.cancel, {
    reportId: f.reportId,
    reason: "Cancel duplicate activity analysis",
    requestId: "cancel",
  });
  await f.t.mutation(internal.adminAnalytics.build, { reportId: f.reportId });
  expect(
    await f.admin.query(api.adminAnalytics.detail, { reportId: f.reportId }),
  ).toMatchObject({ status: "canceled", metrics: null });
  await f.admin.mutation(api.adminAnalytics.remove, {
    reportId: f.reportId,
    reason: "Remove canceled duplicate report",
    requestId: "remove",
  });
  for (let i = 0; i < 4; i++)
    await f.t.mutation(internal.adminAnalytics.clean, { reportId: f.reportId });
  expect(
    await f.admin.query(api.adminAnalytics.detail, { reportId: f.reportId }),
  ).toBeNull();
  expect(
    await f.t.run((ctx) => ctx.db.query("analyticsReportRows").collect()),
  ).toEqual([]);
});
it("validates UTC windows and prevents spreadsheet formula execution", async () => {
  const f = await fixture();
  await expect(
    f.admin.mutation(api.adminAnalytics.request, {
      ...f.args,
      from: f.args.from + 1,
      requestId: "bad",
    }),
  ).rejects.toThrow("completed UTC days");
  expect(csvCell(' =HYPERLINK("evil")')).toBe('"\' =HYPERLINK(""evil"")"');
  expect(csvCell("normal,quoted")).toBe('"normal,quoted"');
});
it("reconciles customer/company settlements, supplier coverage, payment environments and storage estimates", async () => {
  const f = await fixture();
  const user = f.t.withIdentity(authIdentity(f.userId));
  const projectId = await user.mutation(api.projects.create, {
    title: "Report fixture",
  });
  const workspaceId = (await user.query(api.projects.get, { projectId }))!
    .workspaceId;
  await f.t.run(async (ctx) => {
    for (const company of [false, true]) {
      const jobId = await ctx.db.insert("generationJobs", {
        projectId,
        workspaceId,
        createdBy: f.userId,
        model: "seedance-2.5",
        modelVersion: "test",
        kind: "text-to-video",
        prompt: "private prompt must not appear",
        estimatedCostUsdMicros: 1000,
        status: "succeeded",
        outputAssetIds: [],
        attempts: 1,
        createdAt: f.args.from + 1000,
        updatedAt: f.args.from + 2000,
        completedAt: f.args.from + 2000,
      });
      for (const settle of [false, true])
        await ctx.db.insert("usageLedger", {
          workspaceId,
          userId: f.userId,
          projectId,
          jobId,
          sequence: settle ? 2 : 1,
          delta: settle ? 200 : -1000,
          reason: settle ? "settle" : "reserve",
          balanceAfter: 0,
          createdAt: f.args.from + 2000,
          companyFunded: company,
          providerCostUsdMicros: settle && !company ? 500 : undefined,
        });
    }
    for (const environment of ["production", "sandbox"] as const)
      await ctx.db.insert("paymentOrders", {
        workspaceId,
        environment,
        orderId: environment,
        kind: "topup",
        netCents: 100,
        refundedCents: 20,
        grantedUsdMicros: 1000000,
        reversedUsdMicros: 200000,
        createdAt: f.args.from + 1000,
      });
    await ctx.db.insert("r2Files", {
      workspaceId,
      key: "private-object-key",
      bucket: "test",
      contentType: "video/mp4",
      size: 100,
      createdAt: f.args.from,
    });
    for (const kind of ["storage_write", "export", "download"] as const)
      await ctx.db.insert("egressEvents", {
        userId: f.userId,
        workspaceId,
        kind,
        bytes: 50,
        createdAt: f.args.from + 1000,
      });
  });
  const reportId = await f.admin.mutation(api.adminAnalytics.request, {
    ...f.args,
    workspaceId,
    requestId: "financial-fixture",
  });
  for (let i = 0; i < 30; i++) {
    await f.t.mutation(internal.adminAnalytics.build, { reportId });
    if (
      (await f.admin.query(api.adminAnalytics.detail, { reportId }))?.status ===
      "completed"
    )
      break;
  }
  const report = await f.admin.query(api.adminAnalytics.detail, { reportId });
  expect(report?.metrics).toMatchObject({
    jobs: 2,
    jobsSucceeded: 2,
    latencySamples: 2,
    latencyMs: 2000,
    usageCustomerMicros: 800,
    usageCompanyMicros: 800,
    supplierKnownMicros: 500,
    supplierMissingSettlements: 1,
    supplierKnownSettlements: 1,
    matchedCustomerMicros: 800,
    matchedCustomerCostMicros: 500,
    productionOrderNetMicros: 1000000,
    sandboxOrderNetMicros: 1000000,
    productionOrderRefundMicros: 200000,
    storageBytes: 100,
    storageFiles: 1,
    egressBytes: 50,
    exportBytes: 50,
    storageWriteBytes: 50,
  });
  expect(report?.metrics).not.toHaveProperty("newAccounts");
  expect(JSON.stringify(report)).not.toContain("private prompt");
  expect(JSON.stringify(report)).not.toContain("private-object-key");
});
it("excludes post-request source rows, resumes failed work and rejects oversized CSV", async () => {
  const f = await fixture();
  vi.setSystemTime(f.args.to + 10000);
  await f.t.run(async (ctx) => {
    await ctx.db.insert("analyticsEvents", {
      name: "activation.starter_created",
      userId: f.userId,
      createdAt: f.args.from + 1000,
    });
    const report = await ctx.db.get(f.reportId);
    await ctx.db.patch(report!.taskId!, { state: "failed" });
  });
  await f.admin.mutation(api.adminAnalytics.resume, {
    reportId: f.reportId,
    reason: "Resume interrupted report worker",
    requestId: "resume",
  });
  const report = await f.finish();
  expect(report.metrics?.starterEvents).toBe(31);
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 1001; i++)
      await ctx.db.insert("analyticsReportRows", {
        reportId: f.reportId,
        dimension: "model",
        key: `model-${i}`,
        metrics: { jobs: 1 },
      });
  });
  await expect(
    f.admin.mutation(api.adminAnalytics.exportCsv, {
      reportId: f.reportId,
      dimension: "model",
      reason: "Export full model grouping for review",
      requestId: "oversized-export",
    }),
  ).rejects.toThrow("1,000 rows");
});
