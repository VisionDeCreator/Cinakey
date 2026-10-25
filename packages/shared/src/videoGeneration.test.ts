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
