import { api } from "@cinakey/backend";
import {
  assertScriptDocument,
  diffScripts,
  scriptToPlainText,
  type ScriptDocument,
} from "@cinakey/shared";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ProposalDoc = {
  _id: string;
  kind:
    | "script_edit"
    | "entities"
    | "rules"
    | "character_details"
    | "image_prompt"
    | "shot_list"
    | "story_treatment"
    | "asset_list"
    | "asset_sheet"
    | "style_block"
    | "script_prompt"
    | "blockout_sheet"
    | "shot_prompt"
    | "continuity"
    | "generate_image";
  status: string;
  payload?: unknown;
  diffSummary?: string;
  estimatedCostCredits?: number;
  projectId: string;
};

export function ProposalCard({ proposal }: { proposal: ProposalDoc }) {
  const accept = useAction(api.proposals.accept);
  const reject = useMutation(api.proposals.reject);
  const updatePayload = useMutation(api.proposals.updatePayload);
  const tipContent = useAction(api.scriptVersions.getContent);
  const getResolvedPayload = useAction(api.proposals.getResolvedPayload);

  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editJson, setEditJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [baseDoc, setBaseDoc] = useState<ScriptDocument | null>(null);
  const [resolvedPayload, setResolvedPayload] = useState<Record<
    string,
    unknown
  > | null>(
    (proposal.payload as Record<string, unknown> | undefined) ?? null,
  );

  const payload = resolvedPayload;

  useEffect(() => {
    if (proposal.payload) {
      setResolvedPayload(proposal.payload as Record<string, unknown>);
      return;
    }
    void getResolvedPayload({ proposalId: proposal._id as never })
      .then((p) => {
        if (p) setResolvedPayload(p as Record<string, unknown>);
      })
      .catch(() => {
        /* ignore */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal._id, proposal.payload]);

  const loadBase = async () => {
    try {
      const result = await tipContent({
        projectId: proposal.projectId as never,
      });
      setBaseDoc(result.document);
    } catch {
      setBaseDoc(null);
    }
  };

  useEffect(() => {
    if (proposal.kind === "script_edit") {
      void loadBase();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per proposal
  }, [proposal._id, proposal.kind]);

  // Load base script once for diff display
  const tip = useQuery(api.scriptVersions.getTip, {
    projectId: proposal.projectId as never,
  });
  void tip;

  let scriptDiffPreview: string | null = null;
  if (proposal.kind === "script_edit" && payload?.document) {
    try {
      const next = assertScriptDocument(payload.document);
      if (baseDoc) {
        const ops = diffScripts(baseDoc, next);
        scriptDiffPreview = `${ops.length} change(s) · ${next.scenes.length} scene(s)\n\n--- proposed ---\n${scriptToPlainText(next).slice(0, 1200)}`;
      } else {
        scriptDiffPreview = `${next.scenes.length} scene(s)\n\n${scriptToPlainText(next).slice(0, 1200)}`;
      }
    } catch {
      scriptDiffPreview = proposal.diffSummary ?? "Script proposal ready";
    }
  } else if (proposal.kind === "script_edit") {
    scriptDiffPreview = proposal.diffSummary ?? "Script proposal ready — Accept to apply.";
  }

  const onAccept = async () => {
    setBusy(true);
    setError(null);
    try {
      let override: unknown;
      if (editing && editJson.trim()) {
        override = JSON.parse(editJson) as unknown;
      }
      await accept({
        proposalId: proposal._id as never,
        payloadOverride: override as never,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accept failed");
    } finally {
      setBusy(false);
    }
  };

  const onReject = async () => {
    setBusy(true);
    setError(null);
    try {
      await reject({ proposalId: proposal._id as never });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    setEditing(true);
    setEditJson(JSON.stringify(payload ?? {}, null, 2));
  };

  const saveEdit = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(editJson) as unknown;
      await updatePayload({
        proposalId: proposal._id as never,
        payload: parsed,
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-zinc-700 bg-zinc-900/80 p-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-amber-400/90">
            Proposal · {proposal.kind.replace("_", " ")}
          </p>
          <p className="text-xs text-zinc-200">
            {proposal.diffSummary ??
              String(payload?.summary ?? "Proposed change")}
          </p>
          {proposal.estimatedCostCredits !== undefined ? (
            <p className="text-[10px] text-zinc-500">
              Est. {proposal.estimatedCostCredits} credits
            </p>
          ) : null}
        </div>
      </div>

      {proposal.kind === "script_edit" && scriptDiffPreview ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-zinc-950 p-2 text-[10px] text-zinc-400">
          {scriptDiffPreview}
        </pre>
      ) : null}

      {proposal.kind === "entities" || proposal.kind === "asset_list" ? (
        <ul className="mt-2 space-y-1 text-[11px] text-zinc-400">
          {((payload?.entities as Array<{ kind: string; name: string; description?: string }>) ?? []).map(
            (e, i) => (
              <li key={i}>
                + {e.kind}: {e.name}
                {e.description ? ` — ${e.description}` : ""}
              </li>
            ),
          )}
        </ul>
      ) : null}

      {proposal.kind === "style_block" ? (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-sm bg-zinc-950 p-2 text-[10px] text-zinc-400">
          {String(payload?.artStyleBlock ?? "")}
        </pre>
      ) : null}

      {proposal.kind === "story_treatment" ? (
        <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
          <p className="text-amber-400/80">Story treatment (pipeline stage 1)</p>
          <p>Logline: {String(payload?.logline ?? "")}</p>
          <p className="text-zinc-600">
            Next after Accept: art style → asset sheets → Seedance script prompt
            (shot-by-shot), not a screenplay-only draft.
          </p>
        </div>
      ) : null}

      {proposal.kind === "asset_sheet" ||
      proposal.kind === "script_prompt" ||
      proposal.kind === "blockout_sheet" ? (
        <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
          <p>
            {proposal.kind === "asset_sheet"
              ? `${String(payload?.type ?? "asset")} sheet`
              : proposal.kind.replace("_", " ")}
            {payload?.approveAndGenerate === true
              ? " · will generate image"
              : ""}
            {payload?.applyShots !== false && proposal.kind === "script_prompt"
              ? " · applies shots"
              : ""}
            {payload?.applyBlockout !== false &&
            proposal.kind === "blockout_sheet"
              ? " · builds 3D blockouts"
              : ""}
          </p>
          {proposal.kind === "script_prompt" &&
          payload?.structured &&
          typeof payload.structured === "object" ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-zinc-950 p-2 text-[10px] text-zinc-500">
              {(() => {
                const s = payload.structured as {
                  totalDurationSec?: number;
                  shots?: Array<{
                    n: number;
                    startSec: number;
                    endSec: number;
                    shotType: string;
                    action: string;
                  }>;
                  references?: unknown[];
                };
                const shots = s.shots ?? [];
                const head = shots
                  .slice(0, 6)
                  .map(
                    (sh) =>
                      `Shot ${sh.n} (${sh.startSec}–${sh.endSec}s) — ${sh.shotType}: ${sh.action.slice(0, 80)}`,
                  )
                  .join("\n");
                return `${s.references?.length ?? 0} refs · ${shots.length} shots · ${s.totalDurationSec ?? "?"}s\n${head}${shots.length > 6 ? "\n…" : ""}`;
              })()}
            </pre>
          ) : null}
        </div>
      ) : null}

      {proposal.kind === "rules" ? (
        <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
          {((payload?.add as string[]) ?? []).map((r) => (
            <p key={`a-${r}`}>+ {r}</p>
          ))}
          {((payload?.remove as string[]) ?? []).map((r) => (
            <p key={`r-${r}`} className="text-red-400">
              − {r}
            </p>
          ))}
          {payload?.replace ? (
            <p>Replace all rules ({(payload.replace as string[]).length})</p>
          ) : null}
        </div>
      ) : null}

      {proposal.kind === "character_details" ? (
        <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
          {payload?.entityName ? (
            <p>Character: {String(payload.entityName)}</p>
          ) : null}
          {payload?.entityId ? (
            <p className="text-zinc-600">id {String(payload.entityId)}</p>
          ) : null}
          {Object.entries(
            (payload?.fields as Record<string, string> | undefined) ?? {},
          ).map(([k, v]) => (
            <p key={k}>
              <span className="text-zinc-500">{k}:</span> {v}
            </p>
          ))}
        </div>
      ) : null}

      {proposal.kind === "image_prompt" ? (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-sm bg-zinc-950 p-2 text-[10px] text-zinc-400">
          {String(payload?.prompt ?? "")}
        </pre>
      ) : null}

      {proposal.kind === "shot_list" ? (
        <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[11px] text-zinc-400">
          <li className="text-zinc-500">
            Scene {String(payload?.sceneElementId ?? "?").slice(0, 8)}…
          </li>
          {(
            (payload?.shots as Array<{
              shotType?: string;
              durationSec?: number;
              cameraMove?: string;
              dialogue?: string;
              lensMm?: number;
            }>) ?? []
          ).map((s, i) => (
            <li key={i}>
              {i + 1}. {s.shotType ?? "shot"}
              {s.lensMm ? ` · ${s.lensMm}mm` : ""}
              {s.cameraMove ? ` · ${s.cameraMove}` : ""}
              {s.durationSec !== undefined ? ` · ${s.durationSec}s` : ""}
              {s.dialogue ? ` — “${s.dialogue.slice(0, 40)}”` : ""}
            </li>
          ))}
        </ul>
      ) : null}

      {proposal.kind === "shot_prompt" ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-zinc-950 p-2 text-[10px] text-zinc-400">
          {String(payload?.promptText ?? "").slice(0, 2000)}
        </pre>
      ) : null}

      {proposal.kind === "continuity" ? (
        <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[11px] text-zinc-400">
          {(
            (payload?.flags as Array<{
              severity?: string;
              message?: string;
            }>) ?? []
          ).map((f, i) => (
            <li key={i}>
              {f.severity ? (
                <span className="uppercase text-amber-400/80">
                  [{f.severity}]{" "}
                </span>
              ) : null}
              {f.message}
            </li>
          ))}
        </ul>
      ) : null}

      {proposal.kind === "generate_image" ? (
        <p className="mt-2 text-[11px] text-zinc-400">
          Generate reference image
          {proposal.estimatedCostCredits !== undefined
            ? ` · ~${proposal.estimatedCostCredits} credits`
            : ""}
        </p>
      ) : null}

      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            value={editJson}
            onChange={(e) => setEditJson(e.target.value)}
            className="min-h-32 font-mono text-[10px]"
          />
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => void saveEdit()}
          >
            Save edits
          </Button>
        </div>
      ) : null}

      {error ? <p className="mt-1 text-[11px] text-red-400">{error}</p> : null}

      <div className={cn("mt-2 flex flex-wrap gap-1.5")}>
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          disabled={busy}
          onClick={() => void onAccept()}
        >
          Accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={busy}
          onClick={startEdit}
        >
          Edit
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          disabled={busy}
          onClick={() => void onReject()}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
