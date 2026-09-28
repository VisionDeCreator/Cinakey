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
    if (isAsset || sheet.type === "script") {
      if (sheet.status !== "out_of_date" && sheet.status !== "draft") {
        await ctx.db.patch(sheet._id, { status: "out_of_date", updatedAt: now });
        n++;
      }
    }
  }
  return n;
}

/** Mark script prompts that depend on an asset sheet. */
export async function markScriptPromptsStaleForAssetSheet(
  ctx: MutationCtx,
  assetSheetId: Id<"promptSheets">,
): Promise<number> {
  const asset = await ctx.db.get(assetSheetId);
  if (asset === null) return 0;
  const tips = await ctx.db
    .query("promptSheets")
    .withIndex("by_project_type", (q) =>
      q.eq("projectId", asset.projectId).eq("type", "script"),
    )
    .collect();
  let n = 0;
  const now = Date.now();
  for (const sheet of tips) {
    if (!sheet.isTip || sheet.isCustom) continue;
    const deps = sheet.sourceAssetSheetIds ?? [];
    if (!deps.includes(assetSheetId) && !deps.includes(asset.parentId as Id<"promptSheets">)) {
      // Also match if any tip ancestor — for simplicity check entity link via referenceMap
      continue;
    }
    if (sheet.status !== "out_of_date" && sheet.status !== "draft") {
      await ctx.db.patch(sheet._id, { status: "out_of_date", updatedAt: now });
      n++;
    }
  }
  // Broader: any script tip whose referenceMap includes this entity
  if (asset.entityId) {
    for (const sheet of tips) {
      if (!sheet.isTip || sheet.isCustom) continue;
      const hit = (sheet.referenceMap ?? []).some(
        (r) => r.entityId === asset.entityId,
      );
      if (!hit) continue;
      if (sheet.status !== "out_of_date" && sheet.status !== "draft") {
        await ctx.db.patch(sheet._id, { status: "out_of_date", updatedAt: now });
        n++;
      }
    }
  }
  return n;
}

/** Mark blockout sheet for a sequence when script or shots change. */
export async function markBlockoutStaleForSequence(
  ctx: MutationCtx,
  sequenceId: Id<"sequences">,
): Promise<number> {
  const sheets = await ctx.db
    .query("promptSheets")
    .withIndex("by_sequence", (q) => q.eq("sequenceId", sequenceId))
    .collect();
  let n = 0;
  const now = Date.now();
  for (const sheet of sheets) {
    if (!sheet.isTip || sheet.type !== "blockout" || sheet.isCustom) continue;
    if (sheet.status !== "out_of_date" && sheet.status !== "draft") {
      await ctx.db.patch(sheet._id, { status: "out_of_date", updatedAt: now });
      n++;
    }
  }
  return n;
}

/** Mark blockouts that depend on a script prompt. */
export async function markBlockoutStaleForScriptPrompt(
  ctx: MutationCtx,
  scriptPromptId: Id<"promptSheets">,
): Promise<number> {
  const script = await ctx.db.get(scriptPromptId);
  if (script === null) return 0;
  const tips = await ctx.db
    .query("promptSheets")
    .withIndex("by_project_type", (q) =>
      q.eq("projectId", script.projectId).eq("type", "blockout"),
    )
    .collect();
  let n = 0;
  const now = Date.now();
  for (const sheet of tips) {
    if (!sheet.isTip || sheet.isCustom) continue;
    if (
      sheet.sourceScriptPromptId === scriptPromptId ||
      sheet.sequenceId === script.sequenceId
    ) {
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
