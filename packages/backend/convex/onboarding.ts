import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireProjectAccess, requireUser } from "./lib/access";
import { trackEvent } from "./lib/analytics";
import { RATE_LIMITS } from "./lib/limits";
import { PROMPT_TEMPLATE_VERSION } from "./lib/promptRender";
import { assertRateLimit } from "./lib/rateLimit";
import { ensurePersonalWorkspaceForUser } from "./lib/workspaces";

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
    let t = 0;
    for (const def of shotDefs) {
      const startSec = t;
      const endSec = t + def.durationSec;
      t = endSec;
      const scriptLineKey = [
        shotIds.length + 1,
        startSec,
        endSec,
        def.shotType,
        def.cameraMove ?? "",
        def.dialogue ?? "",
      ].join("|");
      const shotId = await ctx.db.insert("shots", {
        projectId,
        sceneId: def.sceneId,
        order: def.order,
        shotType: def.shotType,
        lensMm: def.lensMm,
        cameraMove: def.cameraMove,
        durationSec: def.durationSec,
        startSec,
        endSec,
        characterIds: def.characterIds,
        locationId: def.locationId,
        dialogue: def.dialogue,
        dialogueLineId: def.dialogueLineId,
        status: "planned",
        outdated: false,
        scriptLineKey,
        createdAt: now,
        updatedAt: now,
      });
      shotIds.push(shotId);
    }

    const sequenceId = await ctx.db.insert("sequences", {
      projectId,
      order: 0,
      title: "Part 1",
      durationSec: 30,
      shotIds,
      createdAt: now,
      updatedAt: now,
    });

    for (const shotId of shotIds) {
      await ctx.db.patch(shotId, { sequenceId, updatedAt: now });
    }

    return {
      projectId,
      workspaceId,
      sceneIds: [scene1, scene2],
      shotIds,
      sequenceId,
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

export const attachStarterScriptPrompt = internalMutation({
  args: {
    projectId: v.id("projects"),
    sequenceId: v.id("sequences"),
    structuredFileId: v.id("_storage"),
    renderedFileId: v.id("_storage"),
    mayaId: v.id("entities"),
    jordanId: v.id("entities"),
    cafeId: v.id("entities"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tipId = await ctx.db.insert("promptSheets", {
      projectId: args.projectId,
      type: "script",
      sequenceId: args.sequenceId,
      structuredFileId: args.structuredFileId,
      renderedFileId: args.renderedFileId,
      templateVersion: PROMPT_TEMPLATE_VERSION,
      status: "approved",
      isCustom: true,
      version: 1,
      referenceMap: [
        { imageN: 1, entityId: args.mayaId },
        { imageN: 2, entityId: args.jordanId },
        { imageN: 3, entityId: args.cafeId },
      ],
      isTip: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.sequenceId, {
      scriptPromptId: tipId,
      updatedAt: now,
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

/** Sample Script-tab conversation for the starter trailer. */
export const seedStarterCopilot = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("copilotMessages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();
    if (existing) return;

    const now = Date.now();
    await ctx.db.insert("copilotMessages", {
      projectId: args.projectId,
      role: "user",
      content:
        "Walk me through this trailer — Maya and Jordan outside the café.",
      createdAt: now,
    });
    await ctx.db.insert("copilotMessages", {
      projectId: args.projectId,
      role: "assistant",
      content:
        "This starter opens on the Script tab with a 30s Seedance prompt for Part 1. Maya and Jordan are in Assets; sample clips are ready on Video. Tweak the prompt here, then Blockout → Video → Edit.",
      createdAt: now + 1,
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
