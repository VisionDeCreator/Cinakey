import type { ScriptShot } from "../../prompt-templates/schemas";
import { lerp } from "./math";

export function lookOffsetKeys(shots: ScriptShot[]): Array<[number, number]> {
  const keys: Array<[number, number]> = [[0, 0]];
  const sorted = [...shots].sort((a, b) => a.startSec - b.startSec);
  let cur = 0;
  let prevSide = false;
  const to = (t0: number, t1: number, v: number) => {
    keys.push([t0, cur], [t1, v]);
    cur = v;
  };
  sorted.forEach((s, i) => {
    const a = s.action.toLowerCase();
    const next = sorted[i + 1];
    const side =
      /\bon\s+(her|his|their)\s+(left|right)\b|\bturns?\s+(left|right)\b/.exec(
        a,
      );
    if (/\blooks?\s+back\b.*\bthen\b/.test(a)) {
      to(s.startSec, s.startSec + 0.35, 170);
      to(s.startSec + 0.7, s.startSec + 0.95, 0);
    } else if (/\btwists?\b.*\bback\b|\bfires?\s+back\b/.test(a)) {
      to(s.startSec + 0.05, s.startSec + 0.4, 180);
    } else if (
      /\blooks?\s+back\b|\bover\s+(her|his|their)\s+shoulder\b|\bturns?\s+back\b/.test(
        a,
      )
    ) {
      const holdEnd =
        next && /\bpov\b/.test(`${next.shotType} ${next.action}`.toLowerCase())
          ? next.endSec
          : s.endSec;
      to(s.startSec, s.startSec + 0.35, 150);
      to(holdEnd, holdEnd + 0.3, 0);
    } else if (side) {
      const v = (side[2] ?? side[3]) === "left" ? 90 : -90;
      const t0 = prevSide ? s.startSec - 0.05 : s.startSec + 0.05;
      to(t0, t0 + (prevSide ? 0.25 : 0.3), v);
      if (
        !next ||
        !/\bon\s+(her|his|their)\s+(left|right)\b|\bturns?\s+(left|right)\b/.test(
          next.action.toLowerCase(),
        )
      ) {
        to(s.endSec - 0.15, s.endSec + 0.05, 0);
      }
    } else if (
      /\bturns?\s+forward\b|\blooks?\s+ahead\b|\blight\s+ahead\b/.test(a) &&
      cur !== 0
    ) {
      to(s.startSec, s.startSec + 0.4, 0);
    }
    prevSide = Boolean(side);
  });
  if (cur !== 0) keys.push([1e8, cur]);
  keys.push([1e9, 0]);
  keys.sort((a, b) => a[0] - b[0]);
  return keys;
}

export function lookAt(keys: Array<[number, number]>, t: number): number {
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, va] = keys[i]!;
    const [b, vb] = keys[i + 1]!;
    if (a <= t && t <= b) {
      return b > a ? lerp(va, vb, (t - a) / (b - a)) : vb;
    }
  }
  return 0;
}
