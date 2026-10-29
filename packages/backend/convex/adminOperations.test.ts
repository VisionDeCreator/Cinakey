import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";
afterEach(() => vi.useRealTimers());
async function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T00:00:00Z"));
  const t = makeTest();
  const adminId = await createTestUser(t, "ops-admin@test.com", {
    isStaff: true,
  });
  const supportId = await createTestUser(t, "ops-support@test.com", {
    isStaff: true,
  });
  const opsId = await createTestUser(t, "ops@test.com", { isStaff: true });
  await t.run(async (ctx) => {
    await ctx.db.patch(supportId, { adminRoles: ["support"] });
    await ctx.db.patch(opsId, { adminRoles: ["operations"] });
  });
  const admin = t.withIdentity(authIdentity(adminId)),
    ops = t.withIdentity(authIdentity(opsId)),
    support = t.withIdentity(authIdentity(supportId));
  const pulse = (activeTasks = 0, stopping = false) =>
    t.mutation(internal.adminOperations.heartbeat, {
      instanceId: "worker-a",
      version: "test-release",
      startedAt: Date.now(),
      lastPollAt: Date.now(),
      activeTasks,
      stopping,
    });
  return { t, admin, ops, support, pulse };
}
it("reports independent idle and busy heartbeats, degraded polling, and stopped workers", async () => {
  const f = await fixture();
  expect(
    (await f.admin.query(api.adminOperations.overview, {})).workers,
  ).toHaveLength(0);
  await f.pulse();
  expect(
    (await f.admin.query(api.adminOperations.overview, {})).workers[0],
  ).toMatchObject({
    state: "healthy",
    activeTasks: 0,
    version: "test-release",
  });
  vi.setSystemTime(Date.now() + 100_000);
  expect(
    (await f.admin.query(api.adminOperations.overview, {})).workers[0]!.state,
  ).toBe("offline");
  await f.t.mutation(internal.adminOperations.heartbeat, {
    instanceId: "worker-a",
    version: "test-release",
    startedAt: Date.now() - 200_000,
    lastPollAt: Date.now() - 100_000,
    activeTasks: 1,
    stopping: false,
  });
  expect(
    (await f.ops.query(api.adminOperations.overview, {})).workers[0]!.state,
  ).toBe("healthy");
  await f.t.mutation(internal.adminOperations.heartbeat, {
    instanceId: "worker-a",
    version: "test-release",
    startedAt: Date.now() - 200_000,
    lastPollAt: Date.now() - 100_000,
    activeTasks: 0,
    stopping: false,
  });
  expect(
    (await f.ops.query(api.adminOperations.overview, {})).workers[0]!.state,
  ).toBe("degraded");
  await f.pulse(0, true);
  expect(
    (await f.ops.query(api.adminOperations.overview, {})).workers[0]!.state,
  ).toBe("stopped");
});
it("deduplicates incidents, audits acknowledgement once, records recovery and reopens a new occurrence", async () => {
  const f = await fixture();
  await f.t.mutation(internal.adminOperations.evaluate, {});
  expect(
    (await f.ops.query(api.adminOperations.listIncidents, {})).active,
  ).toHaveLength(0);
  vi.setSystemTime(Date.now() + 100_000);
  await f.t.mutation(internal.adminOperations.evaluate, {});
  await f.t.mutation(internal.adminOperations.evaluate, {});
  const incident = (await f.ops.query(api.adminOperations.listIncidents, {}))
    .active[0]!;
  expect(incident.key).toBe("workers");
  expect(
    (await f.ops.query(api.adminOperations.listIncidents, {})).active,
  ).toHaveLength(1);
  await f.ops.mutation(api.adminOperations.acknowledge, {
    incidentId: incident._id,
    reason: "Investigating worker shutdown",
  });
  await f.ops.mutation(api.adminOperations.acknowledge, {
    incidentId: incident._id,
    reason: "Investigating worker shutdown",
  });
  await f.t.mutation(internal.adminOperations.evaluate, {});
  expect(
    (await f.ops.query(api.adminOperations.listIncidents, {})).active[0]!
      .status,
  ).toBe("acknowledged");
  expect(
    (await f.admin.query(api.staff.listAuditLog, {})).filter(
      (row) => row.action === "operations.incident.acknowledge",
    ),
  ).toHaveLength(1);
  await f.pulse();
  await f.t.mutation(internal.adminOperations.evaluate, {});
  const recovered = await f.ops.query(api.adminOperations.listIncidents, {});
  expect(recovered.active).toHaveLength(0);
  expect(recovered.recentResolved[0]!.resolvedAt).toBe(Date.now());
  vi.setSystemTime(Date.now() + 100_000);
  await f.t.mutation(internal.adminOperations.evaluate, {});
  expect(
    (await f.ops.query(api.adminOperations.listIncidents, {})).active[0]!._id,
  ).not.toBe(incident._id);
});
it("enforces operation permissions and validates audited, repeat-safe settings", async () => {
  const f = await fixture();
  await expect(
    f.support.query(api.adminOperations.overview, {}),
  ).rejects.toThrow("Staff access denied");
  await expect(f.t.query(api.adminOperations.overview, {})).rejects.toThrow(
    "Not authenticated",
  );
  const config = {
    requestId: "settings-1",
    enabled: true,
    expectedWorkers: 2,
    staleAfterSec: 120,
    backlogThreshold: 10,
    overdueSec: 60,
    reason: "Scale workers for launch",
  };
  await expect(
    f.ops.mutation(api.adminOperations.configure, config),
  ).rejects.toThrow("Staff access denied");
  await expect(
    f.admin.mutation(api.adminOperations.configure, {
      ...config,
      staleAfterSec: 0,
    }),
  ).rejects.toThrow("Invalid monitoring threshold");
  await f.admin.mutation(api.adminOperations.configure, config);
  await f.admin.mutation(api.adminOperations.configure, config);
  expect(
    (await f.admin.query(api.staff.listAuditLog, {})).filter(
      (row) => row.action === "operations.configure",
    ),
  ).toHaveLength(1);
  expect(
    (await f.ops.query(api.adminOperations.overview, {})).config
      .expectedWorkers,
  ).toBe(2);
  await f.admin.mutation(api.adminOperations.configure, {
    ...config,
    expectedWorkers: 3,
    requestId: "settings-2",
  });
  await f.admin.mutation(api.adminOperations.configure, config);
  expect(
    (await f.ops.query(api.adminOperations.overview, {})).config
      .expectedWorkers,
  ).toBe(3);
  await expect(
    f.admin.mutation(api.adminOperations.configure, {
      ...config,
      expectedWorkers: 4,
    }),
  ).rejects.toThrow("request mismatch");
});
it("uses bounded queue counts and distinguishes due work from scheduled work", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 1001; i++)
      await ctx.db.insert("apiTasks", {
        operation: "fixture",
        args: {},
        dueAt: Date.now() - 400_000,
        state: "pending",
        attempts: 0,
        createdAt: Date.now() - 400_000,
      });
    await ctx.db.insert("apiTasks", {
      operation: "future",
      args: {},
      dueAt: Date.now() + 60_000,
      state: "pending",
      attempts: 0,
      createdAt: Date.now(),
    });
    await ctx.db.insert("apiTasks", {
      operation: "failed",
      args: {},
      dueAt: Date.now(),
      state: "failed",
      attempts: 6,
      failedAt: Date.now(),
      createdAt: Date.now(),
    });
  });
  const overview = await f.ops.query(api.adminOperations.overview, {});
  expect(overview.queue.due).toEqual({ value: 1000, capped: true });
  expect(overview.queue.scheduled.value).toBe(1);
  expect(overview.queue.failed.value).toBe(1);
  expect(overview.recentFailedTasks.value).toBe(1);
  await f.t.mutation(internal.adminOperations.evaluate, {});
  expect(
    (await f.ops.query(api.adminOperations.listIncidents, {})).active.map(
      (row) => row.key,
    ),
  ).toEqual(expect.arrayContaining(["backlog", "overdue", "failed"]));
});
it("retains incidents while monitoring is paused and resolves them after monitoring resumes", async () => {
  const f = await fixture();
  await f.t.mutation(internal.adminOperations.evaluate, {});
  vi.setSystemTime(Date.now() + 100_000);
  await f.t.mutation(internal.adminOperations.evaluate, {});
  const values = {
    expectedWorkers: 1,
    staleAfterSec: 90,
    backlogThreshold: 100,
    overdueSec: 300,
    reason: "Planned maintenance",
  };
  await f.admin.mutation(api.adminOperations.configure, {
    ...values,
    enabled: false,
    requestId: "pause-settings",
  });
  await f.pulse();
  await f.t.mutation(internal.adminOperations.evaluate, {});
  expect(
    (await f.ops.query(api.adminOperations.listIncidents, {})).active,
  ).toHaveLength(1);
  await f.admin.mutation(api.adminOperations.configure, {
    ...values,
    enabled: true,
    requestId: "resume-settings",
  });
  await f.t.mutation(internal.adminOperations.evaluate, {});
  expect(
    (await f.ops.query(api.adminOperations.listIncidents, {})).active,
  ).toHaveLength(0);
});
