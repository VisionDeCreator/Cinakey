/**
 * Normalize LLM tool payloads into a valid cinakey.script/1.0 document.
 * Models often omit schema/ids/entityLinks — repair rather than drop the proposal.
 */

import {
  SCRIPT_SCHEMA_ID,
  newScriptElementId,
  withRuntimeEstimates,
  type ScriptBeat,
  type ScriptDialogueLine,
  type ScriptDocument,
  type ScriptScene,
} from "@cinakey/shared";

export function normalizeProposedScript(raw: unknown): ScriptDocument | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const scenesRaw = Array.isArray(obj.scenes)
    ? obj.scenes
    : Array.isArray(obj.Scenes)
      ? obj.Scenes
      : null;
  if (scenesRaw === null || scenesRaw.length === 0) return null;

  const scenes: ScriptScene[] = [];
  for (const sceneRaw of scenesRaw) {
    if (sceneRaw === null || typeof sceneRaw !== "object") continue;
    const s = sceneRaw as Record<string, unknown>;
    const heading =
      typeof s.heading === "string" && s.heading.trim().length > 0
        ? s.heading.trim()
        : typeof s.title === "string"
          ? s.title.trim()
          : "INT. LOCATION - DAY";

    const beatsRaw = Array.isArray(s.beats)
      ? s.beats
      : Array.isArray(s.Beats)
        ? s.Beats
        : [];

    const beats: ScriptBeat[] = [];
    if (beatsRaw.length === 0) {
      // Flatten common alternate shapes: action + dialogue at scene level.
      const action =
        typeof s.action === "string"
          ? s.action
          : typeof s.description === "string"
            ? s.description
            : undefined;
      const linesRaw = Array.isArray(s.lines)
        ? s.lines
        : Array.isArray(s.dialogue)
          ? s.dialogue
          : [];
      beats.push({
        id: typeof s.id === "string" ? `${s.id}-beat` : newScriptElementId(),
        action,
        lines: normalizeLines(linesRaw),
      });
    } else {
      for (const beatRaw of beatsRaw) {
        if (beatRaw === null || typeof beatRaw !== "object") continue;
        const b = beatRaw as Record<string, unknown>;
        beats.push({
          id:
            typeof b.id === "string" && b.id.length > 0
              ? b.id
              : newScriptElementId(),
          label: typeof b.label === "string" ? b.label : undefined,
          action: typeof b.action === "string" ? b.action : undefined,
          lines: normalizeLines(
            Array.isArray(b.lines)
              ? b.lines
              : Array.isArray(b.dialogue)
                ? b.dialogue
                : [],
          ),
        });
      }
    }

    scenes.push({
      id:
        typeof s.id === "string" && s.id.length > 0
          ? s.id
          : newScriptElementId(),
      heading,
      synopsis: typeof s.synopsis === "string" ? s.synopsis : undefined,
      beats,
    });
  }

  if (scenes.length === 0) return null;

  const format = obj.format === "av" ? "av" : "screenplay";
  const entityLinks = Array.isArray(obj.entityLinks)
    ? (obj.entityLinks as ScriptDocument["entityLinks"]).filter(
        (l) =>
          l &&
          typeof l === "object" &&
          typeof (l as { entityId?: unknown }).entityId === "string",
      )
    : [];

  return withRuntimeEstimates({
    schema: SCRIPT_SCHEMA_ID,
    format,
    scenes,
    entityLinks,
  });
}

function normalizeLines(raw: unknown[]): ScriptDialogueLine[] {
  const lines: ScriptDialogueLine[] = [];
  for (const lineRaw of raw) {
    if (typeof lineRaw === "string") {
      const trimmed = lineRaw.trim();
      if (!trimmed) continue;
      const colon = trimmed.indexOf(":");
      if (colon > 0 && colon < 40) {
        lines.push({
          id: newScriptElementId(),
          characterName: trimmed.slice(0, colon).trim().toUpperCase(),
          dialogue: trimmed.slice(colon + 1).trim(),
        });
      } else {
        lines.push({
          id: newScriptElementId(),
          characterName: "NARRATOR",
          dialogue: trimmed,
        });
      }
      continue;
    }
    if (lineRaw === null || typeof lineRaw !== "object") continue;
    const l = lineRaw as Record<string, unknown>;
    const characterName =
      typeof l.characterName === "string"
        ? l.characterName
        : typeof l.character === "string"
          ? l.character
          : typeof l.speaker === "string"
            ? l.speaker
            : "CHARACTER";
    const dialogue =
      typeof l.dialogue === "string"
        ? l.dialogue
        : typeof l.text === "string"
          ? l.text
          : typeof l.line === "string"
            ? l.line
            : "";
    if (!dialogue.trim() && !characterName.trim()) continue;
    lines.push({
      id:
        typeof l.id === "string" && l.id.length > 0
          ? l.id
          : newScriptElementId(),
      characterName: characterName.trim() || "CHARACTER",
      parenthetical:
        typeof l.parenthetical === "string" ? l.parenthetical : undefined,
      dialogue: dialogue.trim(),
      audioNote: typeof l.audioNote === "string" ? l.audioNote : undefined,
    });
  }
  return lines;
}
