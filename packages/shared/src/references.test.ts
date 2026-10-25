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

it("captures a mention's full range when completing in the middle, and ignores email addresses", async () => {
  const { mentionAtCaret, renameReferenceMentions } =
    await import("./references");
  expect(mentionAtCaret("Before @james after", 10)).toEqual({
    start: 7,
    end: 13,
    query: "ja",
  });
  expect(mentionAtCaret("email@james", 10)).toBeNull();
  expect(
    renameReferenceMentions(
      "@JAMES @james_2 mail@james.com @james",
      "james",
      "young_james",
    ),
  ).toBe("@young_james @james_2 mail@james.com @young_james");
});

it("uses original source ranges for mixed pasted Markdown, escaped links and plain references", async () => {
  const { scriptMentionRanges, renameReferenceMentions } =
    await import("./references");
  const text =
    "REFERENCES\n@[Image 1](image_1) = character. @IMAGE_1 rides @[Image 2](image_2). @[Image 1]\\(image_1)";
  const ranges = scriptMentionRanges(text);
  expect(ranges.map((m) => m.alias)).toEqual([
    "image_1",
    "image_1",
    "image_2",
    "image_1",
  ]);
  for (const m of ranges) expect(text.slice(m.start, m.end)).toBe(m.text);
  expect(renameReferenceMentions(text, "image_1", "video_3")).toBe(
    "REFERENCES\n@[Video 3](video_3) = character. @video_3 rides @[Image 2](image_2). @[Video 3](video_3)",
  );
  expect(
    scriptMentionRanges("email@[Image 1](image_1) mail@image_1.com"),
  ).toEqual([]);
});
it("uses link destinations consistently and leaves unrelated Markdown spelling untouched", async () => {
  const {
    scriptMentionRanges,
    renameReferenceMentions,
    replacementReferenceAlias,
  } = await import("./references");
  expect(scriptMentionRanges("@[Character](james)")[0]?.alias).toBe("james");
  expect(
    renameReferenceMentions(
      "@[Image 1](image_1) @[IMAGE 2](IMAGE_2)",
      "image_1",
      "james",
    ),
  ).toBe("@[james](james) @[IMAGE 2](IMAGE_2)");
  expect(
    replacementReferenceAlias("image_1", "video", ["video_1", "video_2"]),
  ).toBe("video_3");
  expect(replacementReferenceAlias("james", "video", [])).toBe("james");
});
