/**
 * Speed-integrated travel along +X with winding path centreline.
 * Ported from gen_chase.py; beats come from SHOT timings when present.
 */

import type { ScriptShot } from "../../prompt-templates/schemas";
import { clamp, lerp } from "./util";

export type GapKind = "chasm" | "river";

export type ChaseBeats = {
  /** Idle until mount / ride-away. */
  lopeStart: number;
  /** Reach lope speed. */
  lopeFull: number;
  /** Begin sprint ramp. */
  sprintStart: number;
  /** Full sprint. */
  sprintFull: number;
  /** Takeoff / leap start. */
  leapStart: number;
  /** Landing. */
  landSec: number;
  /** Come to a stop (only when `hasStop`). */
  stopSec: number;
  hasStop: boolean;
  /** Optional exit ride after a stop. */
  exitStart: number;
  /** Slow from sprint to a walk over [slowStart, walkStart] (when `walkStart` set). */
  slowStart: number;
  walkStart: number | null;
  /** Mount threads between two trunks (sideways jog peak). */
  threadSec: number;
  duration: number;
  /** The mount leaps a gap (chasm or river). */
  wantsCliff: boolean;
  gapKind: GapKind;
};

export type TravelPath = {
  beats: ChaseBeats;
  gap: number;
  farY: number;
  /** Apex of the mount's leap above the take-off edge (m). */
  leapHeight: number;
  edge: number;
  far: number;
  gc: number;
  speed: (t: number) => number;
  X: (t: number) => number;
  pz: (x: number) => number;
};

function shotText(s: ScriptShot) {
  return `${s.shotType} ${s.cameraMove ?? ""} ${s.action}`.toLowerCase();
}

/** Leap words, ignoring "leaps into the saddle" (that's mounting). */
function leapText(s: ScriptShot) {
  return shotText(s).replace(
    /\b(leaps?|jumps?|springs?)\s+(up\s+)?into\s+the\s+saddle\b/g,
    "mounts",
  );
}

const LEAP_RE =
  /\bleaps?\b|\bjumps?\s+(across|over)|\btakes?\s+off|\bairborne|\bacross\s+the\s+(gap|chasm)\b/;

/**
 * Detect chase timing beats from SHOT lines (falls back to SEQ01-like defaults).
 * Beats are ordered around the mount: launch → sprint → leap → land → stop/walk.
 * `mountName` (e.g. "cheetah") picks the mount's leap over another animal's.
 */
export function detectChaseBeats(
  shots: ScriptShot[],
  totalSec: number,
  locationBlurb: string,
  mountName?: string,
): ChaseBeats {
  const sorted = [...shots].sort((a, b) => a.startSec - b.startSec);
  const duration = Math.max(totalSec, sorted[sorted.length - 1]?.endSec ?? 6);
  const loc = locationBlurb.toLowerCase();
  const corpus = sorted.map(shotText).join(" ") + " " + loc;

  const find = (re: RegExp, after = -1, text = shotText) =>
    sorted.find((s) => s.startSec >= after && re.test(text(s)));
  const span = (s: ScriptShot) => s.endSec - s.startSec;

  const mount =
    find(
      /\bmounts?\b|\binto\s+the\s+saddle\b|\brides?\s+away|\bsets?\s+off|\blaunch(es)?\b|\bgallop|\blopes?\b|\bbounds?\b/,
      -1,
      leapText,
    ) ?? find(/\bhare\b.*\b(away|into|trees)\b/);
  const after = mount?.startSec ?? -1;
  const sprint = find(
    /\bsprint|\bfull\s+speed|\bexplodes?\s+into|\bleans?\s+in\b/,
    after,
  );

  // The mount's leap: prefer a leap shot that names the mount.
  const leaps = sorted.filter(
    (s) => s.startSec >= after && LEAP_RE.test(leapText(s)),
  );
  const mountRe = mountName
    ? new RegExp(`\\b${mountName.toLowerCase()}`)
    : null;
  const leap =
    (mountRe && leaps.find((s) => mountRe.test(shotText(s)))) ?? leaps[0];
  const wantsCliff = Boolean(leap) || /\bchasm\b/.test(corpus);
  const gapKind: GapKind =
    (leap && /\briver|\bstream|\bcreek|\bwater\b/.test(shotText(leap))) ||
    (!leap && /\briver\b/.test(loc) && !/\bchasm\b/.test(corpus))
      ? "river"
      : "chasm";

  // SEQ01-class defaults when script is chase-like but beats are sparse
  const isChase =
    wantsCliff ||
    /\bchase|pursu|bandit|raptor|sprint|leap\b/i.test(corpus) ||
    Boolean(mount && sprint);

  // gen_chase: the rider climbs on during the first 0.4 s of the mount shot,
  // the sprint ramp starts 0.2 s into its shot and lasts 1 s, and a
  // "…, then rides off" exit starts a third of the way into its shot.
  const lopeStart = mount
    ? mount.startSec +
      (/\bmounts?\b/.test(leapText(mount))
        ? Math.min(0.4, span(mount) * 0.3)
        : 0)
    : isChase
      ? Math.min(4.4, duration * 0.15)
      : 0;
  let lopeFull = lopeStart + (mount ? Math.min(1.0, span(mount)) : 1);
  let sprintStart = sprint
    ? sprint.startSec + Math.min(0.2, span(sprint) * 0.2)
    : isChase
      ? Math.min(11.2, duration * 0.37)
      : lopeFull + 2;
  let sprintFull = sprint
    ? Math.min(sprintStart + 1, sprint.endSec + 0.2)
    : sprintStart + 1;

  // Leap and land: separate shots, or both inside one shot ("leaps … lands").
  let leapStart: number;
  let landSec: number;
  if (leap && /\blands?\b/.test(shotText(leap))) {
    leapStart = leap.startSec + span(leap) * 0.25;
    landSec = leapStart + Math.min(1.0, span(leap) * 0.6);
  } else {
    leapStart =
      leap?.startSec ??
      (wantsCliff ? Math.min(24, duration * 0.8) : duration + 10);
    const land = find(
      /\blands?\b|\bfar\s+side|\bfar\s+platform\b|\bfar\s+bank\b/,
      leapStart,
    );
    landSec = land?.startSec ?? leapStart + 2;
  }

  const settle = wantsCliff ? landSec : sprintFull;
  const stop = find(
    /\bpaces?\b|\bstops?\b|\bskids?\b|\bthrown\b|\bhat\b|\bhalts?\b/,
    settle,
  );
  const walk = find(/\bwalks?\b|\bstrolls?\b|\bambles?\b|\btrots?\b/, settle);
  const hasStop = Boolean(stop) || (wantsCliff && gapKind === "chasm" && !walk);
  let stopSec = stop?.startSec ?? landSec + 1;
  const exit = find(/\brides?\s+off\b|\bcut\s+to\s+black\b/, stopSec);
  let exitStart = exit
    ? exit.startSec + (/\bthen\b/.test(shotText(exit)) ? span(exit) / 3 : 0)
    : Math.max(stopSec + 1.5, duration - 1.2);
  const walkStart = !hasStop && walk ? walk.startSec : null;
  const slowStart =
    walkStart !== null ? Math.max(settle, walkStart - 1) : duration;

  // Keep ordering sane
  lopeFull = Math.max(lopeFull, lopeStart + 0.3);
  sprintStart = Math.max(sprintStart, lopeFull + 0.5);
  sprintFull = Math.max(sprintFull, sprintStart + 0.3);
  if (wantsCliff) {
    leapStart = Math.max(
      leapStart,
      sprintFull + (gapKind === "chasm" ? 2 : 0.5),
    );
    landSec = Math.max(landSec, leapStart + (gapKind === "chasm" ? 1.2 : 0.5));
    stopSec = Math.max(stopSec, landSec + 0.5);
    exitStart = Math.max(exitStart, stopSec + 0.8);
  }
  const thread = find(/\bbetween\s+(two\s+)?trunks|\bcuts?\s+between\b/);
  const threadSec = thread
    ? thread.startSec + Math.min(0.4, span(thread) * 0.4)
    : (sprintFull + leapStart) / 2 - 0.1;

  return {
    lopeStart,
    lopeFull,
    sprintStart,
    sprintFull,
    leapStart,
    landSec,
    stopSec,
    hasStop,
    exitStart,
    slowStart,
    walkStart,
    threadSec,
    duration,
    wantsCliff,
    gapKind,
  };
}

const LOPE_SPEED = 6;
const SPRINT_SPEED = 12;
const AIR_SPEED = 9;
const EXIT_SPEED = 7;
const WALK_SPEED = 1.6;

/**
 * Build speed(t) + integrated X(t) + winding pz — gen_chase core.
 */
export function buildTravelPath(beats: ChaseBeats): TravelPath {
  const {
    lopeStart,
    lopeFull,
    sprintStart,
    sprintFull,
    leapStart,
    landSec,
    stopSec,
    hasStop,
    exitStart,
    slowStart,
    walkStart,
    duration,
    wantsCliff,
    gapKind,
  } = beats;

  const speed = (t: number): number => {
    if (t < lopeStart) return 0;
    if (t < lopeFull)
      return lerp(
        0,
        LOPE_SPEED,
        (t - lopeStart) / Math.max(0.01, lopeFull - lopeStart),
      );
    if (t < sprintStart) return LOPE_SPEED;
    if (t < sprintFull) {
      return lerp(
        LOPE_SPEED,
        SPRINT_SPEED,
        (t - sprintStart) / Math.max(0.01, sprintFull - sprintStart),
      );
    }
    if (wantsCliff && t >= leapStart && t < landSec) return AIR_SPEED;
    if (wantsCliff && t < leapStart) return SPRINT_SPEED;

    // After landing (or after the sprint when there is no gap)
    if (hasStop) {
      const from = wantsCliff ? landSec : stopSec - 1;
      const v0 = wantsCliff ? AIR_SPEED : SPRINT_SPEED;
      if (t < from) return SPRINT_SPEED;
      if (t < stopSec)
        return lerp(v0, 0, (t - from) / Math.max(0.01, stopSec - from));
      if (t < exitStart) return 0;
      return lerp(
        0,
        EXIT_SPEED,
        (t - exitStart) / Math.max(0.01, duration - exitStart),
      );
    }
    if (walkStart !== null) {
      if (t < slowStart) return SPRINT_SPEED;
      if (t < walkStart) {
        return lerp(
          SPRINT_SPEED,
          WALK_SPEED,
          (t - slowStart) / Math.max(0.01, walkStart - slowStart),
        );
      }
      return WALK_SPEED;
    }
    return SPRINT_SPEED;
  };

  const DT = 1 / 480;
  const xs: number[] = [0];
  const steps = Math.ceil(duration / DT) + 2;
  for (let i = 0; i < steps; i++) {
    xs.push(xs[xs.length - 1]! + speed(i * DT) * DT);
  }

  const X = (t: number): number => {
    const i = clamp(t / DT, 0, xs.length - 2);
    const j = Math.floor(i);
    return lerp(xs[j]!, xs[j + 1]!, i - j);
  };

  const edge = wantsCliff ? X(leapStart) : X(duration) + 40;
  // A chasm is wide and drops away; a river is as wide as the jump carries.
  const airDist = wantsCliff ? X(landSec) - edge : 0;
  const gap = !wantsCliff
    ? 0
    : gapKind === "chasm"
      ? 15
      : clamp(airDist * 0.7, 4, 12);
  const farY = wantsCliff && gapKind === "chasm" ? -0.8 : 0;
  const leapHeight = gapKind === "chasm" ? 6.0 : 1.4 + airDist * 0.08;
  const far = edge + gap;
  const gc = edge + gap / 2;

  const pz = (x: number): number => {
    if (x < 10) return 0;
    const rampIn = clamp((x - 10) / 12, 0, 1);
    const rampOut = wantsCliff
      ? clamp((edge - 6 - x) / 22, 0, 1)
      : clamp((edge - x) / 30, 0, 1);
    return 2.2 * Math.sin((x - 10) / 16) * rampIn * rampOut;
  };

  return { beats, gap, farY, leapHeight, edge, far, gc, speed, X, pz };
}
