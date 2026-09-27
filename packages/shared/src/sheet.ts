/** Versioned look-dev sheet document (cinakey.sheet/1.0). */

export const SHEET_SCHEMA_ID = "cinakey.sheet/1.0" as const;

export type EntityKind = "character" | "location" | "prop" | "style";

export type IdentitySlotKey =
  | "front"
  | "threeQuarter"
  | "profile"
  | "fullBody";

export const IDENTITY_SLOT_KEYS: IdentitySlotKey[] = [
  "front",
  "threeQuarter",
  "profile",
  "fullBody",
];

/** Framing suffixes appended when generating an identity-set view. */
export const IDENTITY_SLOT_PROMPTS: Record<IdentitySlotKey, string> = {
  front: "front view portrait, facing camera, neutral expression",
  threeQuarter: "three-quarter view portrait, slight turn, neutral expression",
  profile: "side profile portrait, looking left, neutral expression",
  fullBody: "full body standing view, head to toe, neutral pose",
};

export const IDENTITY_SLOT_LABELS: Record<IdentitySlotKey, string> = {
  front: "Front",
  threeQuarter: "Three-quarter",
  profile: "Profile",
  fullBody: "Full body",
};

export type IdentitySlots = {
  front?: string;
  threeQuarter?: string;
  profile?: string;
  fullBody?: string;
};

export type ExpressionSlot = {
  label: string;
  assetId: string;
};

export type SheetDocument = {
  schema: typeof SHEET_SCHEMA_ID;
  entityKind: EntityKind;
  version: number;
  /** Previous sheet storage id (version chain). */
  parentFileId?: string;
  // Character fields
  look?: string;
  age?: string;
  build?: string;
  wardrobe?: string;
  personality?: string;
  voiceNotes?: string;
  identitySlots?: IdentitySlots;
  expressionSlots?: ExpressionSlot[];
  // Location / prop
  notes?: string;
  heroAssetIds?: string[];
  // Style
  palette?: string;
  lighting?: string;
  lensLook?: string;
  filmGrain?: string;
  mood?: string;
  moodReferenceAssetIds?: string[];
  // Generation draft (copilot / UI)
  draftPrompt?: string;
};

export function createEmptySheet(entityKind: EntityKind): SheetDocument {
  return {
    schema: SHEET_SCHEMA_ID,
    entityKind,
    version: 1,
  };
}

export function isSheetDocument(value: unknown): value is SheetDocument {
  if (value === null || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  return (
    doc.schema === SHEET_SCHEMA_ID &&
    typeof doc.entityKind === "string" &&
    typeof doc.version === "number"
  );
}

export function assertSheetDocument(value: unknown): SheetDocument {
  if (!isSheetDocument(value)) {
    throw new Error("Invalid cinakey.sheet/1.0 document");
  }
  return value;
}

/** Collect currently locked asset ids from sheet slots. */
export function lockedIdsFromSheet(sheet: SheetDocument): string[] {
  const ids = new Set<string>();
  const slots = sheet.identitySlots;
  if (slots) {
    for (const key of IDENTITY_SLOT_KEYS) {
      const id = slots[key];
      if (id) ids.add(id);
    }
  }
  for (const expr of sheet.expressionSlots ?? []) {
    if (expr.assetId) ids.add(expr.assetId);
  }
  for (const id of sheet.heroAssetIds ?? []) {
    if (id) ids.add(id);
  }
  for (const id of sheet.moodReferenceAssetIds ?? []) {
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Merge a partial patch into a sheet, bumping version and parent. */
export function mergeSheet(
  current: SheetDocument,
  patch: Partial<SheetDocument>,
  parentFileId?: string,
): SheetDocument {
  const next: SheetDocument = {
    ...current,
    ...patch,
    schema: SHEET_SCHEMA_ID,
    entityKind: current.entityKind,
    version: current.version + 1,
    parentFileId: parentFileId ?? current.parentFileId,
  };
  // Nested objects: replace when provided (callers pass full merged values)
  if (patch.identitySlots !== undefined) {
    next.identitySlots = patch.identitySlots;
  }
  if (patch.expressionSlots !== undefined) {
    next.expressionSlots = patch.expressionSlots;
  }
  if (patch.heroAssetIds !== undefined) {
    next.heroAssetIds = patch.heroAssetIds;
  }
  if (patch.moodReferenceAssetIds !== undefined) {
    next.moodReferenceAssetIds = patch.moodReferenceAssetIds;
  }
  return next;
}

function joinParts(parts: Array<string | undefined | null>): string {
  return parts
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .join(". ");
}

/** Assemble style sheet fields into a prompt preamble. */
export function styleSheetToPromptText(sheet: SheetDocument | null | undefined): string {
  if (!sheet || sheet.entityKind !== "style") return "";
  return joinParts([
    sheet.palette ? `Palette: ${sheet.palette}` : null,
    sheet.lighting ? `Lighting: ${sheet.lighting}` : null,
    sheet.lensLook ? `Lens: ${sheet.lensLook}` : null,
    sheet.filmGrain ? `Film grain: ${sheet.filmGrain}` : null,
    sheet.mood ? `Mood: ${sheet.mood}` : null,
  ]);
}

/** Assemble character / location / prop sheet fields into prompt text. */
export function entitySheetToPromptText(
  sheet: SheetDocument | null | undefined,
  opts?: { name?: string; description?: string },
): string {
  if (!sheet) {
    return joinParts([
      opts?.name ? `Subject: ${opts.name}` : null,
      opts?.description,
    ]);
  }
  if (sheet.entityKind === "character") {
    return joinParts([
      opts?.name ? `Character: ${opts.name}` : null,
      opts?.description,
      sheet.look ? `Look: ${sheet.look}` : null,
      sheet.age ? `Age: ${sheet.age}` : null,
      sheet.build ? `Build: ${sheet.build}` : null,
      sheet.wardrobe ? `Wardrobe: ${sheet.wardrobe}` : null,
      sheet.personality ? `Personality: ${sheet.personality}` : null,
      sheet.voiceNotes ? `Voice: ${sheet.voiceNotes}` : null,
    ]);
  }
  if (sheet.entityKind === "location") {
    return joinParts([
      opts?.name ? `Location: ${opts.name}` : null,
      opts?.description,
      sheet.notes,
    ]);
  }
  if (sheet.entityKind === "prop") {
    return joinParts([
      opts?.name ? `Prop: ${opts.name}` : null,
      opts?.description,
      sheet.notes,
    ]);
  }
  return styleSheetToPromptText(sheet);
}

export type AssembleLookDevPromptInput = {
  styleSheet?: SheetDocument | null;
  entitySheet?: SheetDocument | null;
  entityName?: string;
  entityDescription?: string;
  rules?: string[];
  userPrompt?: string;
};

/**
 * Full look-dev prompt: style preamble + entity fields + project rules + user text.
 */
export function assembleLookDevPrompt(input: AssembleLookDevPromptInput): string {
  const parts: string[] = [];
  const styleText = styleSheetToPromptText(input.styleSheet);
  if (styleText) parts.push(styleText);
  const entityText = entitySheetToPromptText(input.entitySheet, {
    name: input.entityName,
    description: input.entityDescription,
  });
  if (entityText) parts.push(entityText);
  if (input.rules && input.rules.length > 0) {
    parts.push(`Project rules: ${input.rules.join("; ")}`);
  }
  const user = input.userPrompt?.trim();
  if (user) parts.push(user);
  return parts.join("\n\n");
}

/** Short summary of sheet fields for copilot context. */
export function sheetSummary(sheet: SheetDocument | null | undefined): string {
  if (!sheet) return "(no sheet)";
  if (sheet.entityKind === "character") {
    return joinParts([
      sheet.look,
      sheet.age,
      sheet.build,
      sheet.wardrobe,
      sheet.personality,
      sheet.voiceNotes,
    ]) || "(empty character sheet)";
  }
  if (sheet.entityKind === "style") {
    return styleSheetToPromptText(sheet) || "(empty style sheet)";
  }
  return sheet.notes?.trim() || sheet.draftPrompt?.trim() || "(empty sheet)";
}
