import { it, expect } from "vitest";

it("validates known reference dimensions, video duration and size before provider submission", async () => {
  const { validateVideoReference } = await import("./videoGeneration");
  expect(() =>
    validateVideoReference({
      name: "Small",
      type: "image",
      width: 160,
      height: 160,
    }),
  ).toThrow("300–6000");
  expect(() =>
    validateVideoReference({
      name: "Valid",
      type: "image",
      width: 768,
      height: 768,
    }),
  ).not.toThrow();
  expect(() =>
    validateVideoReference({ name: "Short", type: "video", durationSec: 1 }),
  ).toThrow("2–30");
  expect(() =>
    validateVideoReference({
      name: "Small video",
      type: "video",
      width: 640,
      height: 360,
    }),
  ).toThrow("resolution");
});

it("accepts the original 480×854 Remix footage while keeping Seedance reference limits", async () => {
  const { validateVideoReference, validateRemixInput } =
    await import("./videoGeneration");
  const source = {
    name: "Basketball",
    type: "video",
    width: 480,
    height: 854,
    durationSec: 9.041667,
  };
  expect(() => validateVideoReference(source, true)).not.toThrow();
  expect(() =>
    validateVideoReference({ ...source, durationSec: 16 }, true),
  ).toThrow("4–15");
  const input = {
    durationSec: 10,
    referenceVideoUrl: "https://fixture.test/source.mp4",
    referenceImageUrls: ["https://fixture.test/character.png"],
  };
  expect(() => validateRemixInput(input)).not.toThrow();
  expect(() => validateRemixInput({ ...input, durationSec: 16 })).toThrow(
    "4–15",
  );
  expect(() =>
    validateRemixInput({ ...input, referenceImageUrls: [] }),
  ).toThrow("1–8");
  expect(() =>
    validateRemixInput({
      ...input,
      referenceImageUrls: Array(9).fill("https://fixture.test/image.png"),
    }),
  ).toThrow("1–8");
});
