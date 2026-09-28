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
        "Draft or rewrite a Script-room screenplay (cinakey.script/1.0). Submits a proposal the user must Accept. Prefer stable scene/beat/line ids when rewriting.",
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
      name: "write_or_revise_asset_prompt",
      description:
        "Write or update the full Phase 7C asset prompt template text for a character, creature, environment, or product. Applies immediately (no Accept card). Infer assetType from context — never ask the user to pick a type. Include ART STYLE, COLOR PALETTE, and type-specific sections (FACE AND HAIR + OUTFIT for character; BODY for creature; THE LAND or SKY AND LIGHT for environment; FEEL or THE OBJECT for product).",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          assetType: {
            type: "string",
            enum: ["character", "creature", "environment", "product"],
          },
          entityId: { type: "string" },
          entityName: { type: "string" },
          promptText: {
            type: "string",
            description: "Full rendered prompt sheet text",
          },
        },
        required: ["summary", "assetType", "promptText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_rules",
      description:
        "Update project rules immediately (add, remove, or replace lines). Do not ask the user to Accept.",
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
      name: "generate_image",
      description:
        "Queue GPT Image 2 for an asset prompt sheet. Creates a proposal with estimated credits; the user Accepts to run generation. Requires an existing prompt sheet (use write_or_revise_asset_prompt first if missing).",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          promptSheetId: { type: "string" },
          entityId: {
            type: "string",
            description: "Optional — resolve latest tip sheet for this entity",
          },
        },
        required: ["summary"],
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

/** Normalize legacy view names from older clients. */
export function normalizeCopilotView(view: string): string {
  if (view === "look-dev") return "assets";
  if (view === "shots") return "video";
  if (view === "overview") return "copilot";
  return view;
}

export function buildSystemPrompt(args: {
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
  const view = normalizeCopilotView(args.view);
  const parts = [
    "You are Cinakey's production copilot — one assistant for script, asset prompts, Seedance script prompts, blockout, shots, and continuity.",
    "Hard rule: never claim you changed the project unless a direct tool (write_or_revise_asset_prompt, update_rules) succeeded. Structural edits use proposal cards; the user Accepts, Edits, or Rejects.",
    "Hard rule: for character/creature/environment/product look-dev, call write_or_revise_asset_prompt with full Phase 7C template text. Infer assetType from the user's language; never ask them to pick a type. Create or match entities via entityName/entityId.",
    "Hard rule: use propose_script_edit only when the user wants a Script-room screenplay. For Seedance / video episode breakdowns, use propose_script_prompt with complete structured data (references, castBlocks, location, shots with contiguous timings, consistency, audio…).",
    "Hard rule: project rules changes go through update_rules (immediate). Do not use proposals for rules.",
    "Hard rule: image generation uses generate_image after a prompt sheet exists; mention credit cost — user Accepts the proposal to run.",
    "Hard rule: propose_story_treatment for story development; propose_style_block for project ART STYLE; propose_shot_list for Script-room scene coverage; propose_shot_prompt for single-shot rewrites; check_continuity for take/sheet mismatches.",
    `Current view: ${view}.`,
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
