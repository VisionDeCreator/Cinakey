export type ScriptMention = {
  alias: string;
  start: number;
  end: number;
  text: string;
  markdown: boolean;
};

/** Source ranges refer to the original text, including complete pasted Markdown links. */
export function scriptMentionRanges(text: string): ScriptMention[] {
  const pattern =
    /(?<![\p{L}\p{N}_])@(?:\[([^\]\r\n]+)\](?:\\?\(([\p{L}\p{N}_-]+)\\?\))?|([\p{L}\p{N}_-]+))/gu;
  const mentions: ScriptMention[] = [];
  for (const match of text.matchAll(pattern)) {
    const label = match[1];
    const numbered = label && /^(image|video)[_\s-]*(\d+)$/i.exec(label);
    const alias =
      match[2]?.toLowerCase() ??
      (numbered
        ? `${numbered[1]!.toLowerCase()}_${numbered[2]}`
        : match[3]?.toLowerCase());
    if (alias)
      mentions.push({
        alias,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        markdown: label !== undefined,
      });
  }
  return mentions;
}
function rewriteMentions(
  text: string,
  transform: (mention: ScriptMention) => string,
) {
  let result = "",
    cursor = 0;
  for (const mention of scriptMentionRanges(text)) {
    result += text.slice(cursor, mention.start) + transform(mention);
    cursor = mention.end;
  }
  return result + text.slice(cursor);
}
function normalizeMentions(text: string): string {
  return rewriteMentions(text, (mention) =>
    mention.markdown ? `@${mention.alias}` : mention.text,
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
  return [...new Set(scriptMentionRanges(text).map((m) => m.alias))];
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

/** Replace complete mentions only; email addresses and longer aliases are untouched. */
export function renameReferenceMentions(
  text: string,
  from: string,
  to: string,
): string {
  const source = referenceAlias(from),
    target = referenceAlias(to);
  return rewriteMentions(text, (mention) => {
    if (mention.alias !== source) return mention.text;
    if (!mention.markdown) return `@${target}`;
    const numbered = /^(image|video)_(\d+)$/.exec(target);
    const label = numbered
      ? `${numbered[1] === "image" ? "Image" : "Video"} ${numbered[2]}`
      : target;
    return `@[${label}](${target})`;
  });
}

export function mentionAtCaret(text: string, caret: number) {
  const match = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_-]*)$/u.exec(
    text.slice(0, caret),
  );
  if (!match) return null;
  const tail = /^[\p{L}\p{N}_-]*/u.exec(text.slice(caret))?.[0] ?? "";
  return {
    start: match.index,
    end: caret + tail.length,
    query: match[1] ?? "",
  };
}

/** Keep numbered aliases truthful when switching the reference's media type. */
export function replacementReferenceAlias(
  alias: string,
  type: string,
  used: string[],
): string {
  if (!/^(image|video)_\d+$/.test(alias) || alias.startsWith(`${type}_`))
    return alias;
  let n = Number(alias.split("_")[1]) || 1;
  const occupied = new Set(used);
  while (occupied.has(`${type}_${n}`)) n++;
  return `${type}_${n}`;
}
