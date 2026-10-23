import {
  ENVIRONMENT_NO_CHARACTERS_CLAUSE,
  STYLE_REFERENCE_PROMPT_PREFIX,
} from "./constants";
import type { AssetSheetType, ScriptPromptData } from "./schemas";

/** Strip articles for matching "the boy" ↔ "boy". */
export function scriptAssetLabelKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/^the\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Infer creative-asset sheet type from a script REFERENCE / LOCATION / cast cue.
 */
export function inferAssetTypeFromScriptRef(input: {
  entityLabel: string;
  useFor?: string;
  isLocation?: boolean;
}): AssetSheetType {
  if (input.isLocation) return "environment";
  const blob = `${input.entityLabel} ${input.useFor ?? ""}`.toLowerCase();
  if (
    /\b(landscape|savanna|location|environment|place|sky|grassland|forest|desert|ocean|river|mountain|room|café|cafe|street|interior|exterior)\b/.test(
      blob,
    )
  ) {
    return "environment";
  }
  if (
    /\b(creature|animal|beast|cheetah|antelope|horse|raptor|shark|croc|dinosaur|herd|quadruped|biped|hare|rabbit)\b/.test(
      blob,
    )
  ) {
    return "creature";
  }
  if (
    /\b(campfire|campsite|fire pit)\b/.test(blob)
  ) {
    return "environment";
  }
  if (
    /\b(rifle|weapon|prop|product|object|tool|gear|vehicle|car|door|table|chair)\b/.test(
      blob,
    ) &&
    !/\b(face|hair|clothing|boy|girl|man|woman|person|character|human)\b/.test(
      blob,
    )
  ) {
    return "product";
  }
  return "character";
}

export type ScriptRequiredAsset = {
  imageN: number;
  label: string;
  assetType: AssetSheetType;
  description: string;
  useFor?: string;
};

/** Collect entities the script requires (REFERENCES + cast + location). */
export function requiredAssetsFromScript(
  parsed: ScriptPromptData,
): ScriptRequiredAsset[] {
  const byImage = new Map<number, ScriptRequiredAsset>();
  const castByImage = new Map(
    parsed.castBlocks.map((c) => [c.imageN, c] as const),
  );

  for (const ref of parsed.references) {
    const isLocation = ref.imageN === parsed.location.imageN;
    const cast = castByImage.get(ref.imageN);
    const description = isLocation
      ? parsed.location.description
      : (cast?.description ?? ref.useFor);
    byImage.set(ref.imageN, {
      imageN: ref.imageN,
      label: ref.entityLabel.replace(/^the\s+/i, "").trim() || ref.entityLabel,
      assetType: inferAssetTypeFromScriptRef({
        entityLabel: ref.entityLabel,
        useFor: ref.useFor,
        isLocation,
      }),
      description: description.trim(),
      useFor: ref.useFor,
    });
  }

  // Cast blocks without a REFERENCE line still need an asset
  for (const cast of parsed.castBlocks) {
    if (byImage.has(cast.imageN)) continue;
    byImage.set(cast.imageN, {
      imageN: cast.imageN,
      label: cast.name.replace(/^the\s+/i, "").trim() || cast.name,
      assetType: inferAssetTypeFromScriptRef({
        entityLabel: cast.name,
        useFor: cast.description,
      }),
      description: cast.description.trim(),
    });
  }

  // Location without a matching REFERENCE
  if (!byImage.has(parsed.location.imageN)) {
    byImage.set(parsed.location.imageN, {
      imageN: parsed.location.imageN,
      label: "location",
      assetType: "environment",
      description: parsed.location.description.trim(),
    });
  }

  return [...byImage.values()].sort((a, b) => a.imageN - b.imageN);
}

/** Seed a draft asset prompt from a script cast/location description. */
export function seedAssetPromptFromScriptDescription(
  assetType: AssetSheetType,
  name: string,
  description: string,
  artStyleBlock?: string,
  opts?: { hasStyleReference?: boolean },
): string {
  const style =
    artStyleBlock?.trim() ||
    "Soft painted illustration, consistent with the project style reference.";
  const desc = description.trim();
  const title = name.trim() || "asset";
  const hasStyleReference = opts?.hasStyleReference === true;
  const styleBlock = hasStyleReference
    ? []
    : ["", `ART STYLE: ${style}`];
  const mood =
    "MOOD AND COLOR: Derived from the description. No readable text, no logos, no brand names anywhere.";

  switch (assetType) {
    case "character": {
      const opening = `Character reference sheet of ${title}, on a plain white background: front view, three-quarter view, side view. Soft ground shadows.`;
      return [
        hasStyleReference
          ? `Use the attached image as the art style reference: ${opening}`
          : opening,
        ...styleBlock,
        "",
        `FACE AND HAIR: ${desc}`,
        "",
        `OUTFIT: ${desc}`,
        "",
        `SIGNATURE DETAIL: ${desc}`,
        "",
        mood,
      ].join("\n");
    }
    case "creature": {
      const opening = `Creature design sheet of ${title}, on a plain white background: front view, three-quarter view, side view. Soft ground shadows.`;
      return [
        hasStyleReference
          ? `Use the attached image as the art style reference: ${opening}`
          : opening,
        ...styleBlock,
        "",
        `BODY: ${desc}`,
        "",
        `HEAD: ${desc}`,
        "",
        `MARKINGS: ${desc}`,
        "",
        mood,
      ].join("\n");
    }
    case "environment": {
      const opening = `Wide environment illustration of ${title}. ${ENVIRONMENT_NO_CHARACTERS_CLAUSE}`;
      return [
        hasStyleReference
          ? `${STYLE_REFERENCE_PROMPT_PREFIX} ${opening}`
          : opening,
        ...styleBlock,
        "",
        `THE LAND: ${desc}`,
        "",
        `SKY AND LIGHT: ${desc}`,
        "",
        mood,
      ].join("\n");
    }
    case "product": {
      const opening = `Product-style illustration of a single ${title} on a plain white background. Soft ground shadows.`;
      return [
        hasStyleReference
          ? `Use the attached image as the art style reference: ${opening}`
          : opening,
        ...styleBlock,
        "",
        `THE OBJECT: ${desc}`,
        "",
        `FEEL: ${desc}`,
        "",
        mood,
      ].join("\n");
    }
  }
}
