import { expect, it } from "vitest";
import { readVideoMetadata } from "./mediaMetadata";
import { SAMPLE_MP4_BASE64 } from "../providers/mockVideo";
it("measures local video duration and dimensions without decoding or networking", async () => {
  const blob = new Blob(
    [
      Uint8Array.from(atob(SAMPLE_MP4_BASE64), (character) =>
        character.charCodeAt(0),
      ),
    ],
    { type: "video/mp4" },
  );
  const data = await readVideoMetadata(blob);
  expect(data.durationSec).toBeGreaterThan(0);
  expect(data.width).toBeGreaterThan(0);
  expect(data.height).toBeGreaterThan(0);
});
