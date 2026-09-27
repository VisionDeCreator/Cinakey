/**
 * Versioning pattern
 * ------------------
 * User content that must be recoverable (scripts, timelines, blockout JSON)
 * is NEVER overwritten in place.
 *
 * 1. Database version rows (`scriptVersions`, `timelineVersions`):
 *    Call `insertVersion` to insert a NEW document with an optional `parentId`
 *    pointing at the previous version. Never patch content fields on an
 *    existing version row.
 *
 * 2. File-backed content (blockouts, large JSON):
 *    Call `saveJson` / storage helpers to create a NEW storage blob, then
 *    point the live record (e.g. `shots.blockoutFileId`) at the new ID.
 *    The previous blob remains addressable for rollback until GC.
 *
 * Live working records (`scenes`, `shots`, metadata) may be patched for
 * order/status/dialogue; their heavy payloads go through this pattern.
 */

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type ScriptVersionFields = {
  projectId: Id<"projects">;
  parentId?: Id<"scriptVersions">;
  format: "screenplay" | "av";
  label?: string;
  contentFileId: Id<"_storage">;
  createdBy: Id<"users">;
  createdAt: number;
};

export type TimelineVersionFields = {
  projectId: Id<"projects">;
  parentId?: Id<"timelineVersions">;
  label?: string;
  timelineFileId: Id<"_storage">;
  createdBy: Id<"users">;
  createdAt: number;
};

export async function insertVersion(
  ctx: MutationCtx,
  table: "scriptVersions",
  fields: ScriptVersionFields,
): Promise<Id<"scriptVersions">>;
export async function insertVersion(
  ctx: MutationCtx,
  table: "timelineVersions",
  fields: TimelineVersionFields,
): Promise<Id<"timelineVersions">>;
export async function insertVersion(
  ctx: MutationCtx,
  table: "scriptVersions" | "timelineVersions",
  fields: ScriptVersionFields | TimelineVersionFields,
): Promise<Id<"scriptVersions"> | Id<"timelineVersions">> {
  if (table === "scriptVersions") {
    return await ctx.db.insert("scriptVersions", fields as ScriptVersionFields);
  }
  return await ctx.db.insert("timelineVersions", fields as TimelineVersionFields);
}
