import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
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
  table: "timelineVersions",
  fields: TimelineVersionFields,
): Promise<Id<"timelineVersions">> {
  return ctx.db.insert(table, fields);
}
