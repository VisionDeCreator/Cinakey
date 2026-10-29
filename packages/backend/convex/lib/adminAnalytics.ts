import {
  ANALYTICS_METRICS,
  ANALYTICS_FINANCIAL_METRICS,
  type AnalyticsMetric,
  type AnalyticsDimension,
  providerForModel,
} from "@cinakey/shared";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
export const REPORT_STAGES = [
  "accounts",
  "workspaces",
  "jobs",
  "events",
  "ledger",
  "orders",
  "egress",
  "r2",
  "legacyMedia",
] as const;
export type Metrics = Partial<Record<AnalyticsMetric, number>>;
export function visibleMetrics(
  metrics: Record<string, number>,
  financial: boolean,
) {
  return Object.fromEntries(
    Object.entries(metrics).filter(
      ([k]) =>
        k in ANALYTICS_METRICS &&
        (financial || !ANALYTICS_FINANCIAL_METRICS.has(k as AnalyticsMetric)),
    ),
  );
}
export function csvCell(value: string | number) {
  const text = String(value);
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export async function increment(
  ctx: MutationCtx,
  reportId: Id<"analyticsReports">,
  dimension: AnalyticsDimension,
  key: string,
  metrics: Metrics,
) {
  if (key.length > 160)
    throw new Error("Analytics grouping key exceeds supported length");
  const row = await ctx.db
    .query("analyticsReportRows")
    .withIndex("by_report_dimension_key", (q) =>
      q.eq("reportId", reportId).eq("dimension", dimension).eq("key", key),
    )
    .unique();
  const next = { ...row?.metrics };
  for (const [metric, value] of Object.entries(metrics)) {
    if (
      !(metric in ANALYTICS_METRICS) ||
      !Number.isSafeInteger(value) ||
      value < 0
    )
      throw new Error("Invalid analytics metric");
    const result = (next[metric] ?? 0) + value;
    if (!Number.isSafeInteger(result))
      throw new Error("Analytics total exceeds integer precision");
    next[metric] = result;
  }
  if (row) await ctx.db.patch(row._id, { metrics: next });
  else
    await ctx.db.insert("analyticsReportRows", {
      reportId,
      dimension,
      key,
      metrics: next,
    });
}
export async function contribute(
  ctx: MutationCtx,
  report: Doc<"analyticsReports">,
  metrics: Metrics,
  options: {
    time?: number;
    workspaceId?: Id<"workspaces">;
    model?: string;
  } = {},
) {
  await increment(ctx, report._id, "total", "all", metrics);
  if (options.time !== undefined)
    await increment(
      ctx,
      report._id,
      "day",
      new Date(options.time).toISOString().slice(0, 10),
      metrics,
    );
  if (options.workspaceId)
    await increment(ctx, report._id, "workspace", options.workspaceId, metrics);
  if (options.model) {
    await increment(ctx, report._id, "model", options.model, metrics);
    await increment(
      ctx,
      report._id,
      "provider",
      providerForModel(options.model),
      metrics,
    );
  }
}
async function first(
  ctx: MutationCtx,
  reportId: Id<"analyticsReports">,
  scope: string,
  identity: string,
) {
  const row = await ctx.db
    .query("analyticsReportSeen")
    .withIndex("by_report_scope_identity", (q) =>
      q.eq("reportId", reportId).eq("scope", scope).eq("identity", identity),
    )
    .unique();
  if (row) return false;
  await ctx.db.insert("analyticsReportSeen", { reportId, scope, identity });
  return true;
}
export async function activity(
  ctx: MutationCtx,
  report: Doc<"analyticsReports">,
  time: number,
  userId: Id<"users"> | undefined,
  workspaceId: Id<"workspaces"> | undefined,
  event?: "starter" | "export",
) {
  const current = time >= report.from && time < report.to;
  if (
    current &&
    workspaceId &&
    (await first(ctx, report._id, "activeWorkspace", workspaceId))
  )
    await increment(ctx, report._id, "total", "all", { activeWorkspaces: 1 });
  if (!userId) {
    if (current) await contribute(ctx, report, { unclassifiedActivity: 1 });
    return;
  }
  const user = await ctx.db.get(userId);
  if (!user) {
    if (current) await contribute(ctx, report, { unclassifiedActivity: 1 });
    return;
  }
  if (user.isStaff || user.isAnonymous) return;
  const period = current ? "current" : "prior";
  if (await first(ctx, report._id, `active:${period}`, userId))
    await increment(ctx, report._id, "total", "all", {
      [current ? "activeAccounts" : "priorActiveAccounts"]: 1,
    });
  const other = await ctx.db
    .query("analyticsReportSeen")
    .withIndex("by_report_scope_identity", (q) =>
      q
        .eq("reportId", report._id)
        .eq("scope", `active:${current ? "prior" : "current"}`)
        .eq("identity", userId),
    )
    .unique();
  if (other && (await first(ctx, report._id, "active:returning", userId)))
    await increment(ctx, report._id, "total", "all", { returningAccounts: 1 });
  if (current) {
    const day = new Date(time).toISOString().slice(0, 10);
    if (await first(ctx, report._id, `day:${day}`, userId))
      await increment(ctx, report._id, "day", day, { activeAccounts: 1 });
    if (
      workspaceId &&
      (await first(ctx, report._id, `workspace:${workspaceId}`, userId))
    )
      await increment(ctx, report._id, "workspace", workspaceId, {
        activeAccounts: 1,
      });
    if (event && (await first(ctx, report._id, `activation:${event}`, userId)))
      await increment(ctx, report._id, "total", "all", {
        [event === "starter" ? "starterAccounts" : "exportAccounts"]: 1,
        ...(user._creationTime >= report.from && user._creationTime < report.to
          ? {
              [event === "starter"
                ? "newStarterAccounts"
                : "newExportAccounts"]: 1,
            }
          : {}),
      });
  }
}
