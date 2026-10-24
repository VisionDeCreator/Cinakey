function normalizeMentions(text: string): string {
  return text.replace(
    /@\[(image|video)[_\s-]*(\d+)\](?:\((?:image_|video_)?\d+\))?/gi,
    (_match, kind: string, n: string) => `@${kind.toLowerCase()}_${n}`,
  );
}
/** User-facing aliases bind to stable media IDs; names are only search labels. */
export type ReferenceBinding = { alias: string; assetId: string };
export type ReferenceCandidate = {
  assetId: string;
  name: string;
  type: string;
};
export function referenceAlias(name: string): string {
  return name
    .trim()
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}
export function scriptMentions(text: string): string[] {
  return [
    ...new Set(
      [
        ...normalizeMentions(text).matchAll(
          /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_-]+)/gu,
        ),
      ].map((m) => m[1]!.toLowerCase()),
    ),
  ];
}
export function resolveReferences(
  text: string,
  bindings: ReferenceBinding[],
  candidates: ReferenceCandidate[],
) {
  text = normalizeMentions(text);
  const resolved: { alias: string; assetId: string; type: string }[] = [];
  const unresolved: string[] = [];
  const ambiguous: string[] = [];
  for (const alias of scriptMentions(text)) {
    const binding = bindings.find((b) => b.alias === alias);
    const matches = binding
      ? candidates.filter((c) => c.assetId === binding.assetId)
      : candidates.filter((c) => referenceAlias(c.name) === alias);
    const unique = [...new Map(matches.map((c) => [c.assetId, c])).values()];
    if (unique.length > 1) ambiguous.push(alias);
    else if (!unique[0] || !["image", "video"].includes(unique[0].type))
      unresolved.push(alias);
    else if (
      (/^image_\d+$/.test(alias) && unique[0].type !== "image") ||
      (/^video_\d+$/.test(alias) && unique[0].type !== "video")
    )
      unresolved.push(alias);
    else
      resolved.push({
        alias,
        assetId: unique[0].assetId,
        type: unique[0].type,
      });
  }
  const imageIds = [
    ...new Set(
      resolved.filter((r) => r.type === "image").map((r) => r.assetId),
    ),
  ];
  const videoIds = [
    ...new Set(
      resolved.filter((r) => r.type === "video").map((r) => r.assetId),
    ),
  ];
  const tokens = new Map(
    resolved.map((r) => [
      r.alias,
      r.type === "image"
        ? `@image_${imageIds.indexOf(r.assetId) + 1}`
        : `@video_${videoIds.indexOf(r.assetId) + 1}`,
    ]),
  );
  const prompt = text.replace(
    /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_-]+)/gu,
    (original, alias: string) => tokens.get(alias.toLowerCase()) ?? original,
  );
  return { resolved, unresolved, ambiguous, imageIds, videoIds, prompt };
}
