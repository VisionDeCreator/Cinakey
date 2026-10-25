import type { StagingIssue } from "./audit";
import type { StagingPlan } from "./schema";

function hintFor(problem: string): string {
  if (/out of frame|behind camera/.test(problem)) {
    return 'the camera does not see them — choose a side that faces them, a wider size, move "follow", or fix their path / subject';
  }
  if (/camera inside/.test(problem)) {
    return "the camera is inside a set piece — choose another side / from, or move that piece off the camera";
  }
  if (/below ground/.test(problem))
    return "raise the camera (angle eye / high)";
  if (/hidden while framed/.test(problem))
    return 'they are not visible at that time — check "visible" or frame someone else';
  if (/is not on/.test(problem)) {
    return 'the rider is not on the mount — set "rides" + "ridesFrom" or add a "mount" move with "target"';
  }
  return "fix the staging so this reads correctly";
}

/**
 * One repair request for the model: each faulty shot with its problems, a
 * concrete hint, and that shot's current camera + moves.
 */
export function buildAuditRepairMessage(
  issues: StagingIssue[],
  plan: StagingPlan,
): { role: "user"; content: string } {
  const byShot = new Map<number, Set<string>>();
  for (const i of issues) {
    const set = byShot.get(i.shot) ?? new Set<string>();
    set.add(i.problem);
    byShot.set(i.shot, set);
  }
  const planByN = new Map(plan.shots.map((s) => [s.n, s] as const));
  const lines = [...byShot.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, 12)
    .map(([n, problems]) => {
      const s = planByN.get(n);
      const current = s
        ? ` Current: ${JSON.stringify({ camera: s.camera, moves: s.moves })}`
        : "";
      return `- Shot ${n}: ${[...problems].map((p) => `${p} (${hintFor(p)})`).join("; ")}.${current}`;
    });
  return {
    role: "user",
    content: `I built this plan and checked every shot. These need fixing:\n${lines.join("\n")}\nReturn the corrected full JSON object only. Keep everything that is not listed unchanged.`,
  };
}
