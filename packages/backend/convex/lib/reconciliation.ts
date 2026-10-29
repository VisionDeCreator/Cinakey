import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Operator audit/rebuild path; admission and reports never scan the ledger. */
export async function auditAccounting(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  limit?: number,
) {
  if (!(await ctx.db.get(workspaceId))) throw new Error("Workspace not found");
  const ledgerQuery = ctx.db
    .query("usageLedger")
    .withIndex("by_workspace_sequence", (q) =>
      q.eq("workspaceId", workspaceId),
    );
  const ledger = limit
    ? await ledgerQuery.take(limit + 1)
    : await ledgerQuery.collect();
  if (limit && ledger.length > limit)
    throw new Error(
      "Ledger exceeds interactive audit limit; use an offline operator audit",
    );
  const account = {
    available: 0,
    funded: 0,
    reserved: 0,
    spent: 0,
    sequence: 0,
  };
  const holds = new Map<string, (typeof ledger)[number]>();
  const closed = new Set<string>();
  const totals = new Map<
    string,
    {
      scopeKey: string;
      spentUsdMicros: number;
      reservedUsdMicros: number;
      standardPriceUsdMicros?: number;
      providerCostUsdMicros?: number;
    }
  >();
  for (const entry of ledger) {
    if (
      entry.sequence !== account.sequence + 1 ||
      !Number.isSafeInteger(entry.delta)
    )
      throw new Error("Invalid authoritative ledger sequence or amount");
    account.sequence = entry.sequence;
    account.available += entry.delta;
    if (account.available !== entry.balanceAfter || account.available < 0)
      throw new Error("Authoritative ledger does not reconcile");
    if (
      entry.reason === "grant" ||
      entry.reason === "adjustment" ||
      entry.reason === "funding_expiry" ||
      entry.reason === "funding_reversal"
    ) {
      account.funded += entry.delta;
      continue;
    }
    if (!entry.jobId || !entry.projectId || !entry.budgetMonth)
      throw new Error("Missing financial attribution");
    let held: number;
    let spent = 0;
    if (entry.reason === "reserve") {
      if (holds.has(entry.jobId) || entry.delta >= 0)
        throw new Error("Invalid duplicate reservation");
      holds.set(entry.jobId, entry);
      held = -entry.delta;
    } else {
      const reserve = holds.get(entry.jobId);
      if (
        !reserve ||
        closed.has(entry.jobId) ||
        reserve.projectId !== entry.projectId ||
        reserve.seriesId !== entry.seriesId ||
        reserve.budgetMonth !== entry.budgetMonth ||
        reserve.userId !== entry.userId ||
        entry.delta < 0 ||
        entry.delta > -reserve.delta ||
        (entry.reason === "refund" && entry.delta !== -reserve.delta)
      )
        throw new Error("Invalid authoritative settlement");
      closed.add(entry.jobId);
      held = reserve.delta;
      spent = -reserve.delta - entry.delta;
    }
    account.reserved += held;
    account.spent += spent;
    const keys = [
      `workspace:${workspaceId}:${entry.budgetMonth}`,
      `project:${entry.projectId}`,
      ...(entry.seriesId ? [`series:${entry.seriesId}`] : []),
    ];
    for (const scopeKey of keys) {
      const row = totals.get(scopeKey) ?? {
        scopeKey,
        spentUsdMicros: 0,
        reservedUsdMicros: 0,
      };
      row.spentUsdMicros += entry.budgetSpentUsdMicros ?? spent;
      if (entry.companyFunded) {
        row.standardPriceUsdMicros = (row.standardPriceUsdMicros ?? 0) + spent;
        row.providerCostUsdMicros =
          (row.providerCostUsdMicros ?? 0) + (entry.providerCostUsdMicros ?? 0);
      }
      row.reservedUsdMicros += held;
      totals.set(scopeKey, row);
    }
  }
  if (
    Object.values(account).some((v) => !Number.isSafeInteger(v) || v < 0) ||
    account.funded !== account.available + account.reserved + account.spent
  )
    throw new Error("Invalid reconstructed account");
  const storedAccount = await ctx.db
    .query("billingAccounts")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  const storedTotalsQuery = ctx.db
    .query("spendTotals")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId));
  const storedTotals = limit
    ? await storedTotalsQuery.take(limit * 3 + 1)
    : await storedTotalsQuery.collect();
  if (limit && storedTotals.length > limit * 3)
    throw new Error("Too many scopes for interactive audit");
  const differences: string[] = [];
  for (const key of Object.keys(account) as Array<keyof typeof account>)
    if ((storedAccount?.[key] ?? 0) !== account[key])
      differences.push(`account:${key}`);
  for (const row of storedTotals) {
    const expected = totals.get(row.scopeKey);
    if (
      !expected ||
      expected.spentUsdMicros !== row.spentUsdMicros ||
      expected.reservedUsdMicros !== row.reservedUsdMicros ||
      (expected.standardPriceUsdMicros ?? 0) !==
        (row.standardPriceUsdMicros ?? 0) ||
      (expected.providerCostUsdMicros ?? 0) !== (row.providerCostUsdMicros ?? 0)
    )
      differences.push(row.scopeKey);
  }
  for (const key of totals.keys())
    if (!storedTotals.some((row) => row.scopeKey === key))
      differences.push(key);
  return {
    consistent: differences.length === 0,
    differences,
    account,
    totals: [...totals.values()],
  };
}
