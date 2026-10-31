import { v, type Infer } from "convex/values";

export const generationResolution = v.union(
  v.literal("720p"),
  v.literal("1080p"),
);
export const generationAspectRatio = v.union(
  v.literal("16:9"),
  v.literal("9:16"),
  v.literal("1:1"),
);
export const generationSettingsValidator = v.object({
  resolution: generationResolution,
  durationSec: v.number(),
  aspectRatio: generationAspectRatio,
  stagingId: v.optional(v.id("workspaceStaging")),
  useStaging: v.boolean(),
});
export type GenerationSettings = Infer<typeof generationSettingsValidator>;

export function generationDefaults(project: {
  aspectRatio: string;
  generationSettings?: GenerationSettings;
}): GenerationSettings {
  return (
    project.generationSettings ?? {
      resolution: "720p",
      durationSec: 5,
      aspectRatio:
        project.aspectRatio === "9:16" || project.aspectRatio === "1:1"
          ? project.aspectRatio
          : "16:9",
      useStaging: false,
    }
  );
}

/** Duration has a single source of truth on the segment itself. */
export const segmentGenerationSettingsValidator = v.object({
  resolution: generationResolution,
  aspectRatio: generationAspectRatio,
  stagingId: v.optional(v.id("workspaceStaging")),
  useStaging: v.boolean(),
});
export function segmentSettingsDefaults(
  project: Parameters<typeof generationDefaults>[0],
): Infer<typeof segmentGenerationSettingsValidator> {
  const defaults = generationDefaults(project);
  return {
    resolution: defaults.resolution,
    aspectRatio: defaults.aspectRatio,
    useStaging: false,
  };
}
