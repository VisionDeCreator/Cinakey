import {
  ShotRenderer,
  canvasToBlob,
  frameSize,
  type RenderableShot,
} from "./runtime/shotRenderer";

export const GUIDE_TAGS = {
  keyframe: ["guide", "blockout-keyframe"],
  depth: ["guide", "blockout-depth"],
} as const;

/** Render the shot camera view at time `t` as a colour keyframe and a depth pass. */
export async function renderGuideImages(
  shot: RenderableShot,
  fps: number,
  aspect: number,
  t: number,
): Promise<{ keyframe: Blob; depth: Blob; width: number; height: number }> {
  const { width, height } = frameSize(aspect, 1280);
  const renderer = new ShotRenderer(shot, fps, width, height);
  try {
    const keyframe = await canvasToBlob(renderer.renderColor(t));
    const depth = await canvasToBlob(renderer.renderDepth(t));
    return { keyframe, depth, width, height };
  } finally {
    renderer.dispose();
  }
}
