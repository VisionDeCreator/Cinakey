import type {
  AssetSheetData,
  AssetSheetType,
  CharacterSheetData,
  CreatureSheetData,
  EnvironmentSheetData,
  ProductSheetData,
  ScriptCastBlock,
} from "./schemas";

/** Build a script cast/location description from an approved asset sheet. */
export function deriveCastBlockFromAssetSheet(
  type: AssetSheetType,
  data: AssetSheetData,
  opts: { name: string; imageN: number; suffix?: string },
): ScriptCastBlock {
  return {
    name: opts.name,
    imageN: opts.imageN,
    suffix: opts.suffix,
    description: deriveDescription(type, data),
  };
}

export function deriveDescription(
  type: AssetSheetType,
  data: AssetSheetData,
): string {
  switch (type) {
    case "character": {
      const d = data as CharacterSheetData;
      return [d.faceAndHair, d.outfit, d.signatureDetail.body]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" ");
    }
    case "creature": {
      const d = data as CreatureSheetData;
      const parts = [d.body];
      if (d.gear) parts.push(d.gear.body);
      if (d.signatureDetail) parts.push(d.signatureDetail.body);
      return parts.map((s) => s.trim()).filter(Boolean).join(" ");
    }
    case "environment": {
      const d = data as EnvironmentSheetData;
      return [d.theLand, d.skyAndLight]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" ");
    }
    case "product": {
      const d = data as ProductSheetData;
      return [d.theObject.body, d.feel]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" ");
    }
  }
}

export function deriveLocationDescription(
  data: EnvironmentSheetData,
): string {
  return `${data.place} at ${data.timeOfDay}: ${data.theLand} ${data.skyAndLight} No readable text, no logos, no brand names anywhere.`;
}

/**
 * Map a structured asset prompt sheet onto Look Dev `cinakey.sheet/1.0` fields
 * so accepting a Copilot asset_sheet fills the entity editor.
 */
export function lookDevPatchFromAssetSheet(
  type: AssetSheetType,
  data: AssetSheetData,
): { description: string; sheetPatch: Record<string, string> } {
  switch (type) {
    case "character": {
      const d = data as CharacterSheetData;
      return {
        description: d.subjectLine,
        sheetPatch: {
          look: [d.faceAndHair, d.colorPalette ? `Palette: ${d.colorPalette}` : ""]
            .map((s) => s.trim())
            .filter(Boolean)
            .join("\n\n"),
          wardrobe: d.outfit,
          personality: `${d.signatureDetail.heading}: ${d.signatureDetail.body}`,
        },
      };
    }
    case "creature": {
      const d = data as CreatureSheetData;
      const personality = d.signatureDetail
        ? `${d.signatureDetail.heading}: ${d.signatureDetail.body}`
        : undefined;
      return {
        description: d.subjectLine,
        sheetPatch: {
          look: [d.body, d.colorPalette ? `Palette: ${d.colorPalette}` : ""]
            .map((s) => s.trim())
            .filter(Boolean)
            .join("\n\n"),
          ...(d.gear ? { wardrobe: d.gear.body } : {}),
          ...(personality ? { personality } : {}),
        },
      };
    }
    case "environment": {
      const d = data as EnvironmentSheetData;
      return {
        description: `${d.place} — ${d.timeOfDay}`,
        sheetPatch: {
          notes: [
            d.cameraAngle,
            d.theLand,
            d.skyAndLight,
            d.colorPalette ? `Palette: ${d.colorPalette}` : "",
          ]
            .map((s) => s.trim())
            .filter(Boolean)
            .join("\n\n"),
        },
      };
    }
    case "product": {
      const d = data as ProductSheetData;
      return {
        description: d.objectName,
        sheetPatch: {
          notes: [
            d.views,
            `${d.theObject.heading}: ${d.theObject.body}`,
            d.feel,
            d.colorPalette ? `Palette: ${d.colorPalette}` : "",
          ]
            .map((s) => s.trim())
            .filter(Boolean)
            .join("\n\n"),
        },
      };
    }
  }
}
