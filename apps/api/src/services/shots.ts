import {
  assertSheetDocument,
  assembleShotKeyframePrompt,
  type SheetDocument,
} from "@cinakey/shared";
import { v } from "convex/values";
import { internal } from "../operations";
import type {
  Doc,
  Id,
} from "../../../../packages/backend/convex/_generated/dataModel";
import { action, type ActionCtx } from "../runtime/operation";
import { loadJson } from "../../../../packages/backend/convex/storage";

async function requireActionUser(ctx: ActionCtx) {
  const { getAuthUserId } = await import("@convex-dev/auth/server");
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  return userId as Id<"users">;
}

async function loadSheetDoc(
  ctx: ActionCtx,
  sheetFileId: Id<"_storage"> | undefined,
): Promise<SheetDocument | null> {
  if (!sheetFileId) return null;
  try {
    return assertSheetDocument(await loadJson(ctx, sheetFileId));
  } catch {
    return null;
  }
}

export const getKeyframePromptContext = action({
  args: { shotId: v.id("shots") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    shot: Doc<"shots">;
    projectRules: string[];
    styleSheet: SheetDocument | null;
    characters: Array<{
      name: string;
      description?: string;
      sheet: SheetDocument | null;
      lockedReferenceAssetIds: Id<"assets">[];
    }>;
    location: {
      name: string;
      description?: string;
      sheet: SheetDocument | null;
      lockedReferenceAssetIds: Id<"assets">[];
    } | null;
    referenceAssetIds: Id<"assets">[];
    assembledPrompt: string;
  } | null> => {
    const userId = await requireActionUser(ctx);
    const shot: Doc<"shots"> | null = await ctx.runQuery(
      internal.shots.getInternal,
      { shotId: args.shotId },
    );
    if (shot === null) return null;
    await ctx.runQuery(internal.scriptVersions.assertAccess, {
      projectId: shot.projectId,
      userId,
    });

    const project: Doc<"projects"> = await ctx.runQuery(
      internal.generation.getProjectWorkspace,
      { projectId: shot.projectId },
    );

    const entities: Doc<"entities">[] = await ctx.runQuery(
      internal.shots.listEntitiesInternal,
      { projectId: shot.projectId },
    );
    const styleEntity = entities.find((e) => e.kind === "style") ?? null;
    const characterDocs = entities.filter(
      (e) => e.kind === "character" && shot.characterIds.includes(e._id),
    );
    const locationDoc = shot.locationId
      ? (entities.find((e) => e._id === shot.locationId) ?? null)
      : null;

    const styleSheet = await loadSheetDoc(ctx, styleEntity?.sheetFileId);
    const characters = await Promise.all(
      characterDocs.map(async (c) => ({
        name: c.name,
        description: c.description,
        sheet: await loadSheetDoc(ctx, c.sheetFileId),
        lockedReferenceAssetIds: c.lockedReferenceAssetIds,
      })),
    );
    const location = locationDoc
      ? {
          name: locationDoc.name,
          description: locationDoc.description,
          sheet: await loadSheetDoc(ctx, locationDoc.sheetFileId),
          lockedReferenceAssetIds: locationDoc.lockedReferenceAssetIds,
        }
      : null;

    const referenceAssetIds: Id<"assets">[] = [];
    for (const c of characters) {
      referenceAssetIds.push(...c.lockedReferenceAssetIds);
    }
    if (location) {
      referenceAssetIds.push(...location.lockedReferenceAssetIds);
    }
    if (styleEntity) {
      referenceAssetIds.push(...styleEntity.lockedReferenceAssetIds);
    }

    const assembledPrompt = assembleShotKeyframePrompt({
      shot: {
        shotType: shot.shotType,
        lensMm: shot.lensMm,
        cameraMove: shot.cameraMove,
        durationSec: shot.durationSec,
        dialogue: shot.dialogue,
        notes: shot.notes,
      },
      styleSheet,
      characters,
      location,
      rules: project.rules,
    });

    return {
      shot,
      projectRules: project.rules,
      styleSheet,
      characters,
      location,
      referenceAssetIds: [...new Set(referenceAssetIds)],
      assembledPrompt,
    };
  },
});
