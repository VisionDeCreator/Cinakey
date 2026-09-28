import { parseScriptPromptText } from "./parse";
import type { AssetSheetType } from "./schemas";

function hasSection(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

const DEFAULT_MAX_DURATION_SEC = 30;

/** Quiet one-line checks for script prompt text (Seedance template). */
export function validateScriptPromptText(
  text: string,
  opts?: { maxDurationSec?: number },
): { ok: boolean; warning?: string } {
  const maxDurationSec = opts?.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC;
  const upper = text.toUpperCase();
  const missing: string[] = [];
  if (!hasSection(upper, /\bREFERENCES\b/)) missing.push("REFERENCES");
  if (!hasSection(upper, /\bART STYLE\b/)) missing.push("ART STYLE");
  if (!hasSection(upper, /\bSHOTS\s*\(/)) missing.push("SHOTS");
  if (missing.length > 0) {
    return {
      ok: false,
      warning: `Missing sections: ${missing.join(", ")}`,
    };
  }

  let parsed;
  try {
    parsed = parseScriptPromptText(text);
  } catch {
    return { ok: false, warning: "Could not parse script prompt." };
  }

  const declared = new Set(parsed.references.map((r) => r.imageN));
  const imageRefs = [...text.matchAll(/@image_(\d+)/gi)].map((m) =>
    Number(m[1]),
  );
  const unknown = [...new Set(imageRefs)].filter((n) => !declared.has(n));
  if (unknown.length > 0) {
    return {
      ok: false,
      warning: `Unknown @image reference: ${unknown.map((n) => `@image_${n}`).join(", ")}`,
    };
  }

  const shots = parsed.shots;
  if (shots.length === 0) {
    return { ok: false, warning: "No timed shots found." };
  }

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]!;
    if (s.endSec <= s.startSec) {
      return {
        ok: false,
        warning: `Shot ${s.n} end time must be after start.`,
      };
    }
    if (i > 0) {
      const prev = shots[i - 1]!;
      if (Math.abs(s.startSec - prev.endSec) > 0.05) {
        return {
          ok: false,
          warning: `Shot times not contiguous (shot ${prev.n} ends ${prev.endSec}s, shot ${s.n} starts ${s.startSec}s).`,
        };
      }
    }
  }

  const lastEnd = shots[shots.length - 1]!.endSec;
  const total = Math.max(parsed.totalDurationSec, lastEnd);
  if (total > maxDurationSec + 0.05) {
    return {
      ok: false,
      warning: `Over ${maxDurationSec} seconds (${total}s). Split into parts.`,
    };
  }

  return { ok: true };
}


/** Lightweight checks that copilot-written asset prompt text includes key sections. */
export function validateAssetPromptText(
  type: AssetSheetType,
  text: string,
): { ok: boolean; warning?: string } {
  const upper = text.toUpperCase();
  const missing: string[] = [];

  if (!hasSection(upper, /\bART STYLE\b/)) {
    missing.push("ART STYLE");
  }
  if (!hasSection(upper, /\bCOLOR PALETTE\b/)) {
    missing.push("COLOR PALETTE");
  }

  switch (type) {
    case "character":
      if (!hasSection(upper, /\bFACE AND HAIR\b/)) {
        missing.push("FACE AND HAIR");
      }
      if (!hasSection(upper, /\bOUTFIT\b/)) {
        missing.push("OUTFIT");
      }
      break;
    case "creature":
      if (!hasSection(upper, /\bBODY\b/)) {
        missing.push("BODY");
      }
      break;
    case "environment":
      if (
        !hasSection(upper, /\bTHE LAND\b/) &&
        !hasSection(upper, /\bSKY AND LIGHT\b/)
      ) {
        missing.push("THE LAND or SKY AND LIGHT");
      }
      break;
    case "product":
      if (
        !hasSection(upper, /\bFEEL\b/) &&
        !hasSection(upper, /\bTHE OBJECT\b/) &&
        !hasSection(upper, /\bTHE [A-Z]/)
      ) {
        missing.push("FEEL or THE …");
      }
      break;
    default:
      break;
  }

  if (missing.length === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    warning: `Missing recommended sections: ${missing.join(", ")}`,
  };
}
