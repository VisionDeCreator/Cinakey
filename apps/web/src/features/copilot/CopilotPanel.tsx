import { api } from "@cinakey/backend";
import { ConvexError } from "convex/values";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  useCopilotContext,
  type CopilotMode,
  type CopilotRole,
} from "@/features/copilot/CopilotContext";
import { ProposalCard } from "@/features/copilot/ProposalCard";
import { cn } from "@/lib/utils";

const ROLES: { id: CopilotRole | "auto"; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "director", label: "Director" },
  { id: "screenwriter", label: "Writer" },
  { id: "character_designer", label: "Character" },
];

const MODES: { id: CopilotMode; label: string }[] = [
  { id: "brainstorm", label: "Brainstorm" },
  { id: "critique", label: "Critique" },
  { id: "pacing", label: "Pacing" },
  { id: "continuity", label: "Continuity" },
];

type CreditShortfall = {
  balance: number;
  required: number;
};

function errorText(err: unknown): string {
  if (err instanceof ConvexError) {
    const data = err.data as { code?: string; message?: string };
    if (typeof data?.message === "string") return data.message;
    if (data?.code === "INSUFFICIENT_CREDITS") {
      return "Not enough credits for this reply.";
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function parseCreditShortfall(err: unknown): CreditShortfall | null {
  if (err instanceof ConvexError) {
    const data = err.data as {
      code?: string;
      balance?: number;
      required?: number;
    };
    if (
      data?.code === "INSUFFICIENT_CREDITS" &&
      typeof data.balance === "number" &&
      typeof data.required === "number"
    ) {
      return { balance: data.balance, required: data.required };
    }
  }
  const message = errorText(err);
  if (!/insufficient credits/i.test(message)) return null;
  const balanceMatch = message.match(/balance\s+(\d+)/i);
  const requiredMatch =
    message.match(/required[:\s]+(\d+)/i) ??
    message.match(/delta\s+-?(\d+)/i) ??
    message.match(/need\s+(\d+)/i);
  return {
    balance: balanceMatch ? Number(balanceMatch[1]) : 0,
    required: requiredMatch ? Number(requiredMatch[1]) : 2,
  };
}

/** Never surface Convex request IDs / stack frames in the UI. */
function friendlyCopilotError(err: unknown): string {
  const shortfall = parseCreditShortfall(err);
  if (shortfall) {
    return `Not enough credits (need ${shortfall.required}, have ${shortfall.balance}).`;
  }
  const raw = errorText(err);
  if (/DEEPSEEK_API_KEY/i.test(raw)) {
    return "DeepSeek is not configured. Set DEEPSEEK_API_KEY or enable USE_MOCK_ADAPTERS.";
  }
  if (/not authenticated|forbidden/i.test(raw)) {
    return "Please sign in again and retry.";
  }
  const uncaught = raw.match(/Uncaught Error:\s*(.+?)(?:\s+at\s|\s+Called by|$)/i);
  if (uncaught?.[1]) {
    const cleaned = uncaught[1].replace(/^Uncaught Error:\s*/i, "").trim();
    if (cleaned.length > 0 && cleaned.length < 120) return cleaned;
  }
  if (/\[CONVEX/i.test(raw) || raw.length > 140) {
    return "Something went wrong. Try again in a moment.";
  }
  return raw;
}

export function CopilotPanel({ projectId }: { projectId: string }) {
  const {
    page,
    roleOverride,
    setRoleOverride,
    mode,
    setMode,
    resolvedRole,
  } = useCopilotContext();

  const messages = useQuery(api.copilot.listMessages, {
    projectId: projectId as never,
  });
  const proposals = useQuery(api.copilot.listPendingProposals, {
    projectId: projectId as never,
  });
  const project = useQuery(api.projects.get, {
    projectId: projectId as never,
  });
  const balance = useQuery(api.credits.getBalance);
  const me = useQuery(api.users.viewer);
  const runTurn = useAction(api.copilot.runTurn);
  const updateRules = useMutation(api.projects.update);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditShortfall, setCreditShortfall] =
    useState<CreditShortfall | null>(null);
  const [rulesDraft, setRulesDraft] = useState<string | null>(null);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [
    messages?.length,
    messages?.[messages.length - 1]?.content,
    proposals?.length,
  ]);

  const send = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    setCreditShortfall(null);
    setDraft("");
    try {
      await runTurn({
        projectId: projectId as never,
        content,
        role: resolvedRole,
        mode,
        view: page.view,
        selectionIds: page.selectionIds,
      });
    } catch (err) {
      setDraft(content);
      const shortfall = parseCreditShortfall(err);
      if (shortfall) {
        setCreditShortfall(shortfall);
        setError(null);
      } else {
        setError(friendlyCopilotError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const showCreditNotice =
    creditShortfall !== null ||
    (balance !== undefined && balance.balance < 2);

  const proposalsById = new Map(
    (proposals ?? []).map((p) => [p._id as string, p]),
  );
  const linkedProposalIds = new Set(
    (messages ?? []).flatMap((m) =>
      ((m.proposalIds as string[] | undefined) ?? []).map(String),
    ),
  );
  const orphanProposals = (proposals ?? []).filter(
    (p) => !linkedProposalIds.has(p._id as string),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-zinc-800 px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRoleOverride(r.id)}
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                roleOverride === r.id
                  ? "bg-zinc-200 text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[10px]",
                mode === m.id
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-zinc-600">
          Role: {resolvedRole.replace("_", " ")} · View: {page.view}
          {balance !== undefined ? (
            <>
              {" "}
              ·{" "}
              <span
                className={cn(
                  balance.balance < 2 ? "text-amber-400" : "text-zinc-500",
                )}
              >
                {balance.balance} credits
              </span>
            </>
          ) : null}
        </p>
      </div>

      {project ? (
        <div className="shrink-0 border-b border-zinc-800 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="flex min-w-0 items-center gap-1.5 text-left"
              onClick={() => setRulesExpanded((v) => !v)}
            >
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                Rules
              </p>
              <span className="truncate text-[10px] text-zinc-600">
                {project.rules.length === 0
                  ? "(none)"
                  : `(${project.rules.length})`}
              </span>
              <span className="text-[10px] text-zinc-600">
                {rulesExpanded ? "▾" : "▸"}
              </span>
            </button>
            <button
              type="button"
              className="shrink-0 text-[10px] text-zinc-500 hover:text-zinc-300"
              onClick={() => {
                setRulesExpanded(true);
                setRulesDraft(
                  rulesDraft === null ? project.rules.join("\n") : null,
                );
              }}
            >
              {rulesDraft === null ? "Edit" : "Cancel"}
            </button>
          </div>
          {rulesDraft !== null ? (
            <div className="mt-1 space-y-1">
              <Textarea
                value={rulesDraft}
                onChange={(e) => setRulesDraft(e.target.value)}
                className="max-h-32 min-h-16 resize-y text-xs"
                placeholder="One rule per line"
              />
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  void updateRules({
                    projectId: projectId as never,
                    rules: rulesDraft
                      .split("\n")
                      .map((r) => r.trim())
                      .filter(Boolean),
                  }).then(() => {
                    setRulesDraft(null);
                    setRulesExpanded(false);
                  });
                }}
              >
                Save rules
              </Button>
            </div>
          ) : rulesExpanded ? (
            <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto">
              {project.rules.length === 0 ? (
                <li className="text-[11px] text-zinc-600">No rules yet.</li>
              ) : (
                project.rules.map((r) => (
                  <li key={r} className="text-[11px] leading-snug text-zinc-400">
                    · {r}
                  </li>
                ))
              )}
            </ul>
          ) : project.rules.length > 0 ? (
            <p className="mt-0.5 truncate text-[11px] text-zinc-600">
              {project.rules[0]}
              {project.rules.length > 1
                ? ` · +${project.rules.length - 1} more`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {proposals && proposals.length > 0 ? (
        <div className="shrink-0 border-b border-amber-900/40 bg-amber-950/30 px-3 py-1.5">
          <p className="text-[10px] uppercase tracking-wider text-amber-400/90">
            {proposals.length} pending proposal
            {proposals.length === 1 ? "" : "s"} — Accept below to apply
          </p>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
        {!messages || messages.length === 0 ? (
          <p className="text-xs text-zinc-500">
            Ask the copilot to draft a script from your brief, critique a scene,
            or propose new characters.
          </p>
        ) : (
          messages.map((m) => {
            const messageProposals = (
              (m.proposalIds as string[] | undefined) ?? []
            )
              .map((id) => proposalsById.get(String(id)))
              .filter((p): p is NonNullable<typeof p> => p !== undefined);

            return (
              <div key={m._id} className="space-y-2">
                <div
                  className={cn(
                    "rounded-sm px-2 py-1.5 text-xs leading-relaxed",
                    m.role === "user"
                      ? "bg-zinc-800 text-zinc-100"
                      : "bg-transparent text-zinc-300",
                  )}
                >
                  <p className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
                    {m.role}
                    {m.streaming ? " · typing…" : ""}
                  </p>
                  <p className="whitespace-pre-wrap">{m.content || "…"}</p>
                </div>
                {messageProposals.length > 0 ? (
                  <div className="space-y-2">
                    {messageProposals.map((p) => (
                      <ProposalCard key={p._id} proposal={p} />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}

        {orphanProposals.length > 0 ? (
          <div className="space-y-2 border border-amber-900/40 bg-amber-950/20 p-2">
            <p className="text-[10px] uppercase tracking-wider text-amber-400/90">
              Pending proposals
            </p>
            {orphanProposals.map((p) => (
              <ProposalCard key={`orphan-${p._id}`} proposal={p} />
            ))}
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {showCreditNotice ? (
        <div className="mx-3 mb-1 border border-amber-900/40 bg-amber-950/30 px-3 py-2">
          <p className="text-xs text-amber-100/90">
            {creditShortfall
              ? `Not enough credits for this reply — need ${creditShortfall.required}, have ${creditShortfall.balance}.`
              : "You're out of credits."}
          </p>
          {me?.isStaff === true ? (
            <Link
              to="/dev"
              className="mt-1 inline-block text-[11px] text-amber-200/80 underline-offset-2 hover:underline"
            >
              Grant credits in Dev tools
            </Link>
          ) : (
            <p className="mt-1 text-[11px] text-amber-200/60">
              Ask a staff admin to top up your account.
            </p>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="mx-3 mb-1 border border-red-900/40 bg-red-950/30 px-3 py-2">
          <p className="text-xs text-red-200/90">{error}</p>
        </div>
      ) : null}

      <div className="border-t border-zinc-800 p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask the copilot…"
          className="min-h-16 resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          className="mt-2 w-full"
          disabled={busy || draft.trim().length === 0}
          onClick={() => void send()}
        >
          {busy ? "Thinking…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
