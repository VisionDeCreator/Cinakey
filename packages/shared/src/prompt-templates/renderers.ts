import {
  COLOR_PALETTE_SUFFIX,
  COLOR_PALETTE_SUFFIX_ENVIRONMENT,
  COLOR_PALETTE_SUFFIX_PRODUCT,
  SCRIPT_ART_STYLE_LOCKING,
} from "./constants";
import type {
  BlockoutSheetData,
  CharacterSheetData,
  CreatureSheetData,
  EnvironmentSheetData,
  ProductSheetData,
  ScriptPromptData,
} from "./schemas";

function formatViewsList(views: string[]): string {
  if (views.length === 0) return "";
  if (views.length === 1) return views[0]!;
  if (views.length === 2) return `${views[0]} and ${views[1]}`;
  const head = views.slice(0, -1).join(", ");
  const last = views[views.length - 1]!;
  // Match examples: "..., plus two head close-ups..." when last starts with "plus"
  if (last.startsWith("plus ") || last.startsWith("and ")) {
    return `${head}, ${last}`;
  }
  return `${head}, and ${last}`;
}

function paletteLine(palette: string, suffix: string): string {
  const trimmed = palette.trim().replace(/\.\s*$/, "");
  const already =
    trimmed.toLowerCase().includes("no readable text") ||
    trimmed.toLowerCase().includes("no letters");
  if (already) return `COLOR PALETTE: ${trimmed}`;
  return `COLOR PALETTE: ${trimmed}. ${suffix}`;
}

export function renderCharacterSheet(
  data: CharacterSheetData,
  artStyleBlock: string,
): string {
  const views = formatViewsList(data.views);
  const opening = `Character reference sheet of ${data.subjectLine}, on a plain white background: ${views}. Soft ground shadows.`;
  const sigHeading = data.signatureDetail.heading.toUpperCase();
  return [
    opening,
    "",
    `ART STYLE: ${artStyleBlock.trim()}`,
    "",
    `FACE AND HAIR: ${data.faceAndHair.trim()}`,
    "",
    `OUTFIT: ${data.outfit.trim()}`,
    "",
    `${sigHeading}: ${data.signatureDetail.body.trim()}`,
    "",
    paletteLine(data.colorPalette, COLOR_PALETTE_SUFFIX),
  ].join("\n");
}

export function renderCreatureSheet(
  data: CreatureSheetData,
  artStyleBlock: string,
): string {
  const views = formatViewsList(data.views);
  const opening = `Creature design sheet of ${data.subjectLine}, on a plain white background: ${views}. Soft ground shadows.`;
  const parts = [
    opening,
    "",
    `ART STYLE: ${artStyleBlock.trim()}`,
    "",
    `BODY: ${data.body.trim()}`,
  ];
  if (data.gear) {
    parts.push(
      "",
      `${data.gear.heading.toUpperCase()}: ${data.gear.body.trim()}`,
    );
  }
  if (data.signatureDetail) {
    parts.push(
      "",
      `${data.signatureDetail.heading.toUpperCase()}: ${data.signatureDetail.body.trim()}`,
    );
  }
  parts.push("", paletteLine(data.colorPalette, COLOR_PALETTE_SUFFIX));
  return parts.join("\n");
}

export function renderEnvironmentSheet(
  data: EnvironmentSheetData,
  artStyleBlock: string,
): string {
  const opening = `Wide environment illustration of ${data.place} at ${data.timeOfDay}, seen from ${data.cameraAngle}. No people and no animals.`;
  return [
    opening,
    "",
    `ART STYLE: ${artStyleBlock.trim()}`,
    "",
    `THE LAND: ${data.theLand.trim()}`,
    "",
    `SKY AND LIGHT: ${data.skyAndLight.trim()}`,
    "",
    paletteLine(data.colorPalette, COLOR_PALETTE_SUFFIX_ENVIRONMENT),
  ].join("\n");
}

export function renderProductSheet(
  data: ProductSheetData,
  artStyleBlock: string,
): string {
  const opening = `Product-style illustration of a single ${data.objectName} on a plain white background, shown in ${data.views}. Soft ground shadows.`;
  const objHeading = data.theObject.heading.toUpperCase();
  return [
    opening,
    "",
    `ART STYLE: ${artStyleBlock.trim()}`,
    "",
    `${objHeading}: ${data.theObject.body.trim()}`,
    "",
    `FEEL: ${data.feel.trim()}`,
    "",
    paletteLine(data.colorPalette, COLOR_PALETTE_SUFFIX_PRODUCT),
  ].join("\n");
}

function formatShotTime(sec: number): string {
  return Number.isInteger(sec) ? `${sec}.0` : String(sec);
}

function renderScriptShot(shot: ScriptPromptData["shots"][number]): string {
  const start = formatShotTime(shot.startSec);
  const end = formatShotTime(shot.endSec);
  const move = shot.cameraMove?.trim();
  const framing = move
    ? `${shot.shotType}, ${move}`
    : shot.shotType;
  return `Shot ${shot.n} (${start}s–${end}s) — ${framing}: ${shot.action}`;
}

export function renderScriptPrompt(data: ScriptPromptData): string {
  const refLines = data.references.map(
    (r) =>
      `@image_${r.imageN} = ${r.entityLabel}. Use it for ${r.useFor.startsWith("its ") || r.useFor.startsWith("his ") || r.useFor.startsWith("her ") || r.useFor.startsWith("the ") ? r.useFor : `its exact ${r.useFor}`}`,
  );
  // Prefer caller-provided "Use it for ..." already in useFor
  const refsFormatted = data.references.map((r) => {
    const use = r.useFor.trim();
    if (use.toLowerCase().startsWith("use it for")) {
      return `@image_${r.imageN} = ${r.entityLabel}. ${use}`;
    }
    return `@image_${r.imageN} = ${r.entityLabel}. Use it for ${use}`;
  });
  void refLines;

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
    const headingMatch = /^(ART STYLE|FACE AND HAIR|OUTFIT|BODY|THE LAND|SKY AND LIGHT|FEEL|COLOR PALETTE|[A-Z][A-Z0-9 ]+):\s*(.*)$/.exec(
      line,
    );
    if (headingMatch && !line.startsWith("Character ") && !line.startsWith("Creature ") && !line.startsWith("Wide ") && !line.startsWith("Product-")) {
      flush();
      current = headingMatch[1]!;
      if (headingMatch[2]) buf.push(headingMatch[2]);
      continue;
    }
    // Object heading like THE RIFLE:
    const theMatch = /^(THE [A-Z0-9][A-Z0-9 -]+):\s*(.*)$/.exec(line);
    if (theMatch) {
      flush();
      current = theMatch[1]!;
      if (theMatch[2]) buf.push(theMatch[2]);
      continue;
    }
    // Signature / gear custom headings (all caps before colon)
    const capsMatch = /^([A-Z][A-Z0-9 ]+):\s*(.*)$/.exec(line);
    if (capsMatch && buf.length === 0 && current !== "OPENING") {
      // already handled above
    }
    if (capsMatch && line === lines[0]) {
      // opening line shouldn't match
    }
    buf.push(line);
  }
  flush();
  return sections;
}

export function normalizePromptText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
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
    if (m && !line.startsWith("Character ") && !line.startsWith("Creature ") && !line.startsWith("Wide ") && !line.startsWith("Product-")) {
      keys.push(m[1]!);
    }
  }
  return keys;
}
