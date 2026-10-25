/**
 * Stale / out-of-date marking for prompt sheets.
 */

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Mark all tip asset + script sheets that inject the project style. */
export async function markSheetsStaleForStyleChange(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<number> {
  const tips = await ctx.db
    .query("promptSheets")
    .withIndex("by_project_tip", (q) =>
      q.eq("projectId", projectId).eq("isTip", true),
    )
    .collect();
  let n = 0;
  const now = Date.now();
  for (const sheet of tips) {
    const isAsset =
      sheet.type === "character" ||
      sheet.type === "creature" ||
      sheet.type === "environment" ||
      sheet.type === "product";
    // Asset prompts are text-first (often isCustom); still mark style-changed.
    if (sheet.isCustom && !isAsset) continue;
    if (isAsset) {
      if (sheet.status !== "out_of_date" && sheet.status !== "draft") {
        await ctx.db.patch(sheet._id, {
          status: "out_of_date",
          updatedAt: now,
        });
        n++;
      }
    }
  }
  return n;
}
