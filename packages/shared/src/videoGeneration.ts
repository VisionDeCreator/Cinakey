import type { BuildRequestInput } from "./adapters";
/** Deliberate supported subset of the documented Sume Seedance 2.5 contract. */
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

/** Known media constraints are checked before reserving generation usdMicros. */
export function validateVideoReference(
  asset: {
    name: string;
    type: string;
    width?: number;
    height?: number;
    durationSec?: number;
    sizeBytes?: number;
  },
  remix = false,
) {
  const prefix = `Reference “${asset.name}”`;
  if (asset.width !== undefined && asset.height !== undefined) {
    const { width, height } = asset;
    if (width < 300 || height < 300 || width > 6000 || height > 6000)
      throw new Error(`${prefix} must be 300–6000 pixels on each side.`);
    if (width / height < 0.4 || width / height > 2.5)
      throw new Error(`${prefix} must have an aspect ratio from 0.4 to 2.5.`);
    if (
      !remix &&
      asset.type === "video" &&
      (width * height < 407696 || width * height > 8295044)
    )
      throw new Error(
        `${prefix} needs a supported video resolution (at least 407,696 pixels).`,
      );
  }
  if (
    asset.type === "video" &&
    asset.durationSec !== undefined &&
    (asset.durationSec < (remix ? 4 : 2) ||
      asset.durationSec > (remix ? 15 : 30))
  )
    throw new Error(
      `${prefix} must be ${remix ? "4–15" : "2–30"} seconds long.`,
    );
  if (
    asset.sizeBytes !== undefined &&
    asset.sizeBytes > (asset.type === "video" ? 200 : 30) * 1024 * 1024
  )
    throw new Error(`${prefix} exceeds the provider's file size limit.`);
}

/** Remix Lite Object Swap requires an original video and replacement images. */
export function validateRemixInput(input: BuildRequestInput) {
  validateVideoInput(input);
  if (!input.durationSec || input.durationSec > 15)
    throw new Error("Remix Lite requires a 4–15 second source video");
  if (!input.referenceVideoUrl)
    throw new Error("Remix Lite requires a source video");
  if (!input.referenceImageUrls?.length || input.referenceImageUrls.length > 8)
    throw new Error("Remix Lite requires 1–8 reference images");
  if (
    (input.kind && input.kind !== "text-to-video") ||
    input.startFrameUrl ||
    input.endFrameUrl
  )
    throw new Error("Unsupported Remix Lite operation");
}
