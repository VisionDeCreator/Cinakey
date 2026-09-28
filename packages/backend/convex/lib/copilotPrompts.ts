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
                  enum: ["character", "creature", "location", "prop"],
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
  {
    type: "function",
    function: {
      name: "propose_shot_list",
      description:
        "Break a scene into a planned shot list (coverage, framing, pacing). Replaces that scene's shots on Accept. Use sceneElementId from the script scene id (or live scenes summary). Prefer linking dialogueLineId when covering dialogue. User must Accept.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          sceneElementId: {
            type: "string",
            description: "Stable script scene uuid (elementId)",
          },
          shots: {
            type: "array",
            items: {
              type: "object",
              properties: {
                shotType: {
                  type: "string",
                  description:
                    "e.g. wide, medium, close-up, extreme close-up, insert, over-the-shoulder, two-shot",
                },
                lensMm: { type: "number" },
                cameraMove: {
                  type: "string",
                  description:
                    "e.g. static, pan, tilt, push, pull, tracking, handheld",
                },
                durationSec: { type: "number" },
                characterNames: {
                  type: "array",
                  items: { type: "string" },
                },
                locationName: { type: "string" },
                dialogueLineId: {
                  type: "string",
                  description: "Stable dialogue line uuid when covering a line",
                },
                dialogue: { type: "string" },
                notes: { type: "string" },
              },
              required: ["shotType", "durationSec"],
            },
          },
        },
        required: ["summary", "sceneElementId", "shots"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_story_treatment",
      description:
        "Save a story treatment (logline + structured script beats) to the Script room. Use when developing the story in the Copilot pipeline. User must Accept.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          logline: { type: "string" },
          audience: { type: "string" },
          tone: { type: "string" },
          document: SCRIPT_DOCUMENT_SCHEMA,
        },
        required: ["summary", "logline"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_style_block",
      description:
        "Propose the project ART STYLE paragraph stored on the Look Dev style sheet. Injected into every asset sheet and script prompt. User must Accept.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          artStyleBlock: {
            type: "string",
            description: "Single ART STYLE paragraph, no heading prefix",
          },
        },
        required: ["summary", "artStyleBlock"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_asset_list",
      description:
        "Propose the visual assets needed for the story (characters, creatures, locations, key props). Creates Look Dev entities on Accept.",
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
                  enum: ["character", "creature", "location", "prop"],
                },
                name: { type: "string" },
                description: { type: "string" },
                sheetType: {
                  type: "string",
                  enum: ["character", "creature", "environment", "product"],
                  description:
                    "Which prompt-sheet template to use (environment→location, product→prop)",
                },
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
      name: "propose_asset_sheet",
      description:
        "Draft a structured asset prompt sheet (character/creature/environment/product). Fill the schema fields only — the system renders the template text. User must Accept. Set approveAndGenerate true to queue GPT Image 2 after Accept.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          type: {
            type: "string",
            enum: ["character", "creature", "environment", "product"],
          },
          entityId: { type: "string" },
          entityName: { type: "string" },
          approveAndGenerate: { type: "boolean" },
          structured: {
            type: "object",
            description:
              "Schema fields for the sheet type (subjectLine/views/faceAndHair/outfit/signatureDetail/colorPalette for character; analogous for other types)",
          },
        },
        required: ["summary", "type", "structured"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_script_prompt",
      description:
        "Draft a structured Seedance script prompt for one sequence (≤30s, ≤30 refs). Cast descriptions should match approved asset sheets. On Accept creates the sequence and shots. User must Accept.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          sequenceTitle: { type: "string" },
          applyShots: {
            type: "boolean",
            description: "Default true — materialize sequence shots on Accept",
          },
          referenceMap: {
            type: "array",
            items: {
              type: "object",
              properties: {
                imageN: { type: "number" },
                entityId: { type: "string" },
              },
              required: ["imageN", "entityId"],
            },
          },
          sourceAssetSheetIds: {
            type: "array",
            items: { type: "string" },
          },
          structured: {
            type: "object",
            description: "ScriptPromptData fields (references, shots, consistency, etc.)",
          },
        },
        required: ["summary", "structured"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_blockout_sheet",
      description:
        "Draft a structured pre-viz blockout sheet for a sequence (derived from its script prompt). On Accept builds 3D blockouts for every shot. User must Accept.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          sequenceId: { type: "string" },
          sourceScriptPromptId: { type: "string" },
          applyBlockout: {
            type: "boolean",
            description: "Default true — build shot blockouts on Accept",
          },
          structured: {
            type: "object",
            description: "BlockoutSheetData (set, cast, props, light, shots)",
          },
        },
        required: ["summary", "structured"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_blockout_sheet",
      description:
        "Apply an existing approved/draft blockout sheet to build or update all shot 3D blockouts. Prefer propose_blockout_sheet with applyBlockout for new sheets.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          promptSheetId: { type: "string" },
        },
        required: ["summary", "promptSheetId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "revise_asset_sheet",
      description:
        "Targeted revision of an existing asset sheet (e.g. make the scarf red). Pass the full updated structured object for that sheet type.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          promptSheetId: { type: "string" },
          type: {
            type: "string",
            enum: ["character", "creature", "environment", "product"],
          },
          entityId: { type: "string" },
          structured: { type: "object" },
        },
        required: ["summary", "type", "structured"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_shot_prompt",
      description:
        "Rewrite the Seedance generation prompt for a single shot (same template as script prompts: REFERENCES, ART STYLE, entity blocks, one SHOTS line, CONSISTENCY, TECHNICAL, AUDIO). On Accept sets shots.generationPromptOverride. User must Accept; does not queue video.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          shotId: { type: "string" },
          promptText: {
            type: "string",
            description: "Full rewritten single-shot Seedance prompt text",
          },
        },
        required: ["summary", "shotId", "promptText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_continuity",
      description:
        "Flag continuity issues where a take (or shot) contradicts locked character/location/style sheets or project rules. Creates suggestion proposals; Accept writes notes. Does not change takes.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          shotId: { type: "string" },
          takeId: { type: "string" },
          flags: {
            type: "array",
            items: {
              type: "object",
              properties: {
                severity: {
                  type: "string",
                  enum: ["info", "warning", "error"],
                },
                message: { type: "string" },
              },
              required: ["message"],
            },
          },
        },
        required: ["summary", "flags"],
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
    "You are a film director copilot for Cinakey. Focus on coverage, framing, pacing, and how the film will shoot. Prefer the structured prompt pipeline (story treatment → asset sheets → Seedance script prompt → blockout) over free-form screenplay. Use propose_shot_list only for an existing Script-room scene's coverage table.",
  screenwriter:
    "You are a screenwriter/pipeline copilot for Cinakey. For new films and episode breakdowns, use the structured pipeline tools — NOT propose_script_edit. Start with propose_story_treatment, then propose_style_block and propose_asset_list / propose_asset_sheet. For shot-by-shot Seedance video prompts (REFERENCES, SHOTS with timings, CONSISTENCY, AUDIO…), call propose_script_prompt with full structured data. Only use propose_script_edit when the user explicitly wants a Script-room screenplay rewrite.",
  character_designer:
    "You are a character designer copilot for Cinakey. Prefer propose_asset_sheet (structured character/creature sheets) and propose_style_block over free-form image prompts. Use propose_character_details for quick Look Dev field fills; propose_image_prompt only for ad-hoc Generate panel drafts.",
}

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
  scenesSummary?: string;
  pipelineSummary?: string;
  artStyleBlock?: string;
}): string {
  const onCopilotTab = args.view === "copilot";
  const parts = [
    ROLE_PROMPTS[args.role],
    MODE_PROMPTS[args.mode],
    "Hard rule: never claim you changed the project. Tool results become proposal cards; the user Accepts, Edits, or Rejects.",
    onCopilotTab
      ? "Hard rule (Copilot tab): you are running the structured prompt PIPELINE. Do NOT call propose_script_edit for new stories or episode breakdowns — that creates a screenplay, not a Seedance prompt. Use propose_story_treatment, propose_style_block, propose_asset_list, propose_asset_sheet, propose_script_prompt, propose_blockout_sheet."
      : "Hard rule: use propose_script_edit only when the user explicitly wants a Script-room screenplay (Fountain-style scenes/beats/dialogue). For video episode / Seedance shot breakdowns, use propose_script_prompt instead.",
    "Hard rule: when drafting a Seedance script prompt or \"full episode\" / shot-by-shot breakdown, call propose_script_prompt with complete structured data: references[], castBlocks[], location, shots[] (contiguous timings from 0, every shot), consistency, motionAndPhysics, lighting, technical, music, audioCues[]. Never paste the prompt as chat prose only.",
    "Hard rule: to rewrite a single-shot Seedance prompt for regeneration, call propose_shot_prompt with shotId and full promptText. To flag continuity issues on takes vs locked sheets/rules, call check_continuity with flags[].",
    "Hard rule: asset sheets use structured fields only (subjectLine, views, faceAndHair/body, outfit/gear, signatureDetail, colorPalette, etc.) — never free-form template text. The system renders the template.",
    "Hard rule: when the user asks for a shot list table for an existing Script-room scene, call propose_shot_list with sceneElementId.",
    "Pipeline order: propose_story_treatment → propose_style_block → propose_asset_list → propose_asset_sheet (each asset) → after refs locked, propose_script_prompt (≤30s / ≤30 refs per sequence) → propose_blockout_sheet.",
    "Pipeline rule: cast blocks in script prompts must be derived from approved asset sheet details, not invented fresh.",
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
  if (args.artStyleBlock) {
    parts.push(`Project ART STYLE block:\n${args.artStyleBlock}`);
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
  if (args.scenesSummary) {
    parts.push(`Live scenes / shots:\n${args.scenesSummary}`);
  }
  if (args.pipelineSummary) {
    parts.push(`Prompt pipeline:\n${args.pipelineSummary}`);
  }
  return parts.join("\n\n");
}

/**
 * True when the user explicitly wants a Script-room screenplay
 * (propose_script_edit) — not a Seedance pipeline prompt.
 */
export function wantsScriptProposal(userContent: string): boolean {
  const text = userContent.trim();
  if (text.length === 0) return false;
  // Explicit screenplay / Script-room language
  if (
    /screenplay|fountain|av\s*script|script\s*room|rewrite\s+(the\s+)?(scene|dialogue)|dialogue\s+pass/i.test(
      text,
    )
  ) {
    return true;
  }
  // "edit the script" / "update scene 3" but not "script prompt" / "video script"
  if (
    /\b(edit|update|fix)\b.*\b(script|scene|dialogue)\b/i.test(text) &&
    !/\b(script\s*prompt|seedance|shot[- ]?by[- ]?shot|episode\s+breakdown|prompt\s+sheet)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

/** True when the user wants the structured film pipeline / Seedance breakdown. */
export function wantsPipelineProposal(userContent: string): boolean {
  const text = userContent.trim();
  if (text.length === 0) return false;
  if (
    /story|film|video|movie|episode|sequence|seedance|prompt\s*sheet|asset\s*sheet|look\s*dev|blockout|shot[- ]?by[- ]?shot|breakdown|treatment|logline|references|@image_|generate|make\s+(a|me|an)|create\s+(a|me|an)|savanna|chase|hunter/i.test(
      text,
    )
  ) {
    return true;
  }
  return text.length >= 40;
}

/** Prefer Seedance script prompt over story treatment when asking for shots. */
export function wantsScriptPromptProposal(userContent: string): boolean {
  return /\b(script\s*prompt|seedance|shot[- ]?by[- ]?shot|episode\s+breakdown|full\s+(episode|sequence|prompt|breakdown)|shot\s+breakdown|video\s+prompt|SHOTS\s*\(|@image_|shot\s+list\s+for\s+(the\s+)?(video|film|sequence))\b/i.test(
    userContent,
  );
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
