import { SCRIPT_ART_STYLE_LOCKING } from "./constants";
import { normalizePromptText } from "./renderers";
import type { ScriptPromptData, ScriptReference, ScriptShot } from "./schemas";

const REF_LINE =
  /^@image_(\d+)\s*=\s*(.+?)\.\s*(Use it for .+)$/i;
const CAST_BLOCK =
  /^THE\s+(.+?)\s+—\s+@image_(\d+)([^:]*)\s*:\s*(.*)$/is;
const LOCATION =
  /^LOCATION\s+—\s+@image_(\d+)\s*:\s*(.+)$/is;
const SHOTS_HEADER =
  /^SHOTS\s*\(\s*([\d.]+)\s*seconds?\s+total\s*,\s*(multi-shot|single-shot)\s*,\s*([^)]+)\s*\)\s*:?\s*$/i;
const SHOT_LINE =
  /^Shot\s+(\d+)\s*\(\s*([\d.]+)s\s*[–\-]\s*([\d.]+)s\s*\)\s*[—\-]\s*(.+)$/i;
const AUDIO_CUE =
  /([\d.]+)s\s+([^0-9]+?)(?=\s+[\d.]+s\s+|$)/g;

/**
 * Extract content for a section. Includes same-line content after the heading
 * (e.g. `LOCATION — @image_3: …`) plus following lines until the next end marker.
 */
function sectionBody(
  text: string,
  startMarker: RegExp,
  endMarkers: RegExp[],
): string {
  const start = text.search(startMarker);
  if (start < 0) return "";
  const fromStart = text.slice(start);
  const firstNl = fromStart.indexOf("\n");
  const headerLine = (
    firstNl >= 0 ? fromStart.slice(0, firstNl) : fromStart
  ).trim();
  let body = firstNl >= 0 ? fromStart.slice(firstNl + 1) : "";
  let earliest = body.length;
  for (const end of endMarkers) {
    const m = body.search(end);
    if (m >= 0 && m < earliest) earliest = m;
  }
  body = body.slice(0, earliest).trim();

  // Keep full header for LOCATION / THE … cast lines that carry payload on the same line.
  if (/^LOCATION\b/i.test(headerLine) || /^THE\s+/i.test(headerLine)) {
    return [headerLine, body].filter(Boolean).join("\n").trim();
  }

  // Same-line payload after ": " (IMAGE QUALITY body can be multi-line after header).
  const colonIdx = headerLine.indexOf(": ");
  const sameLine = colonIdx >= 0 ? headerLine.slice(colonIdx + 2).trim() : "";
  if (sameLine && body) return `${sameLine}\n${body}`.trim();
  if (sameLine) return sameLine;
  return body;
}

function parseReferences(block: string): ScriptReference[] {
  const refs: ScriptReference[] = [];
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(REF_LINE);
    if (!m) continue;
    const imageN = Number(m[1]);
    const entityLabel = m[2]!.trim();
    const useFor = m[3]!.trim();
    refs.push({
      imageN,
      entityId: entityLabel,
      entityLabel,
      useFor,
    });
  }
  return refs;
}

function parseArtStyle(block: string): {
  artStyleBlock: string;
  artStyleExtras?: string;
} {
  const brought = block.match(
    /brought to life:\s*([\s\S]+)$/i,
  );
  let rest = (brought?.[1] ?? block).trim();
  for (const lock of SCRIPT_ART_STYLE_LOCKING) {
    const idx = rest.indexOf(lock);
    if (idx >= 0) {
      rest = rest.slice(0, idx).trim();
    }
  }
  // Split on first sentence boundary after the core style paragraph when extras follow.
  // Heuristic: first sentence = artStyleBlock; remainder = artStyleExtras.
  const sentences = rest.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [rest];
  const first = (sentences[0] ?? rest).trim();
  const extras = sentences
    .slice(1)
    .join(" ")
    .trim();
  return {
    artStyleBlock: first.replace(/\s+/g, " ").trim() || rest,
    ...(extras ? { artStyleExtras: extras.replace(/\s+/g, " ").trim() } : {}),
  };
}

function parseCastBlocks(
  text: string,
): ScriptPromptData["castBlocks"] {
  const blocks: ScriptPromptData["castBlocks"] = [];
  // Find THE … — @image_N blocks between IMAGE QUALITY and LOCATION
  const iqEnd = text.search(/\nLOCATION\s+—/i);
  const iqStart = text.search(/IMAGE QUALITY/i);
  if (iqStart < 0) return blocks;
  const region = text.slice(iqStart, iqEnd >= 0 ? iqEnd : undefined);
  const afterIq = region.replace(/^[\s\S]*?IMAGE QUALITY[^\n]*\n[\s\S]*?\n\n/, "");
  const chunk = afterIq.length < region.length ? afterIq : region;

  const re =
    /THE\s+([A-Z][A-Z0-9 \-']*?)\s+—\s+@image_(\d+)([^:\n]*)\s*:\s*([\s\S]*?)(?=\n\nTHE\s+[A-Z]|\n\nLOCATION\s+—|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) {
    const name = m[1]!.trim();
    const imageN = Number(m[2]);
    const suffixRaw = m[3]!.trim();
    const description = m[4]!.trim();
    const suffix = suffixRaw.startsWith(",")
      ? suffixRaw
      : suffixRaw
        ? `, ${suffixRaw}`
        : undefined;
    blocks.push({
      name: name.toLowerCase(),
      imageN,
      description,
      ...(suffix ? { suffix } : {}),
    });
  }

  // Fallback: line-based if multiline regex missed
  if (blocks.length === 0) {
    for (const para of chunk.split(/\n\n+/)) {
      const cm = para.trim().match(CAST_BLOCK);
      if (!cm) continue;
      const suffixRaw = cm[3]!.trim();
      blocks.push({
        name: cm[1]!.trim().toLowerCase(),
        imageN: Number(cm[2]),
        description: cm[4]!.trim(),
        ...(suffixRaw
          ? { suffix: suffixRaw.startsWith(",") ? suffixRaw : `, ${suffixRaw}` }
          : {}),
      });
    }
  }
  return blocks;
}

function parseShots(block: string): ScriptShot[] {
  const shots: ScriptShot[] = [];
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(SHOT_LINE);
    if (!m) continue;
    const n = Number(m[1]);
    const startSec = Number(m[2]);
    const endSec = Number(m[3]);
    const rest = m[4]!.trim();
    const colon = rest.indexOf(": ");
    const framing = colon >= 0 ? rest.slice(0, colon).trim() : rest;
    const action = colon >= 0 ? rest.slice(colon + 2).trim() : rest;
    const comma = framing.indexOf(", ");
    const shotType = comma >= 0 ? framing.slice(0, comma).trim() : framing;
    const cameraMove = comma >= 0 ? framing.slice(comma + 2).trim() : undefined;
    shots.push({
      n,
      startSec,
      endSec,
      shotType,
      ...(cameraMove ? { cameraMove } : {}),
      action,
    });
  }
  return shots;
}

function parseAudioCues(
  block: string,
): { audioIntro?: string; audioCues: ScriptPromptData["audioCues"] } {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  let audioIntro: string | undefined;
  let body = block.trim();
  if (lines[0]?.toUpperCase().startsWith("AUDIO")) {
    audioIntro = lines[0];
    body = lines.slice(1).join(" ").trim();
  }
  const cues: ScriptPromptData["audioCues"] = [];
  AUDIO_CUE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AUDIO_CUE.exec(body)) !== null) {
    cues.push({
      atSec: Number(m[1]),
      description: m[2]!.trim().replace(/[.\s]+$/, (s) =>
        s.includes(".") ? "." : "",
      ).replace(/\s+$/, ""),
    });
  }
  // Clean trailing punctuation on descriptions
  for (const c of cues) {
    c.description = c.description.replace(/\s+/g, " ").trim();
  }
  return { audioIntro, audioCues: cues };
}

/**
 * Parse a Phase 7C script prompt (rendered text) into structured data.
 * entityId on references is set to the entity label; callers resolve to real ids.
 */
export function parseScriptPromptText(text: string): ScriptPromptData {
  const normalized = normalizePromptText(text);

  const references = parseReferences(
    sectionBody(normalized, /^REFERENCES\b/im, [
      /^ART STYLE/im,
      /^IMAGE QUALITY/im,
    ]),
  );

  const artStyleRaw = sectionBody(normalized, /^ART STYLE/im, [
    /^IMAGE QUALITY/im,
    /^THE\s+[A-Z]/im,
    /^LOCATION\s+—/im,
  ]);
  const { artStyleBlock, artStyleExtras } = parseArtStyle(artStyleRaw);

  const imageQuality = sectionBody(normalized, /^IMAGE QUALITY/im, [
    /^THE\s+[A-Z]/im,
    /^LOCATION\s+—/im,
  ]);

  const castBlocks = parseCastBlocks(normalized);

  const locationRaw = sectionBody(normalized, /^LOCATION\s+—/im, [
    /^SHOTS\s*\(/im,
  ]);
  const locMatch = locationRaw.match(LOCATION) ??
    normalized.match(LOCATION);
  const location = {
    imageN: locMatch ? Number(locMatch[1]) : references[0]?.imageN ?? 1,
    description: locMatch
      ? locMatch[2]!.trim()
      : locationRaw.replace(/^LOCATION[^\n]*\n?/i, "").trim() || "location",
  };

  const shotsHeaderLine =
    normalized.split("\n").find((l) => /^SHOTS\s*\(/i.test(l.trim())) ?? "";
  const headerMatch = shotsHeaderLine.trim().match(SHOTS_HEADER);
  const totalDurationSec = headerMatch
    ? Number(headerMatch[1])
    : 0;
  const multiShot = headerMatch
    ? headerMatch[2]!.toLowerCase() === "multi-shot"
    : true;
  const aspectRatio = headerMatch ? headerMatch[3]!.trim() : "16:9";

  const shots = parseShots(
    sectionBody(normalized, /^SHOTS\s*\(/im, [
      /^CONSISTENCY\b/im,
      /^MOTION AND PHYSICS\b/im,
    ]),
  );

  const consistency = sectionBody(normalized, /^CONSISTENCY\b/im, [
    /^MOTION AND PHYSICS\b/im,
  ]);
  const motionAndPhysics = sectionBody(
    normalized,
    /^MOTION AND PHYSICS\b/im,
    [/^LIGHTING\b/im],
  );
  const lighting = sectionBody(normalized, /^LIGHTING\b/im, [
    /^TECHNICAL\b/im,
  ]);
  const technical = sectionBody(normalized, /^TECHNICAL\b/im, [/^MUSIC\b/im]);
  const music = sectionBody(normalized, /^MUSIC\b/im, [/^AUDIO\b/im]);
  const audioBlock = sectionBody(normalized, /^AUDIO\b/im, []);
  const { audioIntro, audioCues } = parseAudioCues(
    audioBlock ||
      (normalized.match(/^AUDIO\b[\s\S]*$/im)?.[0] ?? ""),
  );

  const duration =
    totalDurationSec > 0
      ? totalDurationSec
      : shots.length > 0
        ? Math.max(...shots.map((s) => s.endSec))
        : 1;

  return {
    references:
      references.length > 0
        ? references
        : [
            {
              imageN: 1,
              entityId: "unknown",
              entityLabel: "unknown",
              useFor: "Use it for reference.",
            },
          ],
    artStyleBlock: artStyleBlock || "art style",
    ...(artStyleExtras ? { artStyleExtras } : {}),
    imageQuality: imageQuality || "sharp and clean",
    castBlocks,
    location,
    totalDurationSec: duration,
    aspectRatio,
    multiShot,
    shots:
      shots.length > 0
        ? shots
        : [
            {
              n: 1,
              startSec: 0,
              endSec: duration,
              shotType: "Wide shot",
              action: "action",
            },
          ],
    consistency: consistency || "consistent",
    motionAndPhysics: motionAndPhysics || "natural motion",
    lighting: lighting || "natural light",
    technical: technical || `${aspectRatio}`,
    music: music || "score",
    ...(audioIntro ? { audioIntro } : {}),
    audioCues,
  };
}

/** Fingerprint of a script shot line for selective blockout rebuilds. */
export function scriptShotFingerprint(shot: {
  n?: number;
  startSec: number;
  endSec: number;
  shotType: string;
  cameraMove?: string;
  action: string;
}): string {
  return [
    shot.n ?? "",
    shot.startSec,
    shot.endSec,
    shot.shotType.trim(),
    (shot.cameraMove ?? "").trim(),
    shot.action.trim(),
  ].join("|");
}
