import { formatUsd, parseUsdToMicros, usdInputValue } from "@cinakey/shared";
import { useState } from "react";
import { api } from "@cinakey/backend";
import type { Id } from "@cinakey/backend";
import { useMutation, useQuery } from "@/lib/api/hooks";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Usage = {
  spentUsdMicros: number;
  reservedUsdMicros: number;
  spendCapUsdMicros: number | null;
  remaining: number | null;
};

function BudgetRow({
  title,
  usage,
  onSave,
}: {
  title: string;
  usage: Usage;
  onSave: (cap: number | null) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const value =
    draft ??
    (usage.spendCapUsdMicros === null
      ? ""
      : usdInputValue(usage.spendCapUsdMicros));
  return (
    <form
      className="space-y-2 border-b border-zinc-800 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        let cap: number | null;
        try {
          cap = value.trim() === "" ? null : parseUsdToMicros(value);
        } catch {
          setError(
            "Enter a non-negative USD amount with up to six decimal places, or leave blank for no cap.",
          );
          return;
        }
        setBusy(true);
        setError("");
        setSaved(false);
        void onSave(cap)
          .then(() => {
            setDraft(null);
            setSaved(true);
          })
          .catch((err: unknown) =>
            setError(
              err instanceof Error ? err.message : "Could not save budget",
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-zinc-400">
        Spent: {formatUsd(usage.spentUsdMicros)} · Reserved:{" "}
        {formatUsd(usage.reservedUsdMicros)} · Remaining:{" "}
        {usage.remaining === null ? "No cap" : formatUsd(usage.remaining)}
      </p>
      <div className="flex gap-2">
        <Input
          aria-label={`${title} USD cap`}
          inputMode="decimal"
          placeholder="No cap"
          value={value}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
        />
        <Button type="submit" disabled={busy}>
          Save cap
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-xs text-emerald-400">
          Budget saved.
        </p>
      )}
    </form>
  );
}

export function BudgetSettings() {
  const { workspaceId, canManage } = useWorkspace();
  const report = useQuery(
    api.billing.budgets,
    workspaceId && canManage ? { workspaceId } : "skip",
  );
  const save = useMutation(api.billing.setBudget);
  if (!workspaceId || !canManage) return null;
  if (!report?.workspace)
    return <p className="text-sm text-zinc-500">Loading spending…</p>;
  const update = (
    cap: number | null,
    scope: { seriesId?: Id<"series">; projectId?: Id<"projects"> } = {},
  ) => save({ workspaceId, cap, ...scope });
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-zinc-200">
        Spending and budgets
      </h2>
      <p className="text-xs text-zinc-500">
        Caps are in USD. Reserved usage counts toward caps. Workspace caps reset
        monthly in UTC; series and episode caps cover their lifetime. Blank
        means no cap; zero blocks new spending. Lowering a cap leaves running
        jobs in place.
      </p>
      {report.account && (
        <p className="text-xs text-zinc-400">
          Available: {formatUsd(report.account.available)} · All-time reserved:{" "}
          {formatUsd(report.account.reserved)} · All-time spent:{" "}
          {formatUsd(report.account.spent)}
        </p>
      )}
      <BudgetRow
        title={`Workspace · ${report.month} UTC`}
        usage={report.workspace}
        onSave={(cap) => update(cap)}
      />
      {report.series.map((row) => (
        <BudgetRow
          key={row.id}
          title={`Series · ${row.title}`}
          usage={row}
          onSave={(cap) => update(cap, { seriesId: row.id })}
        />
      ))}
      {report.projects.map((row) => (
        <BudgetRow
          key={row.id}
          title={`${row.seriesId ? "Episode" : "Project"} · ${row.title}`}
          usage={row}
          onSave={(cap) => update(cap, { projectId: row.id })}
        />
      ))}
    </section>
  );
}
