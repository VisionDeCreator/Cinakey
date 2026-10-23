import type { BuildRequestInput } from "./adapters";
/** Deliberate supported subset of the documented Ark Seedance 2.5 contract. */
export function validateVideoInput(input: BuildRequestInput) {
  if (
    !["text-to-video", "image-to-video", "extend"].includes(
      input.kind ?? "text-to-video",
    )
  )
    throw new Error(
      "This video operation is not supported by the configured provider",
    );
  const duration = input.durationSec ?? 5;
  if (!Number.isInteger(duration) || duration < 4 || duration > 30)
    throw new Error(
      "Video duration must be a whole number from 4 to 30 seconds",
    );
  if (!["720p", "1080p"].includes(input.resolution ?? "720p"))
    throw new Error("Unsupported video resolution");
  if (
    !["16:9", "9:16", "1:1", "adaptive"].includes(input.aspectRatio ?? "16:9")
  )
    throw new Error("Unsupported video aspect ratio");
  if (
    input.seed !== undefined &&
    (!Number.isSafeInteger(input.seed) ||
      input.seed < -1 ||
      input.seed > 2147483647)
  )
    throw new Error("Invalid video seed");
  if ((input.referenceImageUrls?.length ?? 0) > 30)
    throw new Error("At most 30 reference images are supported");
  if (input.cameraPreset)
    throw new Error(
      "Camera presets are not supported; describe camera movement in the prompt",
    );
  if (input.endFrameUrl && !input.startFrameUrl)
    throw new Error("A last frame requires a starting frame");
  if (input.kind === "image-to-video" && !input.startFrameUrl)
    throw new Error("Select a starting frame for image-to-video");
  if (
    input.startFrameUrl &&
    ((input.referenceImageUrls?.length ?? 0) > 0 || input.referenceVideoUrl)
  )
    throw new Error(
      "Starting frames cannot be combined with reference media; use one mode at a time",
    );
  if (input.kind === "extend" && !input.referenceVideoUrl)
    throw new Error("Extension requires a source video");
}
