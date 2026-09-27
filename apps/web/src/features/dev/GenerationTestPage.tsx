import { api } from "@cinakey/backend";
import type { ModelCapabilities, ModelOperation } from "@cinakey/shared";
import { useAction, useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Dev/test page: pick an adapter, estimate cost, run a job, watch status + credits.
 */
export function GenerationTestPage() {
  const capabilities = useQuery(api.generation.listCapabilities);
  const projects = useQuery(api.projects.listMine, {});
  const balance = useQuery(api.credits.getBalance);
  const unread = useQuery(api.notifications.listUnread);
  const createProject = useMutation(api.projects.create);
  const grantDev = useMutation(api.credits.grantDev);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const startGeneration = useAction(api.generation.startGeneration);

  const [adapterId, setAdapterId] = useState<string>("gpt-image-2");
  const [kind, setKind] = useState<string>("text-to-image");
  const [prompt, setPrompt] = useState("A cinematic wide shot of a rainy street at night");
  const [durationSec, setDurationSec] = useState(5);
  const [resolution, setResolution] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [forceFail, setForceFail] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [grantAmount, setGrantAmount] = useState(100);

  const selected: ModelCapabilities | undefined = useMemo(
    () => capabilities?.find((c) => c.id === adapterId),
    [capabilities, adapterId],
  );

  const estimateInput = useMemo(() => {
    const input: Record<string, unknown> = {};
    if (selected?.kind === "video") {
      input.durationSec = durationSec;
    }
    if (resolution) input.resolution = resolution;
    if (aspectRatio) input.aspectRatio = aspectRatio;
    if (forceFail) input.forceFail = true;
    return input;
  }, [selected, durationSec, resolution, aspectRatio, forceFail]);

  const estimate = useQuery(
    api.generation.estimateCost,
    selected
      ? { adapterId, kind, input: estimateInput }
      : "skip",
  );

  const job = useQuery(
    api.generation.getJob,
    jobId ? { jobId: jobId as never } : "skip",
  );

  const outputAssetId = job?.outputAssetIds?.[0] ?? null;
  const outputUrl = useQuery(
    api.storage.getAssetUrl,
    outputAssetId ? { assetId: outputAssetId } : "skip",
  );

  async function ensureProject(): Promise<string> {
    if (projectId) return projectId;
    if (projects && projects.length > 0) {
      const id = projects[0]!.project._id;
      setProjectId(id);
      return id;
    }
    const id = await createProject({ title: "Generation Test Project" });
    setProjectId(id);
    return id;
  }

  function onAdapterChange(id: string) {
    setAdapterId(id);
    const caps = capabilities?.find((c) => c.id === id);
    const firstOp = caps?.operations[0];
    if (firstOp) setKind(firstOp);
    setResolution(caps?.resolutions?.[0] ?? "");
    setAspectRatio(caps?.aspectRatios?.[0] ?? "");
    if (caps?.durations?.[0]) setDurationSec(caps.durations[0]);
  }

  async function onGrant() {
    setBusy(true);
    setStatus("Granting credits…");
    try {
      const result = await grantDev({ amount: grantAmount });
      setStatus(`Granted. Balance now ${result.balanceAfter}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Grant failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRun() {
    setBusy(true);
    setStatus("Starting generation…");
    try {
      const pid = await ensureProject();
      const result = await startGeneration({
        projectId: pid as never,
        adapterId,
        kind,
        prompt,
        input: {
          ...estimateInput,
          mockDelayMs: 100,
        },
      });
      setJobId(result.jobId);
      setStatus(
        `Job ${result.jobId} queued (est. ${result.estimatedCostCredits} credits)`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Start failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Generation test</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Estimate → reserve → run adapter → settle or refund. Use{" "}
          <code className="text-zinc-300">USE_MOCK_ADAPTERS=true</code> to avoid
          spend.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="balance">Credits</Label>
          <p id="balance" className="text-lg text-zinc-100">
            {balance?.balance ?? "…"}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="grant">Grant</Label>
          <Input
            id="grant"
            type="number"
            className="w-24"
            value={grantAmount}
            onChange={(e) => setGrantAmount(Number(e.target.value))}
          />
        </div>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void onGrant()}>
          Grant credits
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="adapter">Adapter</Label>
        <select
          id="adapter"
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          value={adapterId}
          onChange={(e) => onAdapterChange(e.target.value)}
        >
          {(capabilities ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} ({c.kind})
            </option>
          ))}
        </select>
      </div>

      {selected ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="kind">Operation</Label>
          <select
            id="kind"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {selected.operations.map((op: ModelOperation) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="prompt">Prompt</Label>
        <textarea
          id="prompt"
          rows={3}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      {selected?.durations ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="duration">Duration (sec)</Label>
          <select
            id="duration"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            value={durationSec}
            onChange={(e) => setDurationSec(Number(e.target.value))}
          >
            {selected.durations.map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {selected?.resolutions ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="res">Resolution</Label>
          <select
            id="res"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          >
            {selected.resolutions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {selected?.aspectRatios ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="ar">Aspect ratio</Label>
          <select
            id="ar"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
          >
            {selected.aspectRatios.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={forceFail}
          onChange={(e) => setForceFail(e.target.checked)}
        />
        Force failure (refund path, mock)
      </label>

      <p className="text-sm text-zinc-400">
        Estimated cost:{" "}
        <span className="text-zinc-100">
          {estimate?.credits ?? "…"} credits
        </span>
        {estimate?.costModel
          ? ` (${estimate.costModel.creditsPerUnit}/${estimate.costModel.unit})`
          : null}
      </p>

      <Button type="button" disabled={busy || !prompt} onClick={() => void onRun()}>
        Run generation
      </Button>

      {status ? <p className="text-sm text-zinc-400">{status}</p> : null}

      {job ? (
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-zinc-500">Status</dt>
          <dd className="text-zinc-200">{job.status}</dd>
          <dt className="text-zinc-500">Attempts</dt>
          <dd className="text-zinc-200">{job.attempts}</dd>
          <dt className="text-zinc-500">Estimated</dt>
          <dd className="text-zinc-200">{job.estimatedCostCredits}</dd>
          <dt className="text-zinc-500">Actual</dt>
          <dd className="text-zinc-200">{job.actualCostCredits ?? "—"}</dd>
          {job.errorMessage ? (
            <>
              <dt className="text-zinc-500">Error</dt>
              <dd className="text-zinc-200">{job.errorMessage}</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {outputUrl && job?.model.includes("image") ? (
        <img
          src={outputUrl}
          alt="Generated"
          className="max-h-80 w-full rounded-md bg-zinc-900 object-contain"
        />
      ) : null}

      {outputUrl && !job?.model.includes("image") ? (
        <a
          href={outputUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-sky-400 underline"
        >
          Open output
        </a>
      ) : null}

      {unread && unread.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-zinc-800 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-200">
              Unread notifications ({unread.length})
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void markAllRead()}
            >
              Mark all read
            </Button>
          </div>
          <ul className="space-y-1 text-sm text-zinc-400">
            {unread.map((n) => (
              <li key={n._id}>
                <span className="text-zinc-200">{n.title}</span>
                {n.body ? ` — ${n.body}` : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
