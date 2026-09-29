export * from "./types";
export * from "./validate";
export * from "./migrate";
export * from "./bridge";
export * from "./helpers";
export * from "./engine";
export * from "./director";
export * from "./staging";

import type { BlockoutDocument, BlockoutProject } from "./types";
import { emptyPartDocument } from "./validate";

/** @deprecated Theatre.js removed in Phase 11D */
export const BLOCKOUT_THEATRE_SHEET_ID = "Shot";
/** @deprecated Theatre.js removed in Phase 11D */
export const THEATRE_DEFINITION_VERSION = "0.4.0";

/** @deprecated Theatre.js removed in Phase 11D */
export type TheatreProjectState = { definitionVersion: string };

/** @deprecated Theatre.js removed in Phase 11D */
export function buildTheatreProjectState(_input: unknown): TheatreProjectState {
  return { definitionVersion: THEATRE_DEFINITION_VERSION };
}

/** @deprecated Theatre.js removed in Phase 11D */
export function readTheatreTracks(
  _projectState: unknown,
  _nodes: unknown,
  _sheetId?: string,
): Record<string, unknown[]> {
  return {};
}

export function normalizeKeyframes<T extends { t: number }>(
  keyframes: T[],
): T[] {
  const byTime = new Map<number, T>();
  for (const k of keyframes) {
    const t = Math.round(k.t * 1000) / 1000;
    byTime.set(t, { ...k, t } as T);
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** @deprecated Use part documents; returns input unchanged. */
export function finalizeShot(shot: unknown): unknown {
  return shot;
}

/** @deprecated Theatre.js removed */
export function tracksFromShot(_shot: unknown): Record<string, unknown[]> {
  return {};
}

/** @deprecated Prefer createPartDocument / emptyPartDocument */
export function singleShotDocument(
  project: BlockoutProject,
  _scene: { id: string; order: number; heading?: string },
  _shot: unknown,
  version = 1,
  parentFileId?: string,
): BlockoutDocument {
  const doc = emptyPartDocument(project);
  return {
    ...doc,
    version,
    ...(parentFileId ? { parentFileId } : {}),
  };
}

export function allShots(doc: BlockoutDocument) {
  return doc.shots;
}

export function mergeBlockoutDocuments(
  docs: BlockoutDocument[],
  project: BlockoutProject,
): BlockoutDocument {
  if (docs.length === 0) return emptyPartDocument(project);
  return { ...docs[0]!, project, version: 1 };
}

export function extractShotForImport(
  doc: BlockoutDocument,
  _target: { id: string; sceneId: string; order: number },
  _sourceShotId?: string,
): BlockoutDocument {
  return doc;
}
