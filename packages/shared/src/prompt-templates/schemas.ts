import { z } from "zod";

const namedSectionSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
});

export const characterSheetSchema = z.object({
  subjectLine: z.string().min(1),
  views: z.array(z.string().min(1)).min(1),
  faceAndHair: z.string().min(1),
  outfit: z.string().min(1),
  signatureDetail: namedSectionSchema,
  moodAndColor: z.string().min(1),
});

export const creatureSheetSchema = z.object({
  subjectLine: z.string().min(1),
  views: z.array(z.string().min(1)).min(1),
  body: z.string().min(1),
  head: z.string().min(1),
  markings: z.string().min(1),
  gear: namedSectionSchema.optional(),
  signatureDetail: namedSectionSchema.optional(),
  moodAndColor: z.string().min(1),
});

export const environmentSheetSchema = z.object({
  place: z.string().min(1),
  timeOfDay: z.string().min(1),
  cameraAngle: z.string().min(1),
  /** Primary place section body (THE LAND / THE HALL / …). */
  theLand: z.string().min(1),
  /** Heading for the primary place section; default THE LAND. */
  settingHeading: z.string().min(1).optional(),
  skyAndLight: z.string().min(1),
  /** Heading for the light section; default SKY AND LIGHT (use LIGHT for interiors). */
  lightHeading: z.string().min(1).optional(),
  /** Optional mid-sections between setting and light (e.g. DARK PASSAGES). */
  extraSections: z.array(namedSectionSchema).optional(),
  moodAndColor: z.string().min(1),
});

export const productSheetSchema = z.object({
  objectName: z.string().min(1),
  views: z.string().min(1),
  theObject: namedSectionSchema,
  feel: z.string().min(1),
  moodAndColor: z.string().min(1),
});

export const scriptReferenceSchema = z.object({
  imageN: z.number().int().positive(),
  entityId: z.string().min(1),
  entityLabel: z.string().min(1),
  useFor: z.string().min(1),
});

export const scriptCastBlockSchema = z.object({
  name: z.string().min(1),
  imageN: z.number().int().positive(),
  /** Description derived from the approved asset sheet. */
  description: z.string().min(1),
  /** e.g. ", identical in every shot" or ", every one in the herd" */
  suffix: z.string().optional(),
});

export const scriptShotSchema = z.object({
  n: z.number().int().positive(),
  startSec: z.number().min(0),
  endSec: z.number().positive(),
  shotType: z.string().min(1),
  cameraMove: z.string().optional(),
  action: z.string().min(1),
});

export const scriptAudioCueSchema = z.object({
  atSec: z.number().min(0),
  description: z.string().min(1),
});

export const scriptPromptSchema = z.object({
  references: z.array(scriptReferenceSchema).min(1),
  /** Project art style paragraph (without the locking wrapper). */
  artStyleBlock: z.string().min(1),
  /** Extra style sentences injected after the art style (fur, grass, etc.). */
  artStyleExtras: z.string().optional(),
  imageQuality: z.string().min(1),
  castBlocks: z.array(scriptCastBlockSchema),
  location: z.object({
    imageN: z.number().int().positive(),
    description: z.string().min(1),
  }),
  totalDurationSec: z.number().positive(),
  aspectRatio: z.string().min(1),
  multiShot: z.boolean().default(true),
  shots: z.array(scriptShotSchema).min(1),
  consistency: z.string().min(1),
  motionAndPhysics: z.string().min(1),
  lighting: z.string().min(1),
  technical: z.string().min(1),
  music: z.string().min(1),
  audioIntro: z.string().optional(),
  audioCues: z.array(scriptAudioCueSchema),
});

export type CharacterSheetData = z.infer<typeof characterSheetSchema>;
export type CreatureSheetData = z.infer<typeof creatureSheetSchema>;
export type EnvironmentSheetData = z.infer<typeof environmentSheetSchema>;
export type ProductSheetData = z.infer<typeof productSheetSchema>;
export type ScriptPromptData = z.infer<typeof scriptPromptSchema>;
export type ScriptReference = z.infer<typeof scriptReferenceSchema>;
export type ScriptCastBlock = z.infer<typeof scriptCastBlockSchema>;
export type ScriptShot = z.infer<typeof scriptShotSchema>;

export type AssetSheetType =
  "character" | "creature" | "environment" | "product";

export type AssetSheetData =
  | CharacterSheetData
  | CreatureSheetData
  | EnvironmentSheetData
  | ProductSheetData;

export function assetSheetSchemaFor(
  type: AssetSheetType,
):
  | typeof characterSheetSchema
  | typeof creatureSheetSchema
  | typeof environmentSheetSchema
  | typeof productSheetSchema {
  switch (type) {
    case "character":
      return characterSheetSchema;
    case "creature":
      return creatureSheetSchema;
    case "environment":
      return environmentSheetSchema;
    case "product":
      return productSheetSchema;
  }
}

export function parseAssetSheet(
  type: "character",
  value: unknown,
): CharacterSheetData;
export function parseAssetSheet(
  type: "creature",
  value: unknown,
): CreatureSheetData;
export function parseAssetSheet(
  type: "environment",
  value: unknown,
): EnvironmentSheetData;
export function parseAssetSheet(
  type: "product",
  value: unknown,
): ProductSheetData;
export function parseAssetSheet(
  type: AssetSheetType,
  value: unknown,
): AssetSheetData;
export function parseAssetSheet(
  type: AssetSheetType,
  value: unknown,
): AssetSheetData {
  const migrated = migrateLegacyAssetSheetFields(type, value);
  return assetSheetSchemaFor(type).parse(migrated) as AssetSheetData;
}

/** Map legacy `colorPalette` → `moodAndColor`; fill creature head/markings if missing. */
function migrateLegacyAssetSheetFields(
  type: AssetSheetType,
  value: unknown,
): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = { ...(value as Record<string, unknown>) };
  if (
    typeof obj.moodAndColor !== "string" &&
    typeof obj.colorPalette === "string"
  ) {
    obj.moodAndColor = obj.colorPalette;
  }
  if (type === "creature") {
    const body = typeof obj.body === "string" ? obj.body : "";
    if (typeof obj.head !== "string" || !obj.head.trim()) {
      obj.head = body || "Head details as described.";
    }
    if (typeof obj.markings !== "string" || !obj.markings.trim()) {
      obj.markings = body || "Markings as described.";
    }
  }
  return obj;
}
