import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { requireUser } from "./lib/access";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";

/**
 * Seed a demo project for the signed-in user (local/dev).
 * Creates: 1 project, 2 scenes, 5 shots, 2 characters, 1 location.
 */
export const seedDemoProject = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await seedForUser(ctx, user._id);
  },
});

/** Internal entry for tests that already know the user id. */
export const seedDemoForUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await seedForUser(ctx, args.userId);
  },
});

async function seedForUser(ctx: MutationCtx, userId: Id<"users">) {
  const workspaceId = await ensurePersonalWorkspaceForUser(ctx, userId);
  const now = Date.now();

  const projectId = await ctx.db.insert("projects", {
    workspaceId,
    title: "Demo Project",
    brief: {
      logline: "A short scene between two characters at a café.",
      audience: "Indie short-film viewers",
      tone: "Warm, intimate, lightly tense",
    },
    aspectRatio: "16:9",
    fps: 24,
    targetLengthSec: 60,
    styleNotes: "Warm natural light, handheld feel",
    rules: [
      "No extreme close-ups of faces",
      "Keep dialogue under 15 seconds per shot",
    ],
    createdAt: now,
    updatedAt: now,
  });

  const scene1 = await ctx.db.insert("scenes", {
    projectId,
    order: 0,
    heading: "INT. CAFÉ - DAY",
    synopsis: "Maya waits; Jordan arrives late.",
    createdAt: now,
    updatedAt: now,
  });

  const scene2 = await ctx.db.insert("scenes", {
    projectId,
    order: 1,
    heading: "EXT. STREET - DAY",
    synopsis: "They step outside into the rain.",
    createdAt: now,
    updatedAt: now,
  });

  const maya = await ctx.db.insert("entities", {
    projectId,
    kind: "character",
    name: "Maya",
    description: "Early 30s, thoughtful, wears a green coat.",
    lockedReferenceAssetIds: [],
    createdAt: now,
    updatedAt: now,
  });

  const jordan = await ctx.db.insert("entities", {
    projectId,
    kind: "character",
    name: "Jordan",
    description: "Late 20s, restless energy, backpack always on.",
    lockedReferenceAssetIds: [],
    createdAt: now,
    updatedAt: now,
  });

  const cafe = await ctx.db.insert("entities", {
    projectId,
    kind: "location",
    name: "Corner Café",
    description: "Sunlit corner café with wooden tables and large windows.",
    lockedReferenceAssetIds: [],
    createdAt: now,
    updatedAt: now,
  });

  const shotDefs = [
    {
      sceneId: scene1,
      order: 0,
      shotType: "WS",
      lensMm: 24,
      cameraMove: "static",
      durationSec: 4,
      characterIds: [maya],
      locationId: cafe,
      dialogue: undefined as string | undefined,
    },
    {
      sceneId: scene1,
      order: 1,
      shotType: "MS",
      lensMm: 35,
      cameraMove: "slow push",
      durationSec: 6,
      characterIds: [maya],
      locationId: cafe,
      dialogue: "You're late again.",
    },
    {
      sceneId: scene1,
      order: 2,
      shotType: "CU",
      lensMm: 50,
      cameraMove: "static",
      durationSec: 3,
      characterIds: [jordan],
      locationId: cafe,
      dialogue: "Traffic. I know.",
    },
    {
      sceneId: scene2,
      order: 0,
      shotType: "WS",
      lensMm: 24,
      cameraMove: "pan left",
      durationSec: 5,
      characterIds: [maya, jordan],
      locationId: cafe,
      dialogue: undefined,
    },
    {
      sceneId: scene2,
      order: 1,
      shotType: "MS",
      lensMm: 35,
      cameraMove: "tracking",
      durationSec: 8,
      characterIds: [maya, jordan],
      locationId: cafe,
      dialogue: "Walk with me.",
    },
  ];

  const shotIds: Id<"shots">[] = [];
  for (const def of shotDefs) {
    const shotId = await ctx.db.insert("shots", {
      projectId,
      sceneId: def.sceneId,
      order: def.order,
      shotType: def.shotType,
      lensMm: def.lensMm,
      cameraMove: def.cameraMove,
      durationSec: def.durationSec,
      characterIds: def.characterIds,
      locationId: def.locationId,
      dialogue: def.dialogue,
      status: "todo",
      createdAt: now,
      updatedAt: now,
    });
    shotIds.push(shotId);
  }

  return {
    projectId,
    sceneIds: [scene1, scene2],
    shotIds,
    entityIds: { maya, jordan, cafe },
  };
}
