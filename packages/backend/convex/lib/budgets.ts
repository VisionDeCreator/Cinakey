import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
type Ctx = QueryCtx | MutationCtx;
export function budgetMonth(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 7);
}
export async function readTotals(ctx: Ctx, scopeKey: string) {
  const row = await ctx.db
    .query("spendTotals")
    .withIndex("by_scope", (q) => q.eq("scopeKey", scopeKey))
    .unique();
  return {
    spentUsdMicros: row?.spentUsdMicros ?? 0,
    reservedUsdMicros: row?.reservedUsdMicros ?? 0,
  };
}
export function withCap(
  usage: { spentUsdMicros: number; reservedUsdMicros: number },
  cap?: number,
) {
  const committedUsdMicros = usage.spentUsdMicros + usage.reservedUsdMicros;
  return {
    ...usage,
    committedUsdMicros,
    spendCapUsdMicros: cap ?? null,
    remaining: cap === undefined ? null : Math.max(0, cap - committedUsdMicros),
  };
}
export async function projectUsage(ctx: Ctx, projectId: Id<"projects">) {
  const project = await ctx.db.get(projectId);
  if (!project) throw new Error("Project not found");
  return withCap(
    await readTotals(ctx, `project:${projectId}`),
    project.spendCapUsdMicros,
  );
}
export async function updateTotals(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  projectId: Id<"projects">,
  seriesId: Id<"series"> | undefined,
  month: string,
  heldChange: number,
  spentChange: number,
) {
  const keys = [
    `workspace:${workspaceId}:${month}`,
    `project:${projectId}`,
    ...(seriesId ? [`series:${seriesId}`] : []),
  ];
  for (const scopeKey of keys) {
    const row = await ctx.db
      .query("spendTotals")
      .withIndex("by_scope", (q) => q.eq("scopeKey", scopeKey))
      .unique();
    const next = {
      spentUsdMicros: (row?.spentUsdMicros ?? 0) + spentChange,
      reservedUsdMicros: (row?.reservedUsdMicros ?? 0) + heldChange,
    };
    if (Object.values(next).some((v) => !Number.isSafeInteger(v) || v < 0))
      throw new Error("Invalid spending totals");
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("spendTotals", { workspaceId, scopeKey, ...next });
  }
}
export async function checkBudgets(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  projectId: Id<"projects">,
  amount: number,
) {
  const project = await ctx.db.get(projectId);
  const workspace = await ctx.db.get(workspaceId);
  if (!project || !workspace || project.workspaceId !== workspaceId)
    throw new Error("Project/workspace mismatch");
  const month = budgetMonth();
  const scopes = [
    {
      label: "Workspace monthly",
      cap: workspace.monthlySpendCapUsdMicros,
      key: `workspace:${workspaceId}:${month}`,
    },
    {
      label: "Project",
      cap: project.spendCapUsdMicros,
      key: `project:${projectId}`,
    },
  ];
  if (project.seriesId) {
    const series = await ctx.db.get(project.seriesId);
    if (!series || series.workspaceId !== workspaceId)
      throw new Error("Series/workspace mismatch");
    scopes.push({
      label: "Series",
      cap: series.spendCapUsdMicros,
      key: `series:${series._id}`,
    });
  }
  for (const scope of scopes) {
    const usage = await readTotals(ctx, scope.key);
    if (
      scope.cap !== undefined &&
      usage.spentUsdMicros + usage.reservedUsdMicros + amount > scope.cap
    )
      throw new ConvexError({
        code: "SPEND_CAP",
        message: `${scope.label} spend cap reached`,
      });
  }
  return { seriesId: project.seriesId, budgetMonth: month };
}
