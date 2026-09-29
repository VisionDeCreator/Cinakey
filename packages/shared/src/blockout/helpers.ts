import type {
  BlockoutDocument,
  BlockoutProject,
  BlockoutTransform,
  Vec3,
} from "./types";
import { BLOCKOUT_SCHEMA_ID } from "./types";
import { emptyPartDocument } from "./validate";

export function blockoutTransform(
  position: Vec3 = [0, 0, 0],
  rotation: Vec3 = [0, 0, 0],
  scale: Vec3 = [1, 1, 1],
): BlockoutTransform {
  return { position, rotation, scale };
}

/** Build a fresh part document for a sequence. */
export function createPartDocument(
  project: BlockoutProject,
  sequenceId: string,
  opts?: { version?: number; parentFileId?: string; name?: string },
): BlockoutDocument {
  const doc = emptyPartDocument(project, sequenceId);
  return {
    ...doc,
    version: opts?.version ?? 1,
    ...(opts?.parentFileId ? { parentFileId: opts.parentFileId } : {}),
    name: opts?.name ?? project.title,
    title: opts?.name ?? project.title,
  };
}

/** Serialize for download / clipboard (strips nothing; pretty JSON). */
export function documentToJson(doc: BlockoutDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** Cut marker at frame, or last if past end. */
export function cutAtFrame(
  doc: BlockoutDocument,
  frame: number,
): BlockoutDocument["shots"][number] | null {
  const cuts = doc.shots;
  if (!cuts.length) return null;
  return (
    cuts.find((s) => frame >= s.start && frame < s.end) ??
    (frame >= doc.frames ? cuts[cuts.length - 1]! : null)
  );
}

/** Zoom window for a shot cut (with small pad). */
export function timelineWindowForShot(
  doc: BlockoutDocument,
  shotIdOrN: string | number,
): { start: number; end: number } | null {
  const cut =
    typeof shotIdOrN === "number"
      ? doc.shots.find((s) => s.n === shotIdOrN)
      : doc.shots.find(
          (s) => s.shotId === shotIdOrN || String(s.n) === shotIdOrN,
        );
  if (!cut) return null;
  return { start: cut.start, end: cut.end };
}

export function bumpVersion(
  doc: BlockoutDocument,
  parentFileId?: string,
): BlockoutDocument {
  return {
    ...doc,
    schema: BLOCKOUT_SCHEMA_ID,
    version: doc.version + 1,
    ...(parentFileId ? { parentFileId } : {}),
  };
}
