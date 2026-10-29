import { v } from "convex/values";
import {
  ADMIN_MODELS,
  PROVIDER_CONTROL_KEYS,
  PRICE_VERSION,
  USAGE_MARKUP_BPS,
  VIDEO_RATES,
  VIDEO_SUPPLIER_RATES,
  TOKEN_RATES,
  TOKEN_SUPPLIER_RATES,
  DEEPSEEK_MODEL,
} from "@cinakey/shared";
import { query, mutation, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdminPermission } from "./lib/access";
import { appendAuditLog } from "./lib/audit";
import { assertRateLimit } from "./lib/rateLimit";
import {
  policy,
  providerTotal,
  syncProviderJob,
  utcDay,
  utcMonth,
  paidWorkPause,
} from "./lib/providerControls";
import { enqueueTask } from "./tasks";
import { listAdapters } from "./adapters";
const requests = { requestId: v.string(), reason: v.string() };
async function once(
  ctx: MutationCtx,
  actorUserId: Id<"users">,
  args: { requestId: string; reason: string },
  fingerprint: string,
) {
  if (args.reason.trim().length < 10 || args.reason.length > 500)
    throw new Error("Provide a reason of 10 to 500 characters");
  if (!args.requestId.trim() || args.requestId.length > 128)
    throw new Error("Invalid request ID");
  const prior = await ctx.db
    .query("adminActionRequests")
    .withIndex("by_actor_request", (q) =>
      q.eq("actorUserId", actorUserId).eq("requestId", args.requestId),
    )
    .unique();
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      throw new Error("Administrative request mismatch");
    return false;
  }
  await assertRateLimit(ctx, `providerControls:${actorUserId}`, 20, 60000);
  await ctx.db.insert("adminActionRequests", {
    actorUserId,
    requestId: args.requestId,
    fingerprint,
    createdAt: Date.now(),
  });
  return true;
}
function key(value: string) {
  if (
    !PROVIDER_CONTROL_KEYS.includes(
      value as (typeof PROVIDER_CONTROL_KEYS)[number],
    )
  )
    throw new Error("Unknown provider control scope");
}
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminPermission(ctx, "providers.read");
    const state = await ctx.db.query("providerAccountingState").unique();
    const task = state?.taskId ? await ctx.db.get(state.taskId) : null;
    const problemMatch = task?.error?.match(
      /Missing provider reservation for job ([a-zA-Z0-9;_-]+)/,
    );
    const problemJobId = problemMatch?.[1]
      ? ctx.db.normalizeId("generationJobs", problemMatch[1])
      : null;
    const scopes = await Promise.all(
      PROVIDER_CONTROL_KEYS.map(async (key) => ({
        key,
        policy: await policy(ctx, key),
        all: await providerTotal(ctx, key, "all"),
        day: await providerTotal(ctx, key, utcDay()),
        month: await providerTotal(ctx, key, utcMonth()),
      })),
    );
    return {
      observedAt: Date.now(),
      day: utcDay(),
      month: utcMonth(),
      accounting: state
        ? {
            ready: state.ready,
            running: state.running,
            processed: state.processed,
            startedAt: state.startedAt,
            completedAt: state.completedAt,
            taskState: task?.state ?? null,
            problemJobId,
          }
        : null,
      scopes,
      models: ADMIN_MODELS,
      pricing: {
        priceVersion: PRICE_VERSION,
        markupBps: USAGE_MARKUP_BPS,
        video: VIDEO_RATES,
        videoSupplier: VIDEO_SUPPLIER_RATES,
        tokens: TOKEN_RATES,
        supplierTokens: TOKEN_SUPPLIER_RATES,
        textModel: DEEPSEEK_MODEL,
      },
    };
  },
});
export const availability = query({
  args: {},
  handler: async (ctx) => ({
    models: await Promise.all(
      listAdapters().map(async (a) => ({
        id: a.capabilities.id,
        available: !(await paidWorkPause(ctx, a.capabilities.id)),
      })),
    ),
  }),
});
export const configure = mutation({
  args: {
    key: v.string(),
    paused: v.boolean(),
    maxRequest: v.union(v.number(), v.null()),
    dailyCap: v.union(v.number(), v.null()),
    monthlyCap: v.union(v.number(), v.null()),
    maxOutstanding: v.union(v.number(), v.null()),
    expectedRevision: v.number(),
    ...requests,
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "providers.configure");
    key(args.key);
    for (const value of [
      args.maxRequest,
      args.dailyCap,
      args.monthlyCap,
      args.maxOutstanding,
    ])
      if (value !== null && (!Number.isSafeInteger(value) || value < 0))
        throw new Error("Limits must be non-negative safe integers");
    if (args.maxOutstanding !== null && args.maxOutstanding > 100000)
      throw new Error("Outstanding limit is too large");
    if (
      !(await once(
        ctx,
        actor._id,
        args,
        JSON.stringify({ action: "provider.configure", ...args }),
      ))
    )
      return;
    const current = await policy(ctx, args.key);
    if ((current?.revision ?? 0) !== args.expectedRevision)
      throw new Error("Provider controls changed; reload before saving");
    if (
      [args.dailyCap, args.monthlyCap, args.maxOutstanding].some(
        (v) => v !== null,
      ) &&
      !(await ctx.db.query("providerAccountingState").unique())?.ready
    )
      throw new Error(
        "Initialize provider accounting before enabling aggregate limits",
      );
    const next = {
      paused: args.paused,
      maxRequest: args.maxRequest ?? undefined,
      dailyCap: args.dailyCap ?? undefined,
      monthlyCap: args.monthlyCap ?? undefined,
      maxOutstanding: args.maxOutstanding ?? undefined,
      revision: args.expectedRevision + 1,
      updatedAt: Date.now(),
      updatedBy: actor._id,
      reason: args.reason.trim(),
    };
    if (current) await ctx.db.patch(current._id, next);
    else await ctx.db.insert("providerPolicies", { key: args.key, ...next });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "provider.configure",
      targetType: "providerPolicy",
      targetId: args.key,
      requestId: args.requestId,
      reason: args.reason,
      before: current ?? {},
      after: next,
    });
  },
});
/** Operations may stop paid work immediately; only configuration administrators may resume it. */
export const pause = mutation({
  args: { key: v.string(), ...requests },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "providers.pause");
    key(args.key);
    if (
      !(await once(
        ctx,
        actor._id,
        args,
        JSON.stringify({ action: "provider.pause", ...args }),
      ))
    )
      return;
    const current = await policy(ctx, args.key);
    const fields = {
      paused: true,
      revision: (current?.revision ?? 0) + 1,
      updatedAt: Date.now(),
      updatedBy: actor._id,
      reason: args.reason.trim(),
    };
    if (current) await ctx.db.patch(current._id, fields);
    else await ctx.db.insert("providerPolicies", { key: args.key, ...fields });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "provider.pause",
      targetType: "providerPolicy",
      targetId: args.key,
      requestId: args.requestId,
      reason: args.reason,
      before: { paused: current?.paused ?? false },
      after: fields,
    });
  },
});
export const initialize = mutation({
  args: requests,
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "providers.configure");
    if (
      !(await once(
        ctx,
        actor._id,
        args,
        JSON.stringify({ action: "provider.accounting.initialize", ...args }),
      ))
    )
      return;
    const state = await ctx.db.query("providerAccountingState").unique();
    const task = state?.taskId ? await ctx.db.get(state.taskId) : null;
    if (state?.running && task && task.state !== "failed")
      throw new Error("Provider accounting is already initializing");
    if (task?.state === "failed") await ctx.db.delete(task._id);
    const taskId = await enqueueTask(ctx, 0, "adminProviders:backfill", {});
    const fields = {
      ready: false,
      running: true,
      cursor: state?.running ? state.cursor : null,
      processed: state?.running ? state.processed : 0,
      startedAt: state?.running ? state.startedAt : Date.now(),
      completedAt: undefined,
      taskId,
    };
    if (state) await ctx.db.patch(state._id, fields);
    else await ctx.db.insert("providerAccountingState", fields);
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "provider.accounting.initialize",
      targetType: "providerAccounting",
      targetId: "global",
      reason: args.reason,
      requestId: args.requestId,
    });
  },
});
export const backfill = internalMutation({
  args: {},
  handler: async (ctx) => {
    const state = await ctx.db.query("providerAccountingState").unique();
    if (!state?.running) return;
    const page = await ctx.db
      .query("generationJobs")
      .withIndex("by_created")
      .paginate({
        cursor: state.cursor,
        numItems: 50,
        maximumRowsRead: 100,
        maximumBytesRead: 1000000,
      });
    for (const job of page.page) await syncProviderJob(ctx, job._id);
    const taskId = page.isDone
      ? undefined
      : await enqueueTask(ctx, 0, "adminProviders:backfill", {});
    await ctx.db.patch(state._id, {
      cursor: page.isDone ? null : page.continueCursor,
      processed: state.processed + page.page.length,
      ready: page.isDone,
      running: !page.isDone,
      completedAt: page.isDone ? Date.now() : undefined,
      taskId,
    });
    if (page.isDone)
      await appendAuditLog(ctx, {
        actorType: "operator",
        action: "provider.accounting.initialized",
        targetType: "providerAccounting",
        targetId: "global",
        after: { processed: state.processed + page.page.length },
      });
  },
});
