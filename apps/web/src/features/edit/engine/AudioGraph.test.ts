import { assertTimelineDocument } from "@dirrio/shared";
import { afterEach, expect, it, vi } from "vitest";
import { timelineWithMedia } from "../../../../../../packages/shared/test/timelineFixture";
import { AudioGraph, videoClipsAt } from "./AudioGraph";
import type { MediaCache } from "./MediaCache";
afterEach(() => vi.unstubAllGlobals());
it("mutes original audio while retaining video frames and persisting the mute in saved timelines", async () => {
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      currentTime = 0;
      destination = {};
      createGain() {
        return { connect() {} };
      }
    },
  );
  const doc = timelineWithMedia({
    project: { id: "p", aspectRatio: "16:9", fps: 24 },
    clips: [
      {
        order: 0,
        durationSec: 5,
        assetId: "a",
      },
    ],
  });
  doc.tracks[0]!.audioMuted = true;
  const saved = assertTimelineDocument(JSON.parse(JSON.stringify(doc)));
  expect(saved.tracks[0]!.audioMuted).toBe(true);
  expect(videoClipsAt(saved.tracks, 1)).toHaveLength(1);
  const ensureAudio = vi.fn();
  const cache = { ensureAudio, setAudioContext() {} } as unknown as MediaCache;
  await new AudioGraph().schedule(
    saved,
    0,
    { a: { url: "https://fixture.test/clip.mp4" } },
    cache,
  );
  expect(ensureAudio).not.toHaveBeenCalled();
});
