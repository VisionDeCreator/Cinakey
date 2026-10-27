import { tokenPrice } from "./money";
import { z } from "zod";
import {
  resolveReferences,
  type ReferenceBinding,
  type ReferenceCandidate,
} from "./references";

/** The selected source is always video 1; only image references add provider inputs. */
export function resolveTransformPrompt(
  text: string,
  bindings: ReferenceBinding[],
  candidates: ReferenceCandidate[],
  sourceAssetId?: string | null,
) {
  const source = candidates.find(
    (asset) => asset.assetId === sourceAssetId && asset.type === "video",
  );
  return resolveReferences(
    text,
    source
      ? [
          ...bindings.filter((entry) => entry.alias !== "video_1"),
          { alias: "video_1", assetId: source.assetId },
        ]
      : bindings,
    candidates.filter(
      (asset) => asset.type === "image" || asset.assetId === source?.assetId,
    ),
  );
}

export const transformAnalysisSchema = z.object({
  subjects: z.string().trim().min(1).max(1500),
  action: z.string().trim().min(1).max(1500),
  camera: z.string().trim().min(1).max(1000),
  setting: z.string().trim().min(1).max(1000),
  uncertainties: z.array(z.string().max(300)).max(8),
});
export type TransformAnalysis = z.infer<typeof transformAnalysisSchema>;
export const TRANSFORM_TARGETS = [
  { id: "recast", label: "Characters" },
  { id: "restyle", label: "Visual style" },
  { id: "environment", label: "Environment" },
  { id: "wardrobe", label: "Clothing" },
  { id: "objects", label: "Objects & products" },
  { id: "lighting", label: "Lighting" },
] as const;
const transformTargetSchema = z.enum([
  "recast",
  "restyle",
  "environment",
  "wardrobe",
  "objects",
  "lighting",
]);
export type TransformTarget = z.infer<typeof transformTargetSchema>;
export const videoTransformSchema = z.object({
  version: z.literal(1),
  // Legacy single-mode snapshots remain readable; new plans use optional targets.
  mode: z.enum(["recast", "restyle", "environment"]).optional(),
  targets: z
    .array(transformTargetSchema)
    .max(6)
    .refine(
      (values) => new Set(values).size === values.length,
      "Duplicate transformation targets",
    )
    .optional(),
  instruction: z.string().trim().min(1).max(4000),
  preserveCamera: z.boolean(),
  preserveMotion: z.boolean(),
  analysis: transformAnalysisSchema,
  analysisModel: z.enum(["deepseek-flash", "mock"]),
  sampledFrameTimes: z.array(z.number().finite().min(0).max(30)).min(3).max(8),
});
export type VideoTransform = z.infer<typeof videoTransformSchema>;

export function transformDuration(duration: number): number {
  if (!Number.isFinite(duration) || duration < 4 || duration > 15)
    throw new Error(
      "Transform requires a whole source video between 4 and 15 seconds.",
    );
  return Math.max(4, Math.min(15, Math.ceil(duration)));
}

/** Versioned, deterministic instructions; reference ordering matches the provider payload. */
export function compileVideoTransform(
  value: VideoTransform,
  references: string[],
): string {
  const plan = videoTransformSchema.parse(value);
  if (references.length > 30)
    throw new Error("At most 30 image references are supported");
  const targets = plan.targets ?? (plan.mode ? [plan.mode] : []);
  const labels = targets.map(
    (target) => TRANSFORM_TARGETS.find((item) => item.id === target)!.label,
  );
  return [
    "Transform the source video (video 1). Determine every requested change from the user's prompt and apply all requested changes together.",
    `Requested changes: ${plan.instruction}`,
    labels.length
      ? `Optional focus areas: ${labels.join(", ")}. These guide interpretation without excluding other changes explicitly requested in the prompt.`
      : "No focus areas selected. Infer what to change entirely from the user's prompt.",
    ...references.map(
      (name, i) =>
        `Image ${i + 1}: ${JSON.stringify(name)}. Use only as a visual reference for the requested change.`,
    ),
    `Source observations (sampled frames, may be incomplete): ${JSON.stringify(plan.analysis)}`,
    plan.preserveMotion
      ? "Preserve the source subjects' actions, choreography, interactions and timing unless the prompt explicitly requests a change."
      : "Adapt subject movement only as needed for the requested change.",
    plan.preserveCamera
      ? "Follow the source camera movement, framing and shot transitions unless the prompt explicitly requests a change."
      : "Adapt framing only as needed for the requested change.",
    "Keep unrelated subjects and scene elements consistent. Maintain temporal consistency across frames. Do not add titles or captions.",
  ].join("\n");
}

/** Upper bound at 1024 image tokens each, plus bounded instructions and output. */
export function transformAnalysisUsdMicros(
  frameCount: number,
  referenceCount: number,
): number {
  return tokenPrice((frameCount + referenceCount) * 1024 + 6000);
}
