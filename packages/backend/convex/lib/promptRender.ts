/**
 * Render structured prompt-sheet data to template text.
 */

import {
  PROMPT_TEMPLATE_VERSION,
  parseAssetSheet,
  scriptPromptSchema,
  blockoutSheetSchema,
  renderCharacterSheet,
  renderCreatureSheet,
  renderEnvironmentSheet,
  renderProductSheet,
  renderScriptPrompt,
  renderBlockoutSheet,
  type AssetSheetType,
  type PromptSheetType,
} from "@cinakey/shared";

export { PROMPT_TEMPLATE_VERSION };

export function renderPromptSheetText(
  type: PromptSheetType,
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
    case "script":
      return renderScriptPrompt(scriptPromptSchema.parse(structured));
    case "blockout":
      return renderBlockoutSheet(blockoutSheetSchema.parse(structured));
  }
}

export function validateStructured(
  type: PromptSheetType,
  structured: unknown,
): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    switch (type) {
      case "character":
      case "creature":
      case "environment":
      case "product":
        return { ok: true, data: parseAssetSheet(type, structured) };
      case "script":
        return { ok: true, data: scriptPromptSchema.parse(structured) };
      case "blockout":
        return { ok: true, data: blockoutSheetSchema.parse(structured) };
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
