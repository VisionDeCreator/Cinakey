import type { ChatToolDefinition } from "../adapters/deepseek";

const SCRIPT_DOCUMENT_SCHEMA = {
  type: "object",
  description:
    "Full cinakey.script/1.0 document. Always set schema to exactly \"cinakey.script/1.0\". Generate stable uuid-like ids for every scene, beat, and line.",
  properties: {
    schema: { type: "string", enum: ["cinakey.script/1.0"] },
    format: { type: "string", enum: ["screenplay", "av"] },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          heading: {
            type: "string",
            description: "e.g. INT. FOREST - DAY",
          },
          synopsis: { type: "string" },
          beats: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                action: {
                  type: "string",
                  description: "Stage direction / visual action",
                },
                lines: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      characterName: { type: "string" },
                      parenthetical: { type: "string" },
                      dialogue: { type: "string" },
                      audioNote: { type: "string" },
                    },
                    required: ["id", "characterName", "dialogue"],
                  },
                },
              },
              required: ["id", "lines"],
            },
          },
        },
        required: ["id", "heading", "beats"],
      },
    },
    entityLinks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entityId: { type: "string" },
          elementIds: { type: "array", items: { type: "string" } },
          kind: { type: "string", enum: ["character", "location", "prop"] },
          nameAtLink: { type: "string" },
        },
      },
    },
  },
  required: ["schema", "format", "scenes", "entityLinks"],
} as const;

export const COPILOT_TOOLS: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "propose_script_edit",
      description:
        "REQUIRED whenever you draft, rewrite, expand, or structure a script/story into scenes. Submits a proposal the user must Accept — nothing is applied until they accept. Prefer keeping stable scene/beat/line ids when rewriting an existing script.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Short human-readable summary of the change",
          },
          document: SCRIPT_DOCUMENT_SCHEMA,
        },
        required: ["summary", "document"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_entities",
      description:
        "Propose character, location, or prop look-dev entities to create or update. User must Accept.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          entities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: {
                  type: "string",
                  enum: ["character", "location", "prop"],
                },
                name: { type: "string" },
                description: { type: "string" },
              },
              required: ["kind", "name"],
            },
          },
        },
        required: ["summary", "entities"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_rules",
      description:
        "Propose additions, removals, or replacements to the project rules list. User must Accept.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          add: { type: "array", items: { type: "string" } },
          remove: { type: "array", items: { type: "string" } },
          replace: { type: "array", items: { type: "string" } },
        },
        required: ["summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_character_details",
      description:
        "Fill character sheet fields (look, age, build, wardrobe, personality, voiceNotes) from the script or conversation. Prefer the selected entity when selectionIds includes an entity id. User must Accept.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          entityId: {
            type: "string",
            description: "Convex entity id when known from selection",
          },
          entityName: {
            type: "string",
            description: "Character name if entityId unknown",
          },
          fields: {
            type: "object",
            properties: {
              look: { type: "string" },
              age: { type: "string" },
              build: { type: "string" },
              wardrobe: { type: "string" },
              personality: { type: "string" },
              voiceNotes: { type: "string" },
              description: {
                type: "string",
                description: "Short entity summary",
              },
            },
          },
        },
        required: ["summary", "fields"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_image_prompt",
      description:
        "Propose an image generation prompt for the current look-dev entity sheet. Writes draftPrompt on Accept — does not run generation. User must Accept.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          entityId: { type: "string" },
          entityName: { type: "string" },
          prompt: {
            type: "string",
            description: "Full image prompt for the sheet Generate panel",
          },
        },
        required: ["summary", "prompt"],
      },
    },
  },
];

export type CopilotRole =
  | "director"
  | "screenwriter"
  | "character_designer";

export type CopilotMode =
  | "brainstorm"
  | "critique"
  | "pacing"
  | "continuity";

const ROLE_PROMPTS: Record<CopilotRole, string> = {
  director:
    "You are a film director copilot for Cinakey. Focus on coverage, framing, pacing, and how the script will shoot. Suggest concrete shot ideas when helpful, but do not invent production tools that are not available — use propose_* tools only.",
  screenwriter:
    "You are a screenwriter copilot for Cinakey. Draft and rewrite scripts in a clear cinematic voice, hit target runtime when asked, and preserve stable scene/beat/line ids when editing. ALWAYS call propose_script_edit to put scenes into the project — never only paste a screenplay in chat text.",
  character_designer:
    "You are a character designer copilot for Cinakey. Develop look, backstory, personality, wardrobe, and voice. Use propose_character_details to fill sheet fields from the script, propose_image_prompt for generation prompts, and propose_entities for new character/location/prop cards. Only use propose_script_edit when dialogue or action must change to match the design.",
};

const MODE_PROMPTS: Record<CopilotMode, string> = {
  brainstorm: "Mode: brainstorm — explore options freely; generate alternatives.",
  critique:
    "Mode: critique — identify what is weak, unclear, or overlong; be specific.",
  pacing:
    "Mode: pacing — compare runtime estimates to the project target length; suggest cuts or expansions.",
  continuity:
    "Mode: continuity — check character names, locations, props, and rules for contradictions.",
};

export function buildSystemPrompt(args: {
  role: CopilotRole;
  mode: CopilotMode;
  brief?: { logline: string; audience?: string; tone?: string } | null;
  rules: string[];
  targetLengthSec?: number;
  view: string;
  selectionIds: string[];
  scriptSummary?: string;
  entitiesSummary?: string;
}): string {
  const parts = [
    ROLE_PROMPTS[args.role],
    MODE_PROMPTS[args.mode],
    "Hard rule: never claim you changed the project. Tool results become proposal cards; the user Accepts, Edits, or Rejects.",
    "Hard rule: when the user describes a video, film, story, or asks you to draft/write/structure a script — you MUST call propose_script_edit with a full cinakey.script/1.0 document containing scenes, beats, and dialogue lines. A chat-only outline does not update the Script room.",
    "Hard rule: document.schema must be exactly \"cinakey.script/1.0\". Include format (\"screenplay\" or \"av\"), scenes[], and entityLinks[] (may be empty).",
    `Current view: ${args.view}.`,
  ];
  if (args.selectionIds.length > 0) {
    parts.push(`Selection ids: ${args.selectionIds.join(", ")}.`);
  }
  if (args.brief) {
    parts.push(
      `Brief logline: ${args.brief.logline}` +
        (args.brief.audience ? ` Audience: ${args.brief.audience}.` : "") +
        (args.brief.tone ? ` Tone: ${args.brief.tone}.` : ""),
    );
  }
  if (args.targetLengthSec !== undefined) {
    parts.push(`Target length: ${args.targetLengthSec} seconds.`);
  }
  if (args.rules.length > 0) {
    parts.push(`Project rules:\n- ${args.rules.join("\n- ")}`);
  } else {
    parts.push("Project rules: (none yet).");
  }
  if (args.scriptSummary) {
    parts.push(`Current script:\n${args.scriptSummary}`);
  }
  if (args.entitiesSummary) {
    parts.push(`Entities:\n${args.entitiesSummary}`);
  }
  return parts.join("\n\n");
}

/** True when this turn should produce a propose_script_edit tool call. */
export function wantsScriptProposal(
  userContent: string,
  scriptHasScenes: boolean,
): boolean {
  const text = userContent.trim();
  if (text.length === 0) return false;
  if (
    /script|draft|write|rewrite|scene|screenplay|storyboard|story|film|video|movie|make|create|outline|plot|chase|sequence/i.test(
      text,
    )
  ) {
    return true;
  }
  // Empty script + a substantial description → treat as a draft request.
  if (!scriptHasScenes && text.length >= 40) {
    return true;
  }
  return false;
}

export function scriptSummaryFromDocument(doc: {
  scenes: Array<{
    heading: string;
    estimatedDurationSec?: number;
    beats: Array<{
      action?: string;
      lines: Array<{ characterName: string; dialogue: string }>;
    }>;
  }>;
  totalEstimatedDurationSec?: number;
  format: string;
}): string {
  const lines: string[] = [
    `Format: ${doc.format}. Estimated total: ${doc.totalEstimatedDurationSec ?? "?"}s.`,
  ];
  doc.scenes.forEach((scene, i) => {
    lines.push(
      `Scene ${i + 1}: ${scene.heading} (~${scene.estimatedDurationSec ?? "?"}s)`,
    );
    for (const beat of scene.beats) {
      if (beat.action) lines.push(`  Action: ${beat.action.slice(0, 200)}`);
      for (const line of beat.lines) {
        lines.push(
          `  ${line.characterName}: ${line.dialogue.slice(0, 160)}`,
        );
      }
    }
  });
  const text = lines.join("\n");
  return text.length > 6000 ? `${text.slice(0, 6000)}\n…` : text;
}
