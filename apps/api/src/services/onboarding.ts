import { SCRIPT_SCHEMA_ID, withRuntimeEstimates } from "@cinakey/shared";
import type { ScriptDocument } from "@cinakey/shared";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../operations";
import type { Id } from "../../../../packages/backend/convex/_generated/dataModel";
import { action } from "../runtime/operation";
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

    const shell = await ctx.runMutation(
      internal.onboarding.createStarterShell,
      {
        userId,
      },
    );

    const document = starterScript();
    const { storageId } = await saveJson(ctx, document);

    await ctx.runMutation(internal.onboarding.attachStarterScript, {
      userId,
      projectId: shell.projectId,
      contentFileId: storageId,
      document,
    });

    const promptText = starterScriptPromptText();
    const structured = {
      schema: "cinakey.prompt/script/1",
      customPrompt: true,
      totalDurationSec: 30,
    };
    const structuredStore = await saveJson(ctx, structured);
    const renderedStore = await saveJson(ctx, promptText);
    await ctx.runMutation(internal.onboarding.attachStarterScriptPrompt, {
      projectId: shell.projectId,
      sequenceId: shell.sequenceId,
      structuredFileId: structuredStore.storageId,
      renderedFileId: renderedStore.storageId,
      mayaId: shell.entityIds.maya,
      jordanId: shell.entityIds.jordan,
      cafeId: shell.entityIds.cafe,
    });

    await ctx.runMutation(internal.onboarding.trackStarterCreated, {
      userId,
      projectId: shell.projectId,
      workspaceId: shell.workspaceId,
    });

    return shell;
  },
});

function starterScriptPromptText(): string {
  return [
    "REFERENCES",
    "@image_1 = Maya. Use it for her exact face, hair, green coat and proportions.",
    "@image_2 = Jordan. Use it for his exact face, hair, backpack and proportions.",
    "@image_3 = Corner Café. Use it for the exact café interior and street outside.",
    "",
    "ART STYLE — LOCKED TO THE REFERENCE IMAGES:",
    "Use the exact art style already defined in @image_1, @image_2 and @image_3 for the entire video. Warm natural light, handheld feel, soft film grain. The last frame matches the first in style.",
    "",
    "IMAGE QUALITY — ALWAYS SHARP AND CLEAN:",
    "Every frame sharp, crisp and clean. Faces stay readable.",
    "",
    "THE MAYA — @image_1, identical in every shot:",
    "Early 30s, thoughtful, wears a green coat.",
    "",
    "THE JORDAN — @image_2, identical in every shot:",
    "Late 20s, restless energy, backpack always on.",
    "",
    "LOCATION — @image_3: Sunlit corner café with wooden tables and large windows; street outside in light rain.",
    "",
    "SHOTS (30 seconds total, multi-shot, 16:9):",
    "Shot 1 (0.0s–4.0s) — Wide shot, static: Maya waits alone at a wooden table in the café.",
    "Shot 2 (4.0s–9.0s) — Medium shot, slow push: Maya says you're late again.",
    "Shot 3 (9.0s–13.0s) — Close-up, static: Jordan answers about traffic.",
    "Shot 4 (13.0s–17.0s) — Medium shot, static: Maya asks him to walk with her.",
    "Shot 5 (17.0s–23.0s) — Wide shot, pan left: They step onto the wet street in the rain.",
    "Shot 6 (23.0s–30.0s) — Medium shot, tracking: They walk together under the rain.",
    "",
    "CONSISTENCY:",
    "Maya and Jordan match their references in every shot.",
    "",
    "MOTION AND PHYSICS:",
    "Natural handheld motion; rain falls with realistic weight.",
    "",
    "LIGHTING:",
    "Warm café light; cooler daylight outside.",
    "",
    "TECHNICAL:",
    "16:9, 24fps, soft film grain, no subtitles.",
    "",
    "MUSIC:",
    "Quiet indie score under dialogue; swells slightly in the rain.",
    "",
    "AUDIO (native sound, synced to picture, no dialogue):",
    "0.0s café murmur. 4.0s soft dialogue bed. 17.0s rain and traffic.",
  ].join("\n");
}
