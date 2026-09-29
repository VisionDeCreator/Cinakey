/**
 * Shot-aware cameras with hold cuts + subject tracking.
 *
 * Each SHOT line is matched (most specific first) to a camera setup ported from
 * gen_chase.py. Travel is +x: side cameras sit on +z looking -z so the chase
 * reads left to right; front cameras sit ahead on +x looking back.
 *
 * Moving setups key the first and last frame of the shot (start key carries the
 * motion ease, last key is `hold`); static setups key one `hold` pose. A key's
 * ease governs the segment after it, so a `hold` is a hard cut.
 */

import type { ScriptShot } from "../../prompt-templates/schemas";
import type {
  BlockoutCameraKey,
  BlockoutCutMarker,
  BlockoutEase,
  Vec3,
} from "../types";
import type { CastRole } from "./cast";
import { mentionsRole, primaryRider } from "./cast";
import type { MotionContext, Pose } from "./castMotion";
import {
  makePoser,
  sampleMountAt,
  samplePursuerAt,
  sampleRiderAt,
} from "./castMotion";
import type { TravelPath } from "./path";
import { clamp, lerp, lensForShotType, r3 } from "./util";

/** Minimal live-shot link for attaching cut markers to Convex shot ids. */
export type DirectorShotLink = {
  id: string;
  n?: number;
  sceneHeading?: string;
};

type CamPose = { pos: Vec3; target: Vec3 };

type Setup = {
  /** Camera pose at time t (seconds). */
  at: (t: number) => CamPose;
  focal: number;
  /** Ease on the start key of a moving shot. */
  ease?: BlockoutEase;
  /** Static shot: one hold key evaluated at this time. */
  staticAt?: number;
};

function fr(t: number, fps: number) {
  return Math.round(t * fps);
}

const add = (p: Pose, dx: number, dy: number, dz: number): Vec3 => [
  p.x + dx,
  p.y + dy,
  p.z + dz,
];

/**
 * The cast member a SHOT line is about: whoever is named first (by name,
 * @image_N, "herd" for the hunted animal, or he/she for the rider).
 */
export function resolveSubject(
  shot: ScriptShot,
  cast: CastRole[],
): CastRole | undefined {
  const text = `${shot.shotType} ${shot.action}`.toLowerCase();
  const rider = primaryRider(cast);
  let best: { i: number; role: CastRole } | undefined;
  const consider = (i: number, role: CastRole | undefined) => {
    if (i >= 0 && role && (!best || i < best.i)) best = { i, role };
  };
  for (const role of cast) {
    if (role.herdIndex || role.packIndex !== undefined) continue;
    const probe: ScriptShot = { ...shot, shotType: "", action: text };
    if (!mentionsRole(probe, role)) continue;
    const word = role.name.toLowerCase();
    const at = [
      text.search(new RegExp(`\\b${word}\\b`)),
      role.imageN !== undefined ? text.indexOf(`@image_${role.imageN}`) : -1,
    ].filter((i) => i >= 0);
    // A named weapon means whoever holds it.
    consider(Math.min(...at), role.role === "weapon" ? rider : role);
  }
  consider(text.search(/\b(he|she|him|her|his|they)\b/), rider);
  consider(
    text.search(/\bherd\b/),
    cast.find((r) => r.role === "prey" && r.target),
  );
  return best?.role;
}

function chooseSetup(
  shot: ScriptShot,
  ctx: MotionContext,
  path: TravelPath,
  cast: CastRole[],
): Setup {
  const text =
    `${shot.shotType} ${shot.cameraMove ?? ""} ${shot.action}`.toLowerCase();
  const kind = shot.shotType.toLowerCase();
  const { beats, pz, edge, farY, gc } = path;
  const [fx, fz] = ctx.fire;
  const hasRider = Boolean(primaryRider(cast));
  const hasPack = cast.some((r) => r.packIndex !== undefined);
  const early = shot.startSec < ctx.mountAppear + 0.5;
  const u = (t: number) =>
    clamp(
      (t - shot.startSec) / Math.max(0.1, shot.endSec - shot.startSec),
      0,
      1,
    );

  const H = (t: number) => sampleMountAt(ctx, t);
  // Rider base pose (feet on the mount); falls back to the mount.
  const G = (t: number): Pose => (hasRider ? sampleRiderAt(ctx, t) : H(t));
  const R = (pack: number, t: number) => samplePursuerAt(ctx, pack, t);
  const riderWords =
    /\bshe\b|\bhe\b|\bher\b|\bhis\b|\bgirl\b|\bboy\b|\brider\b/.test(text);
  const packWords = /\braptors?\b|\bbandits?\b|\bpursuers?\b|\briders\b/.test(
    text,
  );

  // Who the shot is about, and an animal to frame when it is not the rider.
  const poseOf = makePoser(cast, ctx);
  const subject = resolveSubject(shot, cast);
  const S = (t: number): Pose => (subject ? poseOf(subject, t) : H(t));
  const animalSubject =
    subject && (subject.role === "prey" || subject.role === "incidental")
      ? subject
      : undefined;
  const A = (t: number): Pose =>
    animalSubject ? poseOf(animalSubject, t) : H(t);
  const scale = animalSubject ? animalSubject.size[1] / 2.7 : 1;
  const prey = cast.find((r) => r.role === "prey" && r.target);
  const isRider = subject !== undefined && subject === primaryRider(cast);
  const close = /\bclose|\becu\b|\bextreme\s+close/.test(kind);

  // Only a cut to black (no other action): look into the sky.
  if (
    /\bcut\s+to\s+black\b/.test(text) &&
    !/close|medium|wide|looks?|rides?|\bshe\b|\bhe\b/.test(text)
  ) {
    return {
      at: (t) => {
        const m = H(t);
        return { pos: [m.x, 80, m.z], target: [m.x, 90, m.z] };
      },
      focal: 35,
      staticAt: shot.startSec,
    };
  }

  // 1 Slow push-in on the campfire
  if (
    /\bcampfire\b|\bfire\s+cone\b|\bsparks\b|\bparticles\b/.test(text) &&
    !/\bhand\b|\bgold\b/.test(text) &&
    early
  ) {
    return {
      at: (t) => ({
        pos: [
          lerp(fx + 1.45, fx + 1.0, u(t)),
          lerp(0.62, 0.55, u(t)),
          lerp(fz - 1.35, fz - 0.92, u(t)),
        ],
        target: [fx, 0.38, fz],
      }),
      focal: 50,
      ease: "inOut",
    };
  }

  // 2 Over the fire: the stranger's hand with the gold
  if (
    /\bhand\b|\bgold\b|\bpouch\b/.test(text) &&
    !/\btakes\b|\bplaces\b|\bsatchel\b/.test(text) &&
    early
  ) {
    return {
      at: () => ({ pos: [-1.2, 1.3, 1.25], target: [-2.9, 1.0, 3.2] }),
      focal: 40,
      staticAt: shot.startSec,
    };
  }

  // 3 Rider takes the gold / stows it in the satchel
  if (/\btakes\b|\bplaces\b|\bsatchel\b/.test(text) && early) {
    const t0 = Math.min(shot.endSec, ctx.mountAppear - 0.45);
    return {
      at: () => {
        const g = G(t0);
        return {
          pos: add(g, 1.67, 1.55, 2.13),
          target: add(g, 0.02, 1.1, 0.03),
        };
      },
      focal: 28,
      staticAt: shot.startSec,
    };
  }

  // 4 Wide: mounts and rides away
  if (
    /\bmounts?\b|\brides?\s+away\b/.test(text) &&
    shot.startSec < ctx.mountAppear + 2
  ) {
    return {
      at: (t) => ({
        pos: [-8.5, 2.4, 5.6],
        target: [lerp(1.0, 9.0, u(t)), 1.25, 0.3],
      }),
      focal: 24,
      ease: "inOut",
    };
  }

  // 11 Top-down between the mount and the rear of the pack
  if (
    /\baerial\b|\btop-?down\b|\bdrone\b|\bbird.?s?.?eye\b|\boverhead\b/.test(
      text,
    )
  ) {
    return {
      at: (t) => {
        const h = H(t);
        const r = hasPack ? R(3, t) : prey ? poseOf(prey, t) : h;
        const mx = (h.x + r.x) / 2;
        const mz = (h.z + r.z) / 2;
        return { pos: [mx, 48, mz], target: [mx, 0, mz - 0.6] };
      },
      focal: 35,
    };
  }

  // POV forward: through a scope / at what the rider is chasing
  if (
    /\bpov\b|\bpoint\s+of\s+view\b/.test(text) &&
    !/\bbehind\b|\bback\b/.test(text)
  ) {
    const scope = /\bscope|\bbinocular|\bsights?\b|\bcrosshair/.test(text);
    return {
      at: (t) => {
        const g = G(t);
        const aim = prey
          ? poseOf(prey, t)
          : { x: g.x + 25, y: 0, z: pz(g.x + 25), rot: 0 };
        return {
          pos: add(g, 0.3, 1.5, 0),
          target: [aim.x, aim.y + 1.1, aim.z],
        };
      },
      focal: scope ? 135 : 35,
    };
  }

  // 8 Rider POV back into the trees
  if (/\bpov\b|\bpoint\s+of\s+view\b/.test(text)) {
    return {
      at: (t) => {
        const g = G(t);
        return {
          pos: add(g, -0.45, 1.45, 0.15),
          target: [g.x - 20, g.y + 0.6, pz(g.x - 20) - 3.5],
        };
      },
      focal: 28,
    };
  }

  // 9 Low wide: the pack bursts out of the trees
  if (
    hasPack &&
    packWords &&
    /\bburst|\bemerge|\bexplode|\bappear/.test(text)
  ) {
    return {
      at: () => {
        const r = R(0, shot.startSec + 0.6);
        return {
          pos: [r.x + 9, 0.45, pz(r.x) + 5.5],
          target: [r.x - 1, 1.3, pz(r.x) - 1],
        };
      },
      focal: 24,
      staticAt: shot.startSec,
    };
  }

  // 18 Low: branch falls, lead pursuer stumbles
  if (/\bbranch\b/.test(text)) {
    return {
      at: () => {
        const b = R(0, ctx.branchSec + 0.15);
        return {
          pos: [b.x + 4.5, 0.4, b.z + 5.5],
          target: [b.x - 0.5, 0.8, b.z],
        };
      },
      focal: 24,
      staticAt: shot.startSec,
    };
  }

  // 12 Low tracking on the pack
  if (
    hasPack &&
    packWords &&
    /\btrack|\balongside\b/.test(text) &&
    !/\bshe\b|\bhe\b|\bgirl\b|\bboy\b/.test(text)
  ) {
    return {
      at: (t) => {
        const r = R(0, t);
        return { pos: [r.x + 1.5, 0.5, r.z + 7], target: [r.x - 2, 1.9, r.z] };
      },
      focal: 35,
    };
  }

  // 14/15 Close-up: a pursuer draws level on the rider's left / right
  const side = /\bon\s+(her|his|their)\s+(left|right)\b/.exec(text);
  if (side) {
    const s = side[2] === "left" ? 1 : -1;
    return {
      at: (t) => {
        const g = G(t);
        return {
          pos: add(g, 4.8, 1.4, 1.2 * s),
          target: add(g, 0, 0.9, -1.1 * s),
        };
      },
      focal: 35,
    };
  }

  // 16 Front: the mount threads two trunks toward camera
  if (
    /\bfront\b|\bhead.?on\b|\bcomes?\s+toward|\bbetween\s+(two\s+)?trunks\b/.test(
      text,
    )
  ) {
    const threads = /\bbetween\s+(two\s+)?trunks\b|\bcuts?\s+between\b/.test(
      text,
    );
    if (threads) {
      return {
        at: () => {
          const tx = path.X(beats.threadSec);
          const tz = pz(tx) + 1.0;
          return { pos: [tx + 8, 1.5, tz], target: [tx - 8, 1.3, tz] };
        },
        focal: 28,
        staticAt: shot.startSec,
      };
    }
    // Ahead of the subject looking back at it (closer on a person).
    const d = isRider || close ? 4 : 8;
    return {
      at: (t) => {
        const p = S(t);
        return {
          pos: [p.x + d, p.y + (isRider ? 1.5 : 1.4), p.z + 0.3],
          target: [p.x, p.y + (isRider ? 1.35 : 1.0), p.z],
        };
      },
      focal: isRider ? 50 : 28,
    };
  }

  // Medium on an animal (e.g. the herd)
  if (/\bmedium\b/.test(kind) && animalSubject) {
    return {
      at: (t) => {
        const a = A(t);
        return {
          pos: add(a, 0.8, 1.4 * scale, 5.5),
          target: add(a, 0, 1.1 * scale, 0),
        };
      },
      focal: 35,
    };
  }

  // 17 Medium: rider twists in the saddle / fires back
  if (
    /\btwists?\b|\bfires?\s+back\b/.test(text) ||
    (/\bmedium\b/.test(kind) && riderWords)
  ) {
    return {
      at: (t) => {
        const g = G(t);
        return { pos: add(g, 0.3, 1.3, 5.2), target: add(g, -0.6, 1.1, 0) };
      },
      focal: 35,
    };
  }

  // 19 Rider turns forward to the light ahead (over the shoulder, forward)
  if (/\bturns?\s+forward\b|\blooks?\s+ahead\b|\blight\s+ahead\b/.test(text)) {
    return {
      at: (t) => {
        const g = G(t);
        return {
          pos: add(g, -2.0, 1.75, 0.8),
          target: [g.x + 12, g.y + 0.9, pz(g.x + 12)],
        };
      },
      focal: 35,
    };
  }

  // 21 Close-up on the mount's hind leg compressing
  if (/\bhind\s+legs?\b|\bcompress/.test(text)) {
    return {
      at: (t) => {
        const h = H(t);
        return {
          pos: [h.x - 1.6, 0.45, h.z + 2.3],
          target: [h.x - 0.55, 0.45, h.z],
        };
      },
      focal: 50,
    };
  }

  // From behind the subject; a walk away from camera is a locked-off shot.
  if (/\brear\b|\bfrom\s+behind\b/.test(text)) {
    if (
      /\bwalks?\b.*\baway\b|\baway\s+from\s+the\s+camera\b|\bgrow\s+smaller\b|\binto\s+the\s+distance\b/.test(
        text,
      )
    ) {
      return {
        at: () => {
          const p = S(shot.startSec);
          return {
            pos: [p.x - 4, 0.5, p.z + 0.6],
            target: [p.x + 6, 1.4, p.z],
          };
        },
        focal: 35,
        staticAt: shot.startSec,
      };
    }
    const low = /\blow\b/.test(text);
    return {
      at: (t) => {
        const p = S(t);
        return low
          ? { pos: add(p, -3.2, 0.6, 0.8), target: add(p, 2.5, 0.5, 0) }
          : { pos: add(p, -6, 2.0, 0.8), target: add(p, 8, 1.0, 0) };
      },
      focal: low ? 35 : 28,
    };
  }

  // Low at the river bank, looking across as the subject jumps it
  if (
    beats.wantsCliff &&
    beats.gapKind === "river" &&
    /\briver'?s?\s+edge\b|\briverbank\b|\bbank\b/.test(text)
  ) {
    return {
      at: () => ({
        pos: [edge - 1.5, 0.35, pz(edge) + 7],
        target: [gc, 1.2, pz(gc)],
      }),
      focal: 24,
      staticAt: shot.startSec,
    };
  }

  // 22 Wide side, slow motion: the leap against the moon (slow push-in)
  if (
    beats.wantsCliff &&
    beats.gapKind === "chasm" &&
    /\bleaps?\b|\bairborne\b|\bslow\s+motion\b/.test(text)
  ) {
    const m = H((beats.leapStart + beats.landSec) / 2);
    const moon: Vec3 = [gc + 45, 14, -50];
    const P: Vec3 = [m.x, m.y + 0.8, m.z];
    const C: Vec3 = [0, 1, 2].map(
      (i) => P[i]! + (P[i]! - moon[i]!) * 0.35,
    ) as Vec3;
    const T: Vec3 = [P[0], P[1] - 0.6, P[2]];
    const C2: Vec3 = [0, 1, 2].map(
      (i) => C[i]! + (T[i]! - C[i]!) * 0.08,
    ) as Vec3;
    return {
      at: (t) => ({
        pos: [0, 1, 2].map((i) => lerp(C[i]!, C2[i]!, u(t))) as Vec3,
        target: T,
      }),
      focal: 28,
      ease: "inOut",
    };
  }

  // 23 Low on the far side: the mount lands
  if (
    beats.wantsCliff &&
    beats.gapKind === "chasm" &&
    /\blands?\b/.test(text)
  ) {
    return {
      at: () => {
        const l = H(beats.landSec);
        return {
          pos: [l.x + 9.5, farY + 0.35, l.z + 4.5],
          target: [l.x + 1.0, farY + 0.8, l.z],
        };
      },
      focal: 24,
      staticAt: shot.startSec,
    };
  }

  // 24 Wide looking back: pursuers pace at the edge
  if (
    beats.wantsCliff &&
    /\blooking\s+back\b|\bpaces?\b|\bhat\b/.test(text) &&
    !/\bshe\b|\bhe\b/.test(text)
  ) {
    return {
      at: () => ({ pos: [edge + 26, 3.2, 7.0], target: [edge - 1, 1.0, 0.0] }),
      focal: 35,
      staticAt: shot.startSec,
    };
  }

  // 20 Wide: the trees end at the cliff, the gap and the moon
  if (
    beats.wantsCliff &&
    !/\briver\b/.test(text) &&
    /\bcliff\b|\bgap\b|\bchasm\b|\btrees\s+end\b|\bedge\b/.test(text)
  ) {
    return {
      at: (t) => {
        const h = H(t);
        return { pos: [h.x - 7, 4.5, h.z + 3.5], target: [edge + 12, 2.5, -6] };
      },
      focal: 24,
    };
  }

  // 25 Close-up: rider glances back, then rides off (camera behind)
  if (/\brides?\s+off\b|\blooks?\s+back\b.*\bthen\b/.test(text)) {
    return {
      at: () => {
        const g = G(shot.startSec);
        return { pos: add(g, -2.6, 1.55, 1.9), target: add(g, 0, 1.35, 0) };
      },
      focal: 50,
      staticAt: shot.startSec,
    };
  }

  // 6 Close-up on the mount's head / ears
  if (/(hare|mount|cheetah|horse)'?s?\s+head\b|\bears\b/.test(text)) {
    return {
      at: (t) => {
        if (animalSubject) {
          const a = A(t);
          return {
            pos: add(a, 2.6 * scale, 2.35 * scale, 2.4 * scale),
            target: add(a, 0.75 * scale, 2.25 * scale, 0),
          };
        }
        const h = H(t);
        return {
          pos: [h.x + 2.6, 2.35, h.z + 2.4],
          target: [h.x + 0.75, 2.25, h.z],
        };
      },
      focal: 50,
    };
  }

  // Slow push-in toward the rider's face
  if (
    /\bpush-?\s?in\b/.test(text) &&
    (isRider || /\bface\b/.test(text)) &&
    hasRider
  ) {
    return {
      at: (t) => {
        const g = G(t);
        return {
          pos: add(g, 0.2, 1.5, lerp(6, 2.6, u(t))),
          target: add(g, 0, 1.4, 0),
        };
      },
      focal: 50,
      ease: "inOut",
    };
  }

  // 13 Side: the chase passes left to right (wide side track)
  if (
    /^side\b/.test(kind) ||
    (/\bside\s+(shot|view|angle)\b/.test(text) && !/\blow\b/.test(text))
  ) {
    return {
      at: (t) => {
        const h = A(t);
        return {
          pos: [h.x - 2.5, 1.9, h.z + 9],
          target: [h.x - 3.2, 1.8, h.z],
        };
      },
      focal: 28,
    };
  }

  // 5 Low tracking alongside the mount
  if (/\blow\s+track|\balongside\b|\btracking\b|\bgaining\b/.test(text)) {
    return {
      at: (t) => {
        const h = A(t);
        return {
          pos: [h.x - 1.2, 0.55, h.z + 6.5],
          target: [h.x + 0.8, 1.2, h.z],
        };
      },
      focal: 35,
    };
  }

  // Close-up at an animal's hooves / paws / feet
  if (
    close &&
    /\bhoo(f|ves)\b|\bpaws?\b|\bclaws?\b|\bfeet\b|\blegs?\b/.test(text)
  ) {
    return {
      at: (t) => {
        const a = A(t);
        return { pos: add(a, 1.8, 0.35, 1.6), target: add(a, 0, 0.35, 0) };
      },
      focal: 50,
    };
  }

  // Close-up on an animal (head height scales with the stand-in)
  if (close && animalSubject) {
    return {
      at: (t) => {
        const a = A(t);
        return {
          pos: add(a, 2.4 * scale, 1.9 * scale, 1.8 * scale),
          target: add(a, 0.6 * scale, 1.7 * scale, 0),
        };
      },
      focal: 50,
    };
  }

  // 7/10 Close-up on the rider
  if (/\bclose-?up\b|\becu\b|\bcu\b/.test(text) && (riderWords || hasRider)) {
    const wider = /\bleans?\s+in\b|\bsprint\b|\bfull\s+speed\b/.test(text);
    return {
      at: (t) => {
        const g = G(t);
        return wider
          ? { pos: add(g, 4.2, 1.5, 0.9), target: add(g, 0, 1.25, 0) }
          : { pos: add(g, 2.6, 1.55, 1.6), target: add(g, 0, 1.4, 0) };
      },
      focal: 50,
    };
  }

  // Close-up on the mount / any subject
  if (/\bclose-?up\b|\becu\b|\bclose\b/.test(text)) {
    return {
      at: (t) => {
        const h = H(t);
        return {
          pos: [h.x + 2.6, h.y + 1.35, h.z + 1.6],
          target: [h.x, h.y + 1.2, h.z],
        };
      },
      focal: 50,
    };
  }

  // Low angle on the subject: a locked-off camera it runs past, or low beside it.
  if (/\blow\b/.test(text) && !/\btrack/.test(text)) {
    const moving =
      Math.abs(S(shot.startSec + 0.3).x - S(shot.startSec).x) > 0.5;
    const wide = /\bwide\b/.test(text);
    if (moving || /\bpast\s+the\s+camera\b/.test(text)) {
      return {
        at: () => {
          const p = S(shot.startSec);
          return { pos: [p.x + 7, 0.3, p.z + 3], target: [p.x, 0.9, p.z] };
        },
        focal: 24,
        staticAt: shot.startSec,
      };
    }
    return {
      at: (t) => {
        const p = S(t);
        return wide
          ? { pos: add(p, -5, 0.4, 9), target: add(p, 4, 1.0, 0) }
          : { pos: add(p, -1.8, 0.35, 3.6), target: add(p, 0.6, 0.6, 0) };
      },
      focal: wide ? 24 : 35,
    };
  }

  // Wide on the moving subject
  if (/\bwide\b|\bews\b|\bestablish/.test(text)) {
    return {
      at: (t) => {
        const h = A(t);
        return { pos: [h.x - 6, 3.5, h.z + 8], target: [h.x + 4, 1.2, h.z] };
      },
      focal: lensForShotType(shot.shotType),
    };
  }

  // Default: side track on +z (left-to-right chase)
  return {
    at: (t) => {
      const h = H(t);
      return { pos: [h.x - 2.5, 1.9, h.z + 9], target: [h.x - 1, 1.5, h.z] };
    },
    focal: lensForShotType(shot.shotType),
  };
}

export function buildCameraKeys(
  shots: ScriptShot[],
  path: TravelPath,
  cast: CastRole[],
  ctx: MotionContext,
  liveShots: DirectorShotLink[] | undefined,
  fps: number,
): { cameraKeys: BlockoutCameraKey[]; cuts: BlockoutCutMarker[] } {
  const cameraKeys: BlockoutCameraKey[] = [];
  const cuts: BlockoutCutMarker[] = [];
  const byN = new Map((liveShots ?? []).map((s) => [s.n ?? 0, s] as const));
  let keyN = 0;
  const key = (f: number, p: CamPose, focal: number, ease: BlockoutEase) =>
    cameraKeys.push({
      id: `k${++keyN}`,
      f,
      pos: p.pos.map(r3) as Vec3,
      target: p.target.map(r3) as Vec3,
      focal,
      roll: 0,
      ease,
    });

  const sorted = [...shots].sort((a, b) => a.startSec - b.startSec);
  for (const shot of sorted) {
    const live = byN.get(shot.n);
    const startF = fr(shot.startSec, fps);
    const endF = Math.max(startF + 1, fr(shot.endSec, fps));
    const lastF = endF - 1;
    const setup = chooseSetup(shot, ctx, path, cast);

    if (setup.staticAt !== undefined || lastF <= startF) {
      key(
        startF,
        setup.at(setup.staticAt ?? shot.startSec),
        setup.focal,
        "hold",
      );
    } else {
      key(startF, setup.at(startF / fps), setup.focal, setup.ease ?? "linear");
      key(lastF, setup.at(lastF / fps), setup.focal, "hold");
    }

    cuts.push({
      n: shot.n,
      start: startF,
      end: endF,
      desc: shot.action,
      shotType: shot.shotType,
      shotId: live?.id,
      sceneHeading: live?.sceneHeading,
      cameraMove: shot.cameraMove,
      lensMm: setup.focal,
    });
  }

  return { cameraKeys, cuts };
}
