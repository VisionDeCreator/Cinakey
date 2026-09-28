import { api } from "@cinakey/backend";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useCopilotContext } from "@/features/copilot/CopilotContext";

export function ShotsPage() {
  const { projectId } = useParams();
  const { setContext } = useCopilotContext();
  const groups = useQuery(
    api.shotGeneration.listShotsForGeneration,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const activeJobs = useQuery(
    api.shotGeneration.listActiveJobsForProject,
    projectId ? { projectId: projectId as never } : "skip",
  );
  const spend = useQuery(
    api.shotGeneration.getProjectSpend,
    projectId ? { projectId: projectId as never } : "skip",
  );

  useEffect(() => {
    if (projectId) {
      setContext({ view: "video", projectId, selectionIds: [] });
    }
  }, [projectId, setContext]);

  if (!projectId) return null;
  if (groups === undefined) {
    return <p className="text-sm text-zinc-500">Loading shots…</p>;
  }

  const totalShots = groups.reduce((n, g) => n + g.shots.length, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Video</h1>
          <p className="text-xs text-zinc-500">
            {totalShots} shots · Seedance 2.5 generation
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
          {activeJobs && activeJobs.length > 0 ? (
            <span className="rounded bg-amber-500/15 px-2 py-1 text-amber-300">
              {activeJobs.length} job{activeJobs.length === 1 ? "" : "s"} running
            </span>
          ) : null}
          {spend?.spendCapCredits != null ? (
            <span>
              Spend {spend.spentCredits}/{spend.spendCapCredits} credits
            </span>
          ) : (
            <span>Spent {spend?.spentCredits ?? 0} credits</span>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No shots yet. Accept a script prompt or build a shot list in Blockout.
        </p>
      ) : null}

      {groups.map(({ scene, shots }) => (
        <section key={scene._id} className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-300">
            {scene.heading}
          </h2>
          <div className="overflow-x-auto border border-zinc-800">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead className="border-b border-zinc-800 bg-zinc-950 text-[10px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Keyframe</th>
                  <th className="px-3 py-2 font-medium">Selected take</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Credits</th>
                </tr>
              </thead>
              <tbody>
                {shots.map((shot) => (
                  <tr
                    key={shot._id}
                    className="border-b border-zinc-800/80 hover:bg-zinc-900/50"
                  >
                    <td className="px-3 py-2 tabular-nums text-zinc-500">
                      {shot.order + 1}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/projects/${projectId}/video/${shot._id}`}
                        className="block h-12 w-20 overflow-hidden bg-zinc-900"
                      >
                        {shot.keyframeUrl ? (
                          <img
                            src={shot.keyframeUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full items-center justify-center text-[9px] text-zinc-600">
                            —
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/projects/${projectId}/video/${shot._id}`}
                        className="block h-12 w-20 overflow-hidden bg-zinc-900"
                      >
                        {shot.selectedTakeThumb ? (
                          <video
                            src={shot.selectedTakeThumb}
                            className="h-full w-full object-cover"
                            muted
                            playsInline
                          />
                        ) : (
                          <span className="flex h-full items-center justify-center text-[9px] text-zinc-600">
                            —
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-zinc-200">
                      <Link
                        to={`/projects/${projectId}/video/${shot._id}`}
                        className="hover:underline"
                      >
                        {shot.shotType}
                      </Link>
                      <div className="text-[10px] text-zinc-500">
                        {shot.durationSec}s
                        {shot.cameraMove ? ` · ${shot.cameraMove}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                          shot.status === "generating"
                            ? "bg-amber-500/20 text-amber-300"
                            : shot.status === "selected"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {shot.activeJobStatus ?? shot.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-zinc-400">
                      {shot.creditsUsed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
