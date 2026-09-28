import type { AssetSheetType } from "./schemas";

function hasSection(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
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
