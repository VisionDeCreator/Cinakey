/**
 * Render structured prompt-sheet data to template text.
 */

import {
  PROMPT_TEMPLATE_VERSION,
  characterSheetSchema,
  creatureSheetSchema,
  environmentSheetSchema,
  productSheetSchema,
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
): string {
  switch (type) {
    case "character":
      return renderCharacterSheet(
        characterSheetSchema.parse(structured),
        artStyleBlock,
      );
    case "creature":
      return renderCreatureSheet(
        creatureSheetSchema.parse(structured),
        artStyleBlock,
      );
    case "environment":
      return renderEnvironmentSheet(
        environmentSheetSchema.parse(structured),
        artStyleBlock,
      );
    case "product":
      return renderProductSheet(
        productSheetSchema.parse(structured),
        artStyleBlock,
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
        return { ok: true, data: characterSheetSchema.parse(structured) };
      case "creature":
        return { ok: true, data: creatureSheetSchema.parse(structured) };
      case "environment":
        return { ok: true, data: environmentSheetSchema.parse(structured) };
      case "product":
        return { ok: true, data: productSheetSchema.parse(structured) };
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
