import { describe, expect, it } from "vitest";
import {
  compileVideoTransform,
  transformDuration,
  videoTransformSchema,
  type VideoTransform,
} from "./videoTransform";
const plan: VideoTransform = {
  version: 1,
  mode: "recast",
  instruction: "Replace the actor with image 1.",
  preserveCamera: true,
  preserveMotion: true,
  analysisModel: "deepseek-flash",
  sampledFrameTimes: [0, 2, 4],
  analysis: {
    subjects: "One actor",
    action: "Walks left",
    camera: "Tracking shot",
    setting: "Street",
    uncertainties: ["Feet obscured"],
  },
};
describe("video transformation contract", () => {
  it("maps references deterministically and keeps observations separate from preservation instructions", () => {
    const prompt = compileVideoTransform(plan, ["Actor", "Wardrobe"]);
    expect(prompt).toContain('Image 1: "Actor"');
    expect(prompt).toContain('Image 2: "Wardrobe"');
    expect(prompt).toContain("Follow the source camera movement");
    expect(prompt).toContain("Preserve the source subjects' actions");
    expect(prompt).toContain("Feet obscured");
    expect(
      compileVideoTransform({ ...plan, preserveCamera: false }, ["Actor"]),
    ).not.toContain("Follow the source camera movement");
  });
  it("supports prompt-only changes and rejects malformed plans", () => {
    expect(() => compileVideoTransform(plan, [])).not.toThrow();
    expect(() =>
      compileVideoTransform({ ...plan, mode: "restyle" }, []),
    ).not.toThrow();
    expect(
      videoTransformSchema.safeParse({ ...plan, instruction: " " }).success,
    ).toBe(false);
    expect(
      videoTransformSchema.safeParse({
        ...plan,
        analysis: { ...plan.analysis, camera: "" },
      }).success,
    ).toBe(false);
  });
  it("infers all changes from the prompt and treats multiple targets as optional guidance", () => {
    const promptOnly = {
      ...plan,
      mode: undefined,
      targets: [],
      instruction: "Recast the actor and change the street to a snowy village",
    };
    const inferred = compileVideoTransform(promptOnly, []);
    expect(inferred).toContain(
      "Infer what to change entirely from the user's prompt",
    );
    expect(inferred).toContain(promptOnly.instruction);
    const combined = compileVideoTransform(
      { ...promptOnly, targets: ["recast", "environment", "lighting"] },
      [],
    );
    expect(combined).toContain(
      "Optional focus areas: Characters, Environment, Lighting",
    );
    expect(combined).toContain(
      "without excluding other changes explicitly requested in the prompt",
    );
    expect(
      videoTransformSchema.safeParse({
        ...promptOnly,
        targets: ["recast", "recast"],
      }).success,
    ).toBe(false);
    expect(
      videoTransformSchema.safeParse({ ...promptOnly, targets: ["unknown"] })
        .success,
    ).toBe(false);
    expect(compileVideoTransform(plan, [])).toContain(
      "Optional focus areas: Characters",
    );
  });
  it("rounds source duration within the supported whole-second range without silently trimming long videos", () => {
    expect(transformDuration(5.056)).toBe(6);
    expect(transformDuration(14.9)).toBe(15);
    for (const value of [NaN, Infinity, 3.99, 15.01])
      expect(() => transformDuration(value)).toThrow();
  });
});

it("resolves video_1 to the current source while keeping image references separate", async () => {
  const { resolveTransformPrompt } = await import("./videoTransform");
  const result = resolveTransformPrompt(
    "Follow @video_1 with @image_1 and @image_2. Keep @video_1 timing.",
    [
      { alias: "video_1", assetId: "old-source" },
      { alias: "image_1", assetId: "actor" },
      { alias: "image_2", assetId: "style" },
    ],
    [
      { assetId: "source", name: "Basketball.mp4", type: "video" },
      { assetId: "actor", name: "Actor.png", type: "image" },
      { assetId: "style", name: "Style.png", type: "image" },
    ],
    "source",
  );
  expect(result.unresolved).toEqual([]);
  expect(result.videoIds).toEqual(["source"]);
  expect(result.imageIds).toEqual(["actor", "style"]);
});
