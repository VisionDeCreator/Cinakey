import type { AssetSheetType } from "./schemas";

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
  if (/\b(campfire|campsite|fire pit)\b/.test(blob)) {
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
