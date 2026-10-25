/**
 * Render structured prompt-sheet data to template text.
 */

import {
  PROMPT_TEMPLATE_VERSION,
  parseAssetSheet,
  renderCharacterSheet,
  renderCreatureSheet,
  renderEnvironmentSheet,
  renderProductSheet,
  type AssetSheetType,
} from "@cinakey/shared";

export { PROMPT_TEMPLATE_VERSION };

export function renderPromptSheetText(
  type: AssetSheetType,
  structured: unknown,
  artStyleBlock: string,
  opts?: { hasStyleReference?: boolean },
): string {
  switch (type) {
    case "character":
      return renderCharacterSheet(
        parseAssetSheet("character", structured),
        artStyleBlock,
        opts,
      );
    case "creature":
      return renderCreatureSheet(
        parseAssetSheet("creature", structured),
        artStyleBlock,
        opts,
      );
    case "environment":
      return renderEnvironmentSheet(
        parseAssetSheet("environment", structured),
        artStyleBlock,
        opts,
      );
    case "product":
      return renderProductSheet(
        parseAssetSheet("product", structured),
        artStyleBlock,
        opts,
      );
  }
}

export function validateStructured(
  type: AssetSheetType,
  structured: unknown,
): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    switch (type) {
      case "character":
      case "creature":
      case "environment":
      case "product":
        return { ok: true, data: parseAssetSheet(type, structured) };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function isAssetSheetType(type: string): type is AssetSheetType {
  return (
    type === "character" ||
    type === "creature" ||
    type === "environment" ||
    type === "product"
  );
}
