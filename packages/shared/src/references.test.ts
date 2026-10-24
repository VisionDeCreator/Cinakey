import { describe, expect, it } from "vitest";
import { referenceAlias, resolveReferences } from "./references";
const assets = [
  { assetId: "james", name: "James", type: "image" },
  { assetId: "camera", name: "Camera move", type: "video" },
];
describe("stable script references", () => {
  it("binds repeated numbered and named mentions to the same image, without renumbering collisions", () => {
    const result = resolveReferences(
      "@image_7 meets @james. @image_7 again. Follow @video_3.",
      [
        { alias: "image_7", assetId: "james" },
        { alias: "video_3", assetId: "camera" },
      ],
      assets,
    );
    expect(result.imageIds).toEqual(["james"]);
    expect(result.videoIds).toEqual(["camera"]);
    expect(result.prompt).toBe(
      "@image_1 meets @image_1. @image_1 again. Follow @video_1.",
    );
  });
  it("keeps an explicit binding after a rename and never silently falls back when its asset disappears", () => {
    const binding = [{ alias: "james", assetId: "james" }];
    expect(
      resolveReferences("@james", binding, [{ ...assets[0]!, name: "John" }])
        .imageIds,
    ).toEqual(["james"]);
    expect(
      resolveReferences("@james", binding, [
        { assetId: "other", name: "James", type: "image" },
      ]).unresolved,
    ).toEqual(["james"]);
  });
  it("requires a choice for duplicate names and rejects numbered references with the wrong media type", () => {
    expect(
      resolveReferences(
        "@james",
        [],
        [...assets, { ...assets[0]!, assetId: "other" }],
      ).ambiguous,
    ).toEqual(["james"]);
    expect(
      resolveReferences(
        "@video_1",
        [{ alias: "video_1", assetId: "james" }],
        assets,
      ).unresolved,
    ).toEqual(["video_1"]);
  });
  it("matches whole case-insensitive aliases, ignores email addresses, and supports Unicode names", () => {
    const result = resolveReferences(
      "a@james.com @JAMES @james_2 @제임스",
      [],
      [...assets, { assetId: "ko", name: "제임스", type: "image" }],
    );
    expect(result.prompt).toBe("a@james.com @image_1 @james_2 @image_2");
    expect(result.unresolved).toEqual(["james_2"]);
    expect(referenceAlias("Camera move")).toBe("camera_move");
  });
  it("keeps pasted Markdown image and video mentions connected", () => {
    const result = resolveReferences(
      "@[Image 7](image_7) and @[Video 2](video_2)",
      [
        { alias: "image_7", assetId: "james" },
        { alias: "video_2", assetId: "camera" },
      ],
      assets,
    );
    expect(result.prompt).toBe("@image_1 and @video_1");
    expect(result.imageIds).toEqual(["james"]);
    expect(result.videoIds).toEqual(["camera"]);
  });
});
