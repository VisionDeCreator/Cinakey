/**
 * Who rides what, and when — resolved from every signal we have, so a rider
 * never gets left standing while their mount runs off:
 *
 * 1. `rides` / `ridesFrom` on the cast member (or an alias the schema maps);
 * 2. `mount` / `dismount` moves;
 * 3. the script itself (a character who rides / is in the saddle of an animal
 *    or vehicle — via the rule director's cast roles), when the plan forgot;
 * 4. the plan's own motion: someone jumps / leaps / mounts right beside an
 *    animal or vehicle that then travels away without them.
 */

import type { ScriptPromptData } from "../../prompt-templates/schemas";
import { buildCast } from "../director/cast";
import type { StagingCast, StagingMove, StagingPlan } from "./schema";

export type RidingInterval = { mount: string; from: number; to: number };
export type TimedMove = { t0: number; t1: number; move: StagingMove };
type GroundPose = { x: number; z: number };

const RIDEABLE = new Set<StagingCast["kind"]>([
  "quadruped",
  "vehicle",
  "creature",
]);
const BOARDING = new Set<StagingMove["action"]>(["jump", "leap", "mount"]);

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/^the\s+/, "")
    .split(/[^a-z0-9]+/)
    .filter(
      (w) =>
        w.length > 2 &&
        !["the", "and", "giant", "riding", "big", "old", "young"].includes(w),
    );

/** Map a rule-director cast role (from the script) onto a plan cast member. */
function matchCast(
  plan: StagingPlan,
  role: { name: string; imageN?: number },
  pred: (c: StagingCast) => boolean,
): StagingCast | undefined {
  const pool = plan.cast.filter(pred);
  if (role.imageN !== undefined) {
    const byImage = pool.find((c) => c.imageN === role.imageN);
    if (byImage) return byImage;
  }
  const w = words(role.name);
  return pool.find((c) =>
    words(`${c.name} ${c.id}`).some((x) => w.includes(x)),
  );
}

function firstTravel(
  moves: TimedMove[],
  ground: (t: number) => GroundPose,
): number | null {
  for (const m of [...moves].sort((a, b) => a.t0 - b.t0)) {
    const a = ground(m.t0);
    const b = ground(m.t1);
    if (Math.hypot(b.x - a.x, b.z - a.z) > 1) return m.t0;
  }
  return null;
}

export function resolveRiding(
  plan: StagingPlan,
  script: ScriptPromptData | null,
  movesBy: Map<string, TimedMove[]>,
  ground: (id: string, t: number) => GroundPose,
  duration: number,
): Map<string, RidingInterval[]> {
  const out = new Map<string, RidingInterval[]>();
  const castById = new Map(plan.cast.map((c) => [c.id, c] as const));
  const push = (rider: string, iv: RidingInterval) => {
    if (rider === iv.mount) return;
    const list = out.get(rider) ?? [];
    list.push(iv);
    out.set(rider, list);
  };

  // 1 + 2: explicit links and mount / dismount moves
  for (const c of plan.cast) {
    const events: Array<{ t: number; mount?: string; off?: boolean }> = [];
    if (c.rides && castById.has(c.rides))
      events.push({ t: c.ridesFrom ?? 0, mount: c.rides });
    for (const m of movesBy.get(c.id) ?? []) {
      if (m.move.action === "mount") {
        const target =
          m.move.target ??
          // Nearest rideable cast member at the time of the move
          plan.cast
            .filter((o) => o.id !== c.id && RIDEABLE.has(o.kind))
            .map((o) => {
              const a = ground(c.id, m.t0);
              const b = ground(o.id, m.t0);
              return { id: o.id, d: Math.hypot(a.x - b.x, a.z - b.z) };
            })
            .sort((a, b) => a.d - b.d)[0]?.id;
        if (target) events.push({ t: m.t1, mount: target });
      } else if (m.move.action === "dismount") {
        events.push({ t: m.t0, off: true });
      }
    }
    events.sort((a, b) => a.t - b.t);
    let open: RidingInterval | null = null;
    for (const e of events) {
      if (open) {
        open.to = e.t;
        push(c.id, open);
        open = null;
      }
      if (e.mount) open = { mount: e.mount, from: e.t, to: duration + 1 };
    }
    if (open) push(c.id, open);
  }

  // Board time for an inferred pair: the jump / leap / mount beside the mount
  // closest to when it sets off, else the moment it sets off (0 if from the start).
  const boardTime = (rider: string, mount: string): number | null => {
    const sets = firstTravel(movesBy.get(mount) ?? [], (tt) =>
      ground(mount, tt),
    );
    if (sets === null) return null;
    const hops = (movesBy.get(rider) ?? []).filter((m) => {
      if (!BOARDING.has(m.move.action) || m.t1 > sets + 1.5) return false;
      const a = ground(rider, m.t0);
      const b = ground(mount, m.t0);
      return Math.hypot(a.x - b.x, a.z - b.z) < 3.5;
    });
    const hop = hops.sort(
      (a, b) => Math.abs(a.t1 - sets) - Math.abs(b.t1 - sets),
    )[0];
    if (hop) return hop.t1;
    return sets < 0.5 ? 0 : sets;
  };

  // 3: the script says who rides what
  if (script) {
    try {
      const roles = buildCast(script);
      for (const r of roles) {
        if (!r.mountId || r.packIndex !== undefined) continue;
        const mountRole = roles.find((x) => x.id === r.mountId);
        if (!mountRole) continue;
        const rider = matchCast(plan, r, (c) => c.kind === "person");
        const mount = matchCast(plan, mountRole, (c) => RIDEABLE.has(c.kind));
        if (!rider || !mount || out.has(rider.id)) continue;
        const from = boardTime(rider.id, mount.id);
        if (from !== null)
          push(rider.id, { mount: mount.id, from, to: duration + 1 });
      }
    } catch {
      // Script roles are a safety net only.
    }
  }

  // 4: a person boards something that then leaves without them
  for (const c of plan.cast) {
    if (c.kind !== "person" || out.has(c.id)) continue;
    for (const m of movesBy.get(c.id) ?? []) {
      if (
        !BOARDING.has(m.move.action) ||
        m.move.action === "sit" ||
        m.move.action === "crouch"
      )
        continue;
      const a = ground(c.id, m.t1);
      const near = plan.cast.find((o) => {
        if (o.id === c.id || !RIDEABLE.has(o.kind)) return false;
        const b = ground(o.id, m.t1);
        if (Math.hypot(a.x - b.x, a.z - b.z) > 3) return false;
        // …and it travels well away afterwards while the person stays put
        const later = Math.min(duration, m.t1 + 3);
        const b2 = ground(o.id, later);
        const a2 = ground(c.id, later);
        return (
          Math.hypot(b2.x - b.x, b2.z - b.z) > 3 &&
          Math.hypot(a2.x - b2.x, a2.z - b2.z) > 3
        );
      });
      if (near) {
        push(c.id, { mount: near.id, from: m.t1, to: duration + 1 });
        break;
      }
    }
  }
  return out;
}

/** Height of the saddle / seat above a mount's base for its stand-in. */
export function seatHeight(
  kind: StagingCast["kind"],
  size: [number, number, number],
): number {
  if (kind === "vehicle") return 0.25;
  // hare stand-in: legs 0.36·h, body centre +0.22, body radius 0.36·w
  if (kind === "quadruped") return size[1] * 0.36 + 0.22 + size[0] * 0.36 * 0.3;
  return size[1] * 0.68;
}
