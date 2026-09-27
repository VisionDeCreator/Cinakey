/** Versioned screenplay / A/V script document (cinakey.script/1.0). */

export const SCRIPT_SCHEMA_ID = "cinakey.script/1.0" as const;

export type ScriptFormat = "screenplay" | "av";

export type ScriptEntityKind = "character" | "location" | "prop";

export type ScriptDialogueLine = {
  id: string;
  characterId?: string;
  characterName: string;
  parenthetical?: string;
  dialogue: string;
  /** A/V audio-column note (optional in screenplay mode). */
  audioNote?: string;
};

export type ScriptBeat = {
  id: string;
  label?: string;
  /** Stage direction / A/V video column. */
  action?: string;
  lines: ScriptDialogueLine[];
};

export type ScriptScene = {
  id: string;
  heading: string;
  synopsis?: string;
  estimatedDurationSec?: number;
  beats: ScriptBeat[];
};

export type ScriptEntityLink = {
  entityId: string;
  elementIds: string[];
  kind: ScriptEntityKind;
  nameAtLink: string;
};

export type ScriptDocument = {
  schema: typeof SCRIPT_SCHEMA_ID;
  format: ScriptFormat;
  scenes: ScriptScene[];
  entityLinks: ScriptEntityLink[];
  /** Roll-up of per-scene estimates (seconds). */
  totalEstimatedDurationSec?: number;
};

export type ScriptRuntimeEstimate = {
  totalSec: number;
  perScene: Array<{ sceneId: string; durationSec: number }>;
};

/** Spoken words per minute for dialogue timing. */
export const DIALOGUE_WPM = 150;

/** Seconds added per action beat with non-empty action text. */
export const ACTION_BEAT_PADDING_SEC = 3;

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

export function estimateSceneDurationSec(scene: ScriptScene): number {
  let dialogueWords = 0;
  let actionBeats = 0;
  for (const beat of scene.beats) {
    if (beat.action?.trim()) {
      actionBeats += 1;
      dialogueWords += wordCount(beat.action);
    }
    for (const line of beat.lines) {
      dialogueWords += wordCount(line.dialogue);
      if (line.audioNote) {
        dialogueWords += wordCount(line.audioNote);
      }
    }
  }
  const dialogueSec = (dialogueWords / DIALOGUE_WPM) * 60;
  const paddingSec = actionBeats * ACTION_BEAT_PADDING_SEC;
  return Math.max(1, Math.round(dialogueSec + paddingSec));
}

export function estimateScriptRuntime(doc: ScriptDocument): ScriptRuntimeEstimate {
  const perScene = doc.scenes.map((scene) => ({
    sceneId: scene.id,
    durationSec: estimateSceneDurationSec(scene),
  }));
  const totalSec = perScene.reduce((sum, s) => sum + s.durationSec, 0);
  return { totalSec, perScene };
}

/** Apply runtime estimates onto a copy of the document. */
export function withRuntimeEstimates(doc: ScriptDocument): ScriptDocument {
  const { totalSec, perScene } = estimateScriptRuntime(doc);
  const byId = new Map(perScene.map((p) => [p.sceneId, p.durationSec]));
  return {
    ...doc,
    totalEstimatedDurationSec: totalSec,
    scenes: doc.scenes.map((scene) => ({
      ...scene,
      estimatedDurationSec: byId.get(scene.id) ?? estimateSceneDurationSec(scene),
    })),
  };
}

export function createEmptyScript(format: ScriptFormat = "screenplay"): ScriptDocument {
  return {
    schema: SCRIPT_SCHEMA_ID,
    format,
    scenes: [],
    entityLinks: [],
    totalEstimatedDurationSec: 0,
  };
}

export function isScriptDocument(value: unknown): value is ScriptDocument {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.schema === SCRIPT_SCHEMA_ID &&
    (v.format === "screenplay" || v.format === "av") &&
    Array.isArray(v.scenes) &&
    Array.isArray(v.entityLinks)
  );
}

export function assertScriptDocument(value: unknown): ScriptDocument {
  if (!isScriptDocument(value)) {
    throw new Error("Invalid cinakey.script/1.0 document");
  }
  return value;
}

export function normalizeEntityName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

/** Collect unique character names from dialogue lines (order of first appearance). */
export function extractCharacterNames(doc: ScriptDocument): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const scene of doc.scenes) {
    for (const beat of scene.beats) {
      for (const line of beat.lines) {
        const key = normalizeEntityName(line.characterName);
        if (key.length === 0 || seen.has(key)) continue;
        seen.add(key);
        names.push(line.characterName.trim());
      }
    }
  }
  return names;
}

/** Parse location-ish tokens from scene headings (INT./EXT. LOCATION - TIME). */
export function extractLocationNames(doc: ScriptDocument): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const scene of doc.scenes) {
    const heading = scene.heading.trim();
    const match = heading.match(
      /^(?:INT\.?|EXT\.?|I\/E\.?|INT\/EXT\.?)\s+(.+?)(?:\s+[-–—]\s+.+)?$/i,
    );
    const raw = match?.[1]?.trim() ?? heading;
    const key = normalizeEntityName(raw);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    names.push(raw);
  }
  return names;
}

export type ScriptDiffOp =
  | { op: "add"; path: string; value: string }
  | { op: "remove"; path: string; value: string }
  | { op: "change"; path: string; before: string; after: string };

function lineText(line: ScriptDialogueLine): string {
  const parts = [line.characterName.toUpperCase()];
  if (line.parenthetical) parts.push(`(${line.parenthetical})`);
  parts.push(line.dialogue);
  if (line.audioNote) parts.push(`[audio: ${line.audioNote}]`);
  return parts.join("\n");
}

function beatText(beat: ScriptBeat): string {
  const parts: string[] = [];
  if (beat.label) parts.push(`[${beat.label}]`);
  if (beat.action) parts.push(beat.action);
  for (const line of beat.lines) {
    parts.push(lineText(line));
  }
  return parts.join("\n");
}

function sceneText(scene: ScriptScene): string {
  const parts = [scene.heading];
  if (scene.synopsis) parts.push(scene.synopsis);
  for (const beat of scene.beats) {
    parts.push(beatText(beat));
  }
  return parts.join("\n\n");
}

/** Structural diff aligned by stable element IDs. */
export function diffScripts(
  before: ScriptDocument,
  after: ScriptDocument,
): ScriptDiffOp[] {
  const ops: ScriptDiffOp[] = [];
  const beforeScenes = new Map(before.scenes.map((s) => [s.id, s]));
  const afterScenes = new Map(after.scenes.map((s) => [s.id, s]));

  for (const [id, scene] of afterScenes) {
    const prev = beforeScenes.get(id);
    if (!prev) {
      ops.push({ op: "add", path: `scene:${id}`, value: sceneText(scene) });
      continue;
    }
    diffScene(prev, scene, ops);
  }
  for (const [id, scene] of beforeScenes) {
    if (!afterScenes.has(id)) {
      ops.push({ op: "remove", path: `scene:${id}`, value: sceneText(scene) });
    }
  }

  if (before.format !== after.format) {
    ops.push({
      op: "change",
      path: "format",
      before: before.format,
      after: after.format,
    });
  }
  return ops;
}

function diffScene(
  before: ScriptScene,
  after: ScriptScene,
  ops: ScriptDiffOp[],
): void {
  const base = `scene:${before.id}`;
  if (before.heading !== after.heading) {
    ops.push({
      op: "change",
      path: `${base}.heading`,
      before: before.heading,
      after: after.heading,
    });
  }
  if ((before.synopsis ?? "") !== (after.synopsis ?? "")) {
    ops.push({
      op: "change",
      path: `${base}.synopsis`,
      before: before.synopsis ?? "",
      after: after.synopsis ?? "",
    });
  }

  const beforeBeats = new Map(before.beats.map((b) => [b.id, b]));
  const afterBeats = new Map(after.beats.map((b) => [b.id, b]));

  for (const [id, beat] of afterBeats) {
    const prev = beforeBeats.get(id);
    if (!prev) {
      ops.push({
        op: "add",
        path: `${base}.beat:${id}`,
        value: beatText(beat),
      });
      continue;
    }
    diffBeat(prev, beat, `${base}.beat:${id}`, ops);
  }
  for (const [id, beat] of beforeBeats) {
    if (!afterBeats.has(id)) {
      ops.push({
        op: "remove",
        path: `${base}.beat:${id}`,
        value: beatText(beat),
      });
    }
  }
}

function diffBeat(
  before: ScriptBeat,
  after: ScriptBeat,
  base: string,
  ops: ScriptDiffOp[],
): void {
  if ((before.label ?? "") !== (after.label ?? "")) {
    ops.push({
      op: "change",
      path: `${base}.label`,
      before: before.label ?? "",
      after: after.label ?? "",
    });
  }
  if ((before.action ?? "") !== (after.action ?? "")) {
    ops.push({
      op: "change",
      path: `${base}.action`,
      before: before.action ?? "",
      after: after.action ?? "",
    });
  }

  const beforeLines = new Map(before.lines.map((l) => [l.id, l]));
  const afterLines = new Map(after.lines.map((l) => [l.id, l]));

  for (const [id, line] of afterLines) {
    const prev = beforeLines.get(id);
    if (!prev) {
      ops.push({ op: "add", path: `${base}.line:${id}`, value: lineText(line) });
      continue;
    }
    const prevText = lineText(prev);
    const nextText = lineText(line);
    if (prevText !== nextText) {
      ops.push({
        op: "change",
        path: `${base}.line:${id}`,
        before: prevText,
        after: nextText,
      });
    }
  }
  for (const [id, line] of beforeLines) {
    if (!afterLines.has(id)) {
      ops.push({
        op: "remove",
        path: `${base}.line:${id}`,
        value: lineText(line),
      });
    }
  }
}

/** Flat text for side-by-side fallback display. */
export function scriptToPlainText(doc: ScriptDocument): string {
  return doc.scenes.map(sceneText).join("\n\n===\n\n");
}

/** Dialogue line IDs present in a scene (for outdated-shot detection). */
export function sceneDialogueLineIds(scene: ScriptScene): Set<string> {
  const ids = new Set<string>();
  for (const beat of scene.beats) {
    for (const line of beat.lines) {
      ids.add(line.id);
    }
  }
  return ids;
}

export function dialogueLineSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

/** Simple id for client/server element ids. */
export function newScriptElementId(): string {
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
