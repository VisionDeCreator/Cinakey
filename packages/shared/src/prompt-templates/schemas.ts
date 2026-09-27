import { z } from "zod";
import type { CameraMoveType, CastProxyKind, StandInPrimitive } from "./constants";

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
  colorPalette: z.string().min(1),
});

export const creatureSheetSchema = z.object({
  subjectLine: z.string().min(1),
  views: z.array(z.string().min(1)).min(1),
  body: z.string().min(1),
  gear: namedSectionSchema.optional(),
  signatureDetail: namedSectionSchema.optional(),
  colorPalette: z.string().min(1),
});

export const environmentSheetSchema = z.object({
  place: z.string().min(1),
  timeOfDay: z.string().min(1),
  cameraAngle: z.string().min(1),
  theLand: z.string().min(1),
  skyAndLight: z.string().min(1),
  colorPalette: z.string().min(1),
});

export const productSheetSchema = z.object({
  objectName: z.string().min(1),
  views: z.string().min(1),
  theObject: namedSectionSchema,
  feel: z.string().min(1),
  colorPalette: z.string().min(1),
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

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

export const blockoutSetPieceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  primitive: z.string().min(1) as z.ZodType<StandInPrimitive | string>,
  position: vec3Schema,
  size: vec3Schema,
  rotation: vec3Schema.optional(),
  notes: z.string().optional(),
});

export const blockoutCastSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  proxy: z.string().min(1) as z.ZodType<CastProxyKind | string>,
  heightM: z.number().positive().optional(),
  lengthM: z.number().positive().optional(),
  colorCode: z.string().optional(),
  imageN: z.number().int().positive().optional(),
  entityId: z.string().optional(),
  riderAttachment: z.string().optional(),
  count: z.number().int().positive().optional(),
  spread: z.string().optional(),
});

export const blockoutPropSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  attachment: z.string().optional(),
  imageN: z.number().int().positive().optional(),
  entityId: z.string().optional(),
});

export const blockoutLightSchema = z.object({
  sunAzimuthDeg: z.number(),
  sunElevationDeg: z.number(),
  colorTemperatureK: z.number().positive().optional(),
  fill: z.string().optional(),
  notes: z.string().optional(),
});

export const blockoutShotCameraSchema = z.object({
  startPosition: vec3Schema,
  startLookAt: vec3Schema,
  endPosition: vec3Schema,
  endLookAt: vec3Schema,
  moveType: z.string().min(1) as z.ZodType<CameraMoveType | string>,
  easing: z.string().optional(),
});

export const blockoutBlockingEntrySchema = z.object({
  targetId: z.string().min(1),
  startPosition: vec3Schema,
  startPose: z.string().optional(),
  endPosition: vec3Schema,
  endPose: z.string().optional(),
  timedKeys: z.array(z.object({ t: z.number(), note: z.string() })).optional(),
});

export const blockoutEventSchema = z.object({
  t: z.number().min(0),
  label: z.string().min(1),
});

export const blockoutSheetShotSchema = z.object({
  n: z.number().int().positive(),
  startSec: z.number().min(0),
  endSec: z.number().positive(),
  shotType: z.string().min(1),
  lensMm: z.number().positive(),
  cameraMove: z.string().min(1),
  camera: blockoutShotCameraSchema,
  blocking: z.array(blockoutBlockingEntrySchema),
  events: z.array(blockoutEventSchema),
  frameMustShow: z.string().min(1),
  continuity: z.string().min(1),
  audioCue: z.string().optional(),
  transitionOut: z.string().min(1),
  guides: z.array(z.string()).optional(),
  liveShotId: z.string().optional(),
});

export const blockoutSheetSchema = z.object({
  sequenceTitle: z.string().min(1),
  scriptPromptVersion: z.number().int().positive(),
  durationSec: z.number().positive(),
  aspectRatio: z.string().min(1),
  fps: z.number().positive(),
  shotCount: z.number().int().positive(),
  worldOriginLandmark: z.string().min(1),
  references: z.array(
    z.object({
      imageN: z.number().int().positive(),
      entityLabel: z.string().min(1),
      standInId: z.string().min(1),
    }),
  ),
  set: z.array(blockoutSetPieceSchema),
  cast: z.array(blockoutCastSchema),
  props: z.array(blockoutPropSchema),
  light: blockoutLightSchema,
  shots: z.array(blockoutSheetShotSchema).min(1),
});

export type CharacterSheetData = z.infer<typeof characterSheetSchema>;
export type CreatureSheetData = z.infer<typeof creatureSheetSchema>;
export type EnvironmentSheetData = z.infer<typeof environmentSheetSchema>;
export type ProductSheetData = z.infer<typeof productSheetSchema>;
export type ScriptPromptData = z.infer<typeof scriptPromptSchema>;
export type BlockoutSheetData = z.infer<typeof blockoutSheetSchema>;
export type ScriptReference = z.infer<typeof scriptReferenceSchema>;
export type ScriptCastBlock = z.infer<typeof scriptCastBlockSchema>;
export type ScriptShot = z.infer<typeof scriptShotSchema>;

export type AssetSheetType =
  | "character"
  | "creature"
  | "environment"
  | "product";

export type PromptSheetType =
  | AssetSheetType
  | "script"
  | "blockout";

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
  type: AssetSheetType,
  value: unknown,
): AssetSheetData {
  return assetSheetSchemaFor(type).parse(value) as AssetSheetData;
}
