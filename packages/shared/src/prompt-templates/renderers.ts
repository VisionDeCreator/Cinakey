import {
  COLOR_PALETTE_SUFFIX,
  COLOR_PALETTE_SUFFIX_ENVIRONMENT,
  COLOR_PALETTE_SUFFIX_PRODUCT,
  ENVIRONMENT_NO_CHARACTERS_CLAUSE,
  SCRIPT_ART_STYLE_LOCKING,
  STYLE_REFERENCE_PROMPT_PREFIX,
} from "./constants";
import type {
  BlockoutSheetData,
  CharacterSheetData,
  CreatureSheetData,
  EnvironmentSheetData,
  ProductSheetData,
  ScriptPromptData,
} from "./schemas";

export type AssetRenderOpts = {
  /** When true, omit ART STYLE and prefix the opening with the style-ref instruction. */
  hasStyleReference?: boolean;
};

function formatViewsList(views: string[]): string {
  if (views.length === 0) return "";
  if (views.length === 1) return views[0]!;
  if (views.length === 2) return `${views[0]} and ${views[1]}`;
  const head = views.slice(0, -1).join(", ");
  const last = views[views.length - 1]!;
  if (last.startsWith("plus ") || last.startsWith("and ")) {
    return `${head}, ${last}`;
  }
  return `${head}, and ${last}`;
}

function moodAndColorLine(palette: string, suffix: string): string {
  const trimmed = palette.trim().replace(/\.\s*$/, "");
  const already =
    trimmed.toLowerCase().includes("no readable text") ||
    trimmed.toLowerCase().includes("no letters");
  if (already) return `MOOD AND COLOR: ${trimmed}`;
  return `MOOD AND COLOR: ${trimmed}. ${suffix}`;
}

function withStyleSpine(
  opening: string,
  artStyleBlock: string,
  hasStyleReference: boolean,
  bodyLines: string[],
): string {
  const parts: string[] = [];
  if (hasStyleReference) {
    parts.push(`${STYLE_REFERENCE_PROMPT_PREFIX} ${opening}`);
  } else {
    parts.push(opening, "", `ART STYLE: ${artStyleBlock.trim()}`);
  }
  for (const line of bodyLines) {
    parts.push(line);
  }
  return parts.join("\n");
}

export function renderCharacterSheet(
  data: CharacterSheetData,
  artStyleBlock: string,
  opts?: AssetRenderOpts,
): string {
  const views = formatViewsList(data.views);
  const opening = `Character reference sheet of ${data.subjectLine}, on a plain white background: ${views}. Soft ground shadows.`;
  const sigHeading = data.signatureDetail.heading.toUpperCase();
  const hasStyleReference = opts?.hasStyleReference === true;
  return withStyleSpine(opening, artStyleBlock, hasStyleReference, [
    "",
    `FACE AND HAIR: ${data.faceAndHair.trim()}`,
    "",
    `OUTFIT: ${data.outfit.trim()}`,
    "",
    `${sigHeading}: ${data.signatureDetail.body.trim()}`,
    "",
    moodAndColorLine(data.moodAndColor, COLOR_PALETTE_SUFFIX),
  ]);
}

export function renderCreatureSheet(
  data: CreatureSheetData,
  artStyleBlock: string,
  opts?: AssetRenderOpts,
): string {
  const views = formatViewsList(data.views);
  const opening = `Creature design sheet of ${data.subjectLine}, on a plain white background: ${views}. Soft ground shadows.`;
  const hasStyleReference = opts?.hasStyleReference === true;
  const mid: string[] = [
    "",
    `BODY: ${data.body.trim()}`,
    "",
    `HEAD: ${data.head.trim()}`,
    "",
    `MARKINGS: ${data.markings.trim()}`,
  ];
  if (data.gear) {
    mid.push(
      "",
      `${data.gear.heading.toUpperCase()}: ${data.gear.body.trim()}`,
    );
  }
  if (data.signatureDetail) {
    mid.push(
      "",
      `${data.signatureDetail.heading.toUpperCase()}: ${data.signatureDetail.body.trim()}`,
    );
  }
  mid.push("", moodAndColorLine(data.moodAndColor, COLOR_PALETTE_SUFFIX));
  return withStyleSpine(opening, artStyleBlock, hasStyleReference, mid);
}

export function renderEnvironmentSheet(
  data: EnvironmentSheetData,
  artStyleBlock: string,
  opts?: AssetRenderOpts,
): string {
  const opening = `Wide environment illustration of ${data.place} at ${data.timeOfDay}, seen from ${data.cameraAngle}. ${ENVIRONMENT_NO_CHARACTERS_CLAUSE}`;
  const hasStyleReference = opts?.hasStyleReference === true;
  const settingHeading = (data.settingHeading ?? "THE LAND").trim().toUpperCase();
  const lightHeading = (data.lightHeading ?? "SKY AND LIGHT")
    .trim()
    .toUpperCase();
  const mid: string[] = ["", `${settingHeading}: ${data.theLand.trim()}`, ""];
  for (const extra of data.extraSections ?? []) {
    mid.push(
      `${extra.heading.trim().toUpperCase()}: ${extra.body.trim()}`,
      "",
    );
  }
  mid.push(
    `${lightHeading}: ${data.skyAndLight.trim()}`,
    "",
    moodAndColorLine(data.moodAndColor, COLOR_PALETTE_SUFFIX_ENVIRONMENT),
  );
  return withStyleSpine(opening, artStyleBlock, hasStyleReference, mid);
}

export function renderProductSheet(
  data: ProductSheetData,
  artStyleBlock: string,
  opts?: AssetRenderOpts,
): string {
  const opening = `Product-style illustration of a single ${data.objectName} on a plain white background, shown in ${data.views}. Soft ground shadows.`;
  const objHeading = data.theObject.heading.toUpperCase();
  const hasStyleReference = opts?.hasStyleReference === true;
  return withStyleSpine(opening, artStyleBlock, hasStyleReference, [
    "",
    `${objHeading}: ${data.theObject.body.trim()}`,
    "",
    `FEEL: ${data.feel.trim()}`,
    "",
    moodAndColorLine(data.moodAndColor, COLOR_PALETTE_SUFFIX_PRODUCT),
  ]);
}

function formatShotTime(sec: number): string {
  return Number.isInteger(sec) ? `${sec}.0` : String(sec);
}

function renderScriptShot(shot: ScriptPromptData["shots"][number]): string {
  const start = formatShotTime(shot.startSec);
  const end = formatShotTime(shot.endSec);
  const move = shot.cameraMove?.trim();
  const framing = move ? `${shot.shotType}, ${move}` : shot.shotType;
  return `Shot ${shot.n} (${start}s–${end}s) — ${framing}: ${shot.action}`;
}

export function renderScriptPrompt(data: ScriptPromptData): string {
  const refsFormatted = data.references.map((r) => {
    const use = r.useFor.trim();
    if (use.toLowerCase().startsWith("use it for")) {
      return `@image_${r.imageN} = ${r.entityLabel}. ${use}`;
    }
    return `@image_${r.imageN} = ${r.entityLabel}. Use it for ${use}`;
  });

  const imageList = data.references
    .map((r) => `@image_${r.imageN}`)
    .join(", ");
  const lastImage =
    data.references.length > 1
      ? data.references
          .slice(0, -1)
          .map((r) => `@image_${r.imageN}`)
          .join(", ") +
        " and " +
        `@image_${data.references[data.references.length - 1]!.imageN}`
      : imageList;

  const artStyleSection = [
    "ART STYLE — LOCKED TO THE REFERENCE IMAGES:",
    `Use the exact art style already defined in ${lastImage} for the entire video. Do not change, reinterpret or drift from it at any point. Every frame must look like these illustrations brought to life: ${data.artStyleBlock.trim()}${data.artStyleExtras ? ` ${data.artStyleExtras.trim()}` : ""} ${SCRIPT_ART_STYLE_LOCKING.join(" ")}`,
  ].join("\n");

  const castSections = data.castBlocks.map((c) => {
    const suffix = c.suffix ?? ", identical in every shot";
    return [
      `THE ${c.name.toUpperCase()} — @image_${c.imageN}${suffix}:`,
      c.description.trim(),
    ].join("\n");
  });

  const durationLabel = Number.isInteger(data.totalDurationSec)
    ? String(data.totalDurationSec)
    : String(data.totalDurationSec);
  const multi = data.multiShot !== false ? "multi-shot" : "single-shot";
  const shotsHeader = `SHOTS (${durationLabel} seconds total, ${multi}, ${data.aspectRatio}):`;

  const audioIntro =
    data.audioIntro?.trim() ||
    "AUDIO (native sound, synced to picture, no dialogue):";
  const audioBody = data.audioCues
    .map((c) => {
      const t = Number.isInteger(c.atSec) ? `${c.atSec}.0` : String(c.atSec);
      return `${t}s ${c.description}`;
    })
    .join(" ");

  return [
    "REFERENCES",
    ...refsFormatted,
    "",
    artStyleSection,
    "",
    "IMAGE QUALITY — ALWAYS SHARP AND CLEAN:",
    data.imageQuality.trim(),
    "",
    ...castSections.flatMap((s, i) => (i === 0 ? [s] : ["", s])),
    "",
    `LOCATION — @image_${data.location.imageN}: ${data.location.description.trim()}`,
    "",
    shotsHeader,
    ...data.shots.map(renderScriptShot),
    "",
    "CONSISTENCY:",
    data.consistency.trim(),
    "",
    "MOTION AND PHYSICS:",
    data.motionAndPhysics.trim(),
    "",
    "LIGHTING:",
    data.lighting.trim(),
    "",
    "TECHNICAL:",
    data.technical.trim(),
    "",
    "MUSIC:",
    data.music.trim(),
    "",
    audioIntro,
    audioBody,
  ].join("\n");
}

function formatVec3(v: [number, number, number]): string {
  return `(${v[0]}, ${v[1]}, ${v[2]})`;
}

function formatSize(v: [number, number, number]): string {
  return `${v[0]} × ${v[1]} × ${v[2]}`;
}

export function renderBlockoutSheet(data: BlockoutSheetData): string {
  const parts: string[] = [
    `BLOCKOUT SHEET — ${data.sequenceTitle} · from script prompt v${data.scriptPromptVersion}`,
    "",
    `SEQUENCE: ${data.durationSec}s, ${data.aspectRatio}, ${data.fps}fps, ${data.shotCount} shots. World units: metres, Y up, origin at ${data.worldOriginLandmark}.`,
    "",
    "REFERENCES:",
    ...data.references.map(
      (r) =>
        `@image_${r.imageN} = ${r.entityLabel} → stand-in ${r.standInId}`,
    ),
    "",
    "SET:",
    ...data.set.map((s) => {
      const rot = s.rotation ? `, rotation ${formatVec3(s.rotation)}` : "";
      const notes = s.notes ? `, ${s.notes}` : "";
      return `${s.id} ${s.name} — ${s.primitive}, position ${formatVec3(s.position)}, size (${formatSize(s.size)})${rot}${notes}.`;
    }),
    "",
    "CAST:",
    ...data.cast.map((c) => {
      const sizeParts: string[] = [];
      if (c.heightM !== undefined) sizeParts.push(`height ${c.heightM}m`);
      if (c.lengthM !== undefined) sizeParts.push(`length ${c.lengthM}m`);
      const size = sizeParts.length ? `, ${sizeParts.join(", ")}` : "";
      const color = c.colorCode ? `, colour ${c.colorCode}` : "";
      const img = c.imageN !== undefined ? `, @image_${c.imageN}` : "";
      const rider = c.riderAttachment
        ? `, rider attachment: ${c.riderAttachment}`
        : "";
      const group =
        c.count !== undefined
          ? `, count ${c.count}${c.spread ? ` spread ${c.spread}` : ""}`
          : "";
      return `${c.id} ${c.name} — ${c.proxy}${size}${color}${img}${rider}${group}.`;
    }),
  ];

  if (data.props.length > 0) {
    parts.push(
      "",
      "PROPS:",
      ...data.props.map((p) => {
        const att = p.attachment ? ` — ${p.attachment}` : "";
        const img = p.imageN !== undefined ? `, @image_${p.imageN}` : "";
        return `${p.id} ${p.name}${att}${img}.`;
      }),
    );
  }

  const light = data.light;
  parts.push(
    "",
    "LIGHT:",
    `Sun azimuth ${light.sunAzimuthDeg}°, elevation ${light.sunElevationDeg}°${light.colorTemperatureK ? `, ${light.colorTemperatureK}K` : ""}${light.fill ? `, fill: ${light.fill}` : ""}${light.notes ? `. ${light.notes}` : "."}`,
    "",
    "SHOTS:",
  );

  for (const shot of data.shots) {
    const dur = (shot.endSec - shot.startSec).toFixed(1);
    parts.push(
      `SHOT ${String(shot.n).padStart(2, "0")} · ${formatShotTime(shot.startSec)}–${formatShotTime(shot.endSec)}s (${dur}s) · ${shot.shotType} · ${shot.lensMm}mm · ${shot.cameraMove}.`,
      `Camera: ${formatVec3(shot.camera.startPosition)} looking at ${formatVec3(shot.camera.startLookAt)} → ${formatVec3(shot.camera.endPosition)} looking at ${formatVec3(shot.camera.endLookAt)}; move ${shot.camera.moveType}${shot.camera.easing ? `, ${shot.camera.easing}` : ""}.`,
    );
    if (shot.blocking.length > 0) {
      const blockingLines = shot.blocking.map((b) => {
        const keys =
          b.timedKeys && b.timedKeys.length > 0
            ? `; ${b.timedKeys.map((k) => `t=${k.t}s ${k.note}`).join(", ")}`
            : "";
        return `${b.targetId} ${formatVec3(b.startPosition)}${b.startPose ? ` ${b.startPose}` : ""} → ${formatVec3(b.endPosition)}${b.endPose ? ` ${b.endPose}` : ""}${keys}`;
      });
      parts.push(`Blocking: ${blockingLines.join("; ")}.`);
    } else {
      parts.push("Blocking: none.");
    }
    if (shot.events.length > 0) {
      parts.push(
        `Events: ${shot.events.map((e) => `t=${e.t}s ${e.label}`).join("; ")}.`,
      );
    } else {
      parts.push("Events: none.");
    }
    parts.push(
      `Frame must show: ${shot.frameMustShow}`,
      `Continuity: ${shot.continuity}`,
    );
    if (shot.audioCue) parts.push(`Audio cue: ${shot.audioCue}`);
    parts.push(`Transition out: ${shot.transitionOut}.`);
    if (shot.guides && shot.guides.length > 0) {
      parts.push(`Guides: ${shot.guides.join(", ")}.`);
    }
    parts.push("");
  }

  return parts.join("\n").trimEnd() + "\n";
}

/** Split rendered text into named sections for snapshot comparison. */
export function splitAssetSheetSections(text: string): Record<string, string> {
  const lines = text.trim().split("\n");
  const sections: Record<string, string> = {};
  let current = "OPENING";
  const buf: string[] = [];

  const flush = () => {
    sections[current] = buf.join("\n").trim();
    buf.length = 0;
  };

  for (const line of lines) {
    const headingMatch =
      /^(ART STYLE|FACE AND HAIR|OUTFIT|BODY|HEAD|MARKINGS|THE LAND|SKY AND LIGHT|FEEL|MOOD AND COLOR|COLOR PALETTE|[A-Z][A-Z0-9 ]+):\s*(.*)$/.exec(
        line,
      );
    if (
      headingMatch &&
      !line.startsWith("Character ") &&
      !line.startsWith("Creature ") &&
      !line.startsWith("Wide ") &&
      !line.startsWith("Product-") &&
      !line.startsWith(STYLE_REFERENCE_PROMPT_PREFIX)
    ) {
      flush();
      current = headingMatch[1]!;
      if (headingMatch[2]) buf.push(headingMatch[2]);
      continue;
    }
    const theMatch = /^(THE [A-Z0-9][A-Z0-9 -]+):\s*(.*)$/.exec(line);
    if (theMatch) {
      flush();
      current = theMatch[1]!;
      if (theMatch[2]) buf.push(theMatch[2]);
      continue;
    }
    buf.push(line);
  }
  flush();
  return sections;
}

export function normalizePromptText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(
      /@\[(?:Image|IMAGE|image)[_\s-]*(\d+)\]\((?:image_|IMAGE_)?(\d+)\)/gi,
      (_m, a: string, b: string) => `@image_${a || b}`,
    )
    .replace(/@\[(?:Image|IMAGE|image)[_\s-]*(\d+)\]/gi, (_m, n: string) => `@image_${n}`)
    .replace(/(^|\n)LOCATIONS?\s*:\s*/gi, "$1LOCATION — ")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

/** Compare two texts section-by-section for asset sheets. */
export function assetSheetSectionKeys(text: string): string[] {
  const keys: string[] = ["OPENING"];
  for (const line of text.split("\n")) {
    const m = /^([A-Z][A-Z0-9 -]+):\s*/.exec(line);
    if (
      m &&
      !line.startsWith("Character ") &&
      !line.startsWith("Creature ") &&
      !line.startsWith("Wide ") &&
      !line.startsWith("Product-") &&
      !line.startsWith(STYLE_REFERENCE_PROMPT_PREFIX)
    ) {
      keys.push(m[1]!);
    }
  }
  return keys;
}

/** Ensure generate prompts carry the style-ref instruction when an image is attached. */
export function ensureStyleReferencePrefix(
  promptText: string,
  hasStyleReference: boolean,
): string {
  const text = promptText.trim();
  if (!hasStyleReference || text.length === 0) return text;
  if (text.toLowerCase().startsWith(STYLE_REFERENCE_PROMPT_PREFIX.toLowerCase())) {
    return text;
  }
  return `${STYLE_REFERENCE_PROMPT_PREFIX} ${text}`;
}
