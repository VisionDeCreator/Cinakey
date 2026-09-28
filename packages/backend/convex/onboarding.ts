import { v } from "convex/values";
import { SCRIPT_SCHEMA_ID, withRuntimeEstimates } from "@cinakey/shared";
import type { ScriptDocument } from "@cinakey/shared";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { trackEvent } from "./lib/analytics";
import { RATE_LIMITS } from "./lib/limits";
import { assertRateLimit } from "./lib/rateLimit";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";
import { saveJson } from "./storage";

function starterScript(): ScriptDocument {
  return withRuntimeEstimates({
    schema: SCRIPT_SCHEMA_ID,
    format: "screenplay",
    scenes: [
      {
        id: "starter-scene-cafe",
        heading: "INT. CORNER CAFÉ - DAY",
        synopsis: "Maya waits; Jordan arrives late. They step into the rain.",
        beats: [
          {
            id: "starter-b1",
            action:
              "Warm morning light. MAYA sits by the window in a green coat, watching the door.",
            lines: [
              {
                id: "starter-l1",
                characterName: "MAYA",
                dialogue: "You're late again.",
              },
            ],
          },
          {
            id: "starter-b2",
            action: "JORDAN slides into the seat, backpack still on.",
            lines: [
              {
                id: "starter-l2",
                characterName: "JORDAN",
                parenthetical: "breathless",
                dialogue: "Traffic. I know.",
              },
              {
                id: "starter-l3",
                characterName: "MAYA",
                dialogue: "Walk with me.",
              },
            ],
          },
        ],
      },
      {
        id: "starter-scene-street",
        heading: "EXT. STREET - DAY",
        synopsis: "They leave the café into soft rain.",
        beats: [
          {
            id: "starter-b3",
            action:
              "They step onto the wet sidewalk. Rain beads on the café awning.",
            lines: [],
          },
        ],
      },
    ],
    entityLinks: [],
  });
}

/**
 * Create the guided 30s trailer starter project (script, entities, shots).
 * Client then uploads sample clips and attaches takes.
 */
export const createStarterProject = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    projectId: Id<"projects">;
    sceneIds: Id<"scenes">[];
    shotIds: Id<"shots">[];
    entityIds: {
      maya: Id<"entities">;
      jordan: Id<"entities">;
      cafe: Id<"entities">;
      style: Id<"entities">;
    };
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }

    const shell = await ctx.runMutation(internal.onboarding.createStarterShell, {
      userId,
    });

    const document = starterScript();
    const { storageId } = await saveJson(ctx, document);

    await ctx.runMutation(internal.onboarding.attachStarterScript, {
      userId,
      projectId: shell.projectId,
      contentFileId: storageId,
      document,
    });

    await ctx.runMutation(internal.onboarding.trackStarterCreated, {
      userId,
      projectId: shell.projectId,
      workspaceId: shell.workspaceId,
    });

    return shell;
  },
});

export const createStarterShell = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await assertRateLimit(
      ctx,
      `createProject:${args.userId}`,
      RATE_LIMITS.createProject.limit,
      RATE_LIMITS.createProject.windowMs,
    );

    const workspaceId = await ensurePersonalWorkspaceForUser(ctx, args.userId);
    const now = Date.now();

    const projectId = await ctx.db.insert("projects", {
      workspaceId,
      title: "Starter: 30s Trailer",
      brief: {
        logline:
          "A short café trailer: Maya confronts Jordan about being late, then they walk into the rain.",
        audience: "Indie short-film viewers",
        tone: "Warm, intimate, lightly tense",
      },
      aspectRatio: "16:9",
      fps: 24,
      targetLengthSec: 30,
      styleNotes: "Warm natural light, handheld feel, soft film grain",
      rules: [
        "No extreme close-ups of faces",
        "Keep dialogue under 15 seconds per shot",
      ],
      isStarter: true,
      createdAt: now,
      updatedAt: now,
    });

    const scene1 = await ctx.db.insert("scenes", {
      projectId,
      elementId: "starter-scene-cafe",
      order: 0,
      heading: "INT. CORNER CAFÉ - DAY",
      synopsis: "Maya waits; Jordan arrives late.",
      createdAt: now,
      updatedAt: now,
    });

    const scene2 = await ctx.db.insert("scenes", {
      projectId,
      elementId: "starter-scene-street",
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

    const style = await ctx.db.insert("entities", {
      projectId,
      kind: "style",
      name: "Project Style",
      description: "Warm natural light, handheld feel, soft film grain",
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
        dialogueLineId: undefined as string | undefined,
      },
      {
        sceneId: scene1,
        order: 1,
        shotType: "MS",
        lensMm: 35,
        cameraMove: "slow push",
        durationSec: 5,
        characterIds: [maya],
        locationId: cafe,
        dialogue: "You're late again.",
        dialogueLineId: "starter-l1",
      },
      {
        sceneId: scene1,
        order: 2,
        shotType: "CU",
        lensMm: 50,
        cameraMove: "static",
        durationSec: 4,
        characterIds: [jordan],
        locationId: cafe,
        dialogue: "Traffic. I know.",
        dialogueLineId: "starter-l2",
      },
      {
        sceneId: scene1,
        order: 3,
        shotType: "MS",
        lensMm: 35,
        cameraMove: "static",
        durationSec: 4,
        characterIds: [maya, jordan],
        locationId: cafe,
        dialogue: "Walk with me.",
        dialogueLineId: "starter-l3",
      },
      {
        sceneId: scene2,
        order: 0,
        shotType: "WS",
        lensMm: 24,
        cameraMove: "pan left",
        durationSec: 6,
        characterIds: [maya, jordan],
        locationId: cafe,
        dialogue: undefined,
        dialogueLineId: undefined,
      },
      {
        sceneId: scene2,
        order: 1,
        shotType: "MS",
        lensMm: 35,
        cameraMove: "tracking",
        durationSec: 7,
        characterIds: [maya, jordan],
        locationId: cafe,
        dialogue: undefined,
        dialogueLineId: undefined,
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
        dialogueLineId: def.dialogueLineId,
        status: "planned",
        outdated: false,
        createdAt: now,
        updatedAt: now,
      });
      shotIds.push(shotId);
    }

    return {
      projectId,
      workspaceId,
      sceneIds: [scene1, scene2],
      shotIds,
      entityIds: { maya, jordan, cafe, style },
    };
  },
});

export const attachStarterScript = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    contentFileId: v.id("_storage"),
    document: v.any(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (project === null) throw new Error("Project not found");
    const workspace = await ctx.db.get(project.workspaceId);
    if (workspace === null || workspace.ownerUserId !== args.userId) {
      throw new Error("Project access denied");
    }

    await ctx.db.insert("scriptVersions", {
      projectId: args.projectId,
      format: "screenplay",
      label: "Starter script",
      contentFileId: args.contentFileId,
      createdBy: args.userId,
      createdAt: Date.now(),
    });
  },
});

export const trackStarterCreated = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    await trackEvent(ctx, {
      name: "activation.starter_created",
      userId: args.userId,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
    });
  },
});

/** Attach a sample uploaded video as a selected take for a starter shot. */
export const attachStarterTake = mutation({
  args: {
    projectId: v.id("projects"),
    shotId: v.id("shots"),
    assetId: v.id("assets"),
    select: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    await requireProjectAccess(ctx, args.projectId);
    const project = await ctx.db.get(args.projectId);
    if (project === null || project.isStarter !== true) {
      throw new Error("Starter takes can only be attached to starter projects");
    }
    const shot = await ctx.db.get(args.shotId);
    if (shot === null || shot.projectId !== args.projectId) {
      throw new Error("Shot not found");
    }
    const asset = await ctx.db.get(args.assetId);
    if (asset === null || asset.projectId !== args.projectId) {
      throw new Error("Asset not found");
    }
    if (asset.type !== "video") {
      throw new Error("Starter take asset must be video");
    }

    const select = args.select !== false;
    const now = Date.now();

    if (select) {
      const existing = await ctx.db
        .query("takes")
        .withIndex("by_shot", (q) => q.eq("shotId", args.shotId))
        .collect();
      for (const t of existing) {
        if (t.selected) {
          await ctx.db.patch(t._id, { selected: false });
        }
      }
    }

    const takeId = await ctx.db.insert("takes", {
      projectId: args.projectId,
      shotId: args.shotId,
      assetId: args.assetId,
      selected: select,
      createdAt: now,
    });

    if (select) {
      await ctx.db.patch(args.shotId, {
        selectedTakeId: takeId,
        status: "selected",
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.assetId, {
      shotId: args.shotId,
      updatedAt: now,
    });

    return { takeId };
  },
});

export const dismissOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { onboardingDismissedAt: Date.now() });
  },
});

export const getChecklist = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const project = await ctx.db.get(args.projectId);
    if (project === null) return null;

    const [scripts, entities, shots, timelines, exports] = await Promise.all([
      ctx.db
        .query("scriptVersions")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .first(),
      ctx.db
        .query("entities")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .first(),
      ctx.db
        .query("shots")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect(),
      ctx.db
        .query("timelineVersions")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .first(),
      ctx.db
        .query("exports")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .first(),
    ]);

    const selectedTakes = shots.filter((s) => s.selectedTakeId !== undefined);
    const hasBlockout = shots.some((s) => s.blockoutFileId !== undefined);

    return {
      isStarter: project.isStarter === true,
      steps: [
        {
          id: "script",
          label: "Review the script",
          href: "script",
          done: scripts !== null,
        },
        {
          id: "assets",
          label: "Create assets",
          href: "assets",
          done: entities !== null,
        },
        {
          id: "blockout",
          label: "Open the shot list / blockout",
          href: "blockout",
          done: shots.length > 0 || hasBlockout,
        },
        {
          id: "takes",
          label: "Select takes (samples are ready)",
          href: "video",
          done: selectedTakes.length > 0,
        },
        {
          id: "edit",
          label: "Assemble and edit the timeline",
          href: "edit",
          done: timelines !== null,
        },
        {
          id: "export",
          label: "Export your video",
          href: "edit",
          done: exports !== null && exports.status === "succeeded",
        },
      ],
    };
  },
});
