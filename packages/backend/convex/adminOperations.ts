import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireAdminPermission } from "./lib/access";
import { appendAuditLog } from "./lib/audit";
import { assertRateLimit } from "./lib/rateLimit";
const CAP = 1000;
const defaults = {
  enabled: true,
  expectedWorkers: 1,
  staleAfterSec: 90,
  backlogThreshold: 100,
  overdueSec: 300,
  generationFailureThreshold: 5,
};
const count = (rows: unknown[]) => ({
  value: Math.min(CAP, rows.length),
  capped: rows.length > CAP,
});
async function settings(ctx: QueryCtx) {
  return await ctx.db
    .query("operationsSettings")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .unique();
}
async function snapshot(ctx: QueryCtx) {
  const now = Date.now();
  const stored = await settings(ctx);
  const config = { ...defaults, ...stored };
  const [
    workers,
    due,
    running,
    failed,
    expired,
    uncertain,
    billing,
    recentFailed,
    generationFailed,
    paymentReviews,
    scheduled,
  ] = await Promise.all([
    ctx.db
      .query("workerInstances")
      .withIndex("by_seen", (q) => q.gte("lastSeenAt", now - 86_400_000))
      .order("desc")
      .take(CAP + 1),
    ctx.db
      .query("apiTasks")
      .withIndex("by_state_due", (q) =>
        q.eq("state", "pending").lte("dueAt", now),
      )
      .take(CAP + 1),
    ctx.db
      .query("apiTasks")
      .withIndex("by_state_due", (q) => q.eq("state", "running"))
      .take(CAP + 1),
    ctx.db
      .query("apiTasks")
      .withIndex("by_state_due", (q) => q.eq("state", "failed"))
      .take(CAP + 1),
    ctx.db
      .query("apiTasks")
      .withIndex("by_state_lease", (q) =>
        q.eq("state", "running").lte("leaseUntil", now),
      )
      .take(CAP + 1),
    ctx.db
      .query("generationJobs")
      .withIndex("by_submission", (q) => q.eq("submissionState", "uncertain"))
      .take(CAP + 1),
    ctx.db
      .query("generationJobs")
      .withIndex("by_billing_review", (q) => q.eq("billingNeedsReview", true))
      .take(CAP + 1),
    ctx.db
      .query("apiTasks")
      .withIndex("by_state_failed", (q) =>
        q.eq("state", "failed").gte("failedAt", now - 3_600_000),
      )
      .take(CAP + 1),
    ctx.db
      .query("generationJobs")
      .withIndex("by_status_completed", (q) =>
        q.eq("status", "failed").gte("completedAt", now - 3_600_000),
      )
      .take(CAP + 1),
    ctx.db
      .query("paymentWorkspaces")
      .withIndex("by_review", (q) => q.gt("reviewReason", ""))
      .take(CAP + 1),
    ctx.db
      .query("apiTasks")
      .withIndex("by_state_due", (q) =>
        q.eq("state", "pending").gt("dueAt", now),
      )
      .take(CAP + 1),
  ]);
  const workerRows = workers.slice(0, CAP).map((worker) => ({
    ...worker,
    state: worker.stopping
      ? ("stopped" as const)
      : now - worker.lastSeenAt > config.staleAfterSec * 1000
        ? ("offline" as const)
        : worker.activeTasks === 0 &&
            (!worker.lastPollAt ||
              now - worker.lastPollAt > config.staleAfterSec * 1000)
          ? ("degraded" as const)
          : ("healthy" as const),
  }));
  const healthyWorkers = workerRows.filter(
    (worker) => worker.state === "healthy",
  ).length;
  return {
    observedAt: now,
    monitorStartedAt: stored?.createdAt ?? null,
    monitorLastEvaluatedAt: stored?.lastEvaluatedAt ?? null,
    config,
    workers: workerRows,
    workersCapped: workers.length > CAP,
    healthyWorkers,
    queue: {
      scheduled: count(scheduled),
      due: count(due),
      running: count(running),
      failed: count(failed),
      expired: count(expired),
      oldestDueAt: due[0]?.dueAt ?? null,
    },
    paymentReviews: count(paymentReviews),
    uncertain: count(uncertain),
    billingReviews: count(billing),
    recentFailedTasks: count(recentFailed),
    recentFailedGenerations: count(generationFailed),
  };
}
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminPermission(ctx, "operations.read");
    return snapshot(ctx);
  },
});
export const readiness = internalQuery({
  args: {},
  handler: async (ctx) => {
    await ctx.db
      .query("operationsSettings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
    return { ok: true };
  },
});
export const heartbeat = internalMutation({
  args: {
    instanceId: v.string(),
    version: v.string(),
    startedAt: v.number(),
    lastPollAt: v.optional(v.number()),
    activeTasks: v.number(),
    stopping: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (
      !args.instanceId ||
      args.instanceId.length > 128 ||
      args.version.length > 100 ||
      !Number.isSafeInteger(args.activeTasks) ||
      args.activeTasks < 0 ||
      args.activeTasks > 10 ||
      !Number.isFinite(args.startedAt) ||
      (args.lastPollAt !== undefined && !Number.isFinite(args.lastPollAt))
    )
      throw new Error("Invalid worker heartbeat");
    const existing = await ctx.db
      .query("workerInstances")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .unique();
    const value = { ...args, lastSeenAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("workerInstances", value);
  },
});
export const listIncidents = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminPermission(ctx, "operations.read");
    const [open = [], acknowledged = [], resolved = []] = await Promise.all(
      ["open", "acknowledged", "resolved"].map((status) =>
        ctx.db
          .query("operationsIncidents")
          .withIndex("by_status_opened", (q) =>
            q.eq("status", status as "open" | "acknowledged" | "resolved"),
          )
          .order("desc")
          .take(51),
      ),
    );
    return {
      active: [...open.slice(0, 50), ...acknowledged.slice(0, 50)].sort(
        (a, b) => b.openedAt - a.openedAt,
      ),
      recentResolved: resolved.slice(0, 50),
      capped:
        open.length > 50 || acknowledged.length > 50 || resolved.length > 50,
    };
  },
});
export const evaluate = internalMutation({
  args: {},
  handler: async (ctx) => {
    let config = await settings(ctx);
    if (!config) {
      const id = await ctx.db.insert("operationsSettings", {
        key: "default",
        ...defaults,
        createdAt: Date.now(),
      });
      config = await ctx.db.get(id);
    }
    const state = await snapshot(ctx);
    const gracePassed =
      state.observedAt - (config?.createdAt ?? state.observedAt) >
      state.config.staleAfterSec * 1000;
    const conditions = [
      {
        key: "workers",
        summary: "Fewer healthy workers than expected",
        severity: "critical" as const,
        active:
          gracePassed && state.healthyWorkers < state.config.expectedWorkers,
      },
      {
        key: "backlog",
        summary: "Task backlog exceeds threshold",
        severity: "warning" as const,
        active: state.queue.due.value > state.config.backlogThreshold,
      },
      {
        key: "overdue",
        summary: "Queued work is overdue",
        severity: "warning" as const,
        active:
          state.queue.oldestDueAt !== null &&
          state.observedAt - state.queue.oldestDueAt >
            state.config.overdueSec * 1000,
      },
      {
        key: "failed",
        summary: "Worker tasks require failure review",
        severity: "warning" as const,
        active: state.queue.failed.value > 0,
      },
      {
        key: "expired",
        summary: "Worker task leases have expired",
        severity: "warning" as const,
        active: state.queue.expired.value > 0,
      },
      {
        key: "uncertain",
        summary: "Provider submissions have uncertain outcomes",
        severity: "critical" as const,
        active: state.uncertain.value > 0,
      },
      {
        key: "generation_failures",
        summary: "Generation failures exceed hourly threshold",
        severity: "warning" as const,
        active:
          state.recentFailedGenerations.value >=
          state.config.generationFailureThreshold,
      },
      {
        key: "payments",
        summary: "Payment accounts require review",
        severity: "warning" as const,
        active: state.paymentReviews.value > 0,
      },
      {
        key: "billing",
        summary: "Generation billing requires reconciliation",
        severity: "warning" as const,
        active: state.billingReviews.value > 0,
      },
    ];
    if (config)
      await ctx.db.patch(config._id, { lastEvaluatedAt: state.observedAt });
    const oldWorkers = await ctx.db
      .query("workerInstances")
      .withIndex("by_seen", (q) =>
        q.lt("lastSeenAt", Date.now() - 7 * 86_400_000),
      )
      .take(100);
    for (const worker of oldWorkers) await ctx.db.delete(worker._id);
    for (const condition of conditions) {
      const current = await ctx.db
        .query("operationsIncidents")
        .withIndex("by_key_opened", (q) => q.eq("key", condition.key))
        .order("desc")
        .first();
      if (state.config.enabled && condition.active) {
        if (!current || current.status === "resolved")
          await ctx.db.insert("operationsIncidents", {
            key: condition.key,
            summary: condition.summary,
            severity: condition.severity,
            status: "open",
            openedAt: state.observedAt,
            observedAt: state.observedAt,
          });
        else await ctx.db.patch(current._id, { observedAt: state.observedAt });
      } else if (
        current &&
        current.status !== "resolved" &&
        state.config.enabled
      )
        await ctx.db.patch(current._id, {
          status: "resolved",
          resolvedAt: state.observedAt,
          observedAt: state.observedAt,
        });
    }
  },
});
export const acknowledge = mutation({
  args: { incidentId: v.id("operationsIncidents"), reason: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "operations.manage");
    const reason = args.reason.trim();
    if (reason.length < 3 || reason.length > 500)
      throw new Error("A reason of 3 to 500 characters is required");
    const incident = await ctx.db.get(args.incidentId);
    if (!incident) throw new Error("Incident not found");
    if (incident.status !== "open") return;
    await ctx.db.patch(incident._id, {
      status: "acknowledged",
      acknowledgedBy: actor._id,
      acknowledgedAt: Date.now(),
      note: reason,
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "operations.incident.acknowledge",
      targetType: "operationsIncidents",
      targetId: incident._id,
      reason,
      before: { status: incident.status },
      after: { status: "acknowledged" },
    });
  },
});
export const configure = mutation({
  args: {
    enabled: v.boolean(),
    expectedWorkers: v.number(),
    staleAfterSec: v.number(),
    generationFailureThreshold: v.optional(v.number()),
    backlogThreshold: v.number(),
    overdueSec: v.number(),
    reason: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "operations.configure");
    const reason = args.reason.trim();
    if (reason.length < 3 || reason.length > 500)
      throw new Error("A reason of 3 to 500 characters is required");
    for (const [value, min, max] of [
      [args.generationFailureThreshold ?? 5, 1, 999],
      [args.expectedWorkers, 0, 100],
      [args.staleAfterSec, 60, 3600],
      [args.backlogThreshold, 1, 999],
      [args.overdueSec, 60, 86400],
    ])
      if (!Number.isSafeInteger(value) || value! < min! || value! > max!)
        throw new Error("Invalid monitoring threshold");
    if (!args.requestId.trim() || args.requestId.length > 128)
      throw new Error("A valid request ID is required");
    const requestId = args.requestId;
    const values = {
      enabled: args.enabled,
      expectedWorkers: args.expectedWorkers,
      staleAfterSec: args.staleAfterSec,
      backlogThreshold: args.backlogThreshold,
      overdueSec: args.overdueSec,
      generationFailureThreshold: args.generationFailureThreshold ?? 5,
    };
    const fingerprint = JSON.stringify({
      action: "operations.configure",
      values,
      reason,
    });
    const previous = await ctx.db
      .query("adminActionRequests")
      .withIndex("by_actor_request", (q) =>
        q.eq("actorUserId", actor._id).eq("requestId", requestId),
      )
      .unique();
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new Error("Administrative request mismatch");
      return;
    }
    await assertRateLimit(ctx, `operationsConfig:${actor._id}`, 20, 60_000);
    const existing = await settings(ctx);
    await ctx.db.insert("adminActionRequests", {
      actorUserId: actor._id,
      requestId,
      fingerprint,
      createdAt: Date.now(),
    });
    if (
      existing &&
      Object.entries(values).every(
        ([key, value]) => existing[key as keyof typeof existing] === value,
      )
    )
      return;
    if (existing) await ctx.db.patch(existing._id, values);
    else
      await ctx.db.insert("operationsSettings", {
        key: "default",
        ...values,
        createdAt: Date.now(),
      });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "operations.configure",
      requestId,
      targetType: "operationsSettings",
      reason,
      before: existing
        ? {
            generationFailureThreshold:
              existing.generationFailureThreshold ?? 5,
            enabled: existing.enabled,
            expectedWorkers: existing.expectedWorkers,
            staleAfterSec: existing.staleAfterSec,
            backlogThreshold: existing.backlogThreshold,
            overdueSec: existing.overdueSec,
          }
        : defaults,
      after: values,
    });
  },
});
