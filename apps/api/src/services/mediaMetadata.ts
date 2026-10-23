import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
/** Container parsing only: no network, decoding, provider request, or render server. */
export async function readVideoMetadata(blob: Blob) {
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("Generated file has no video track");
    const [durationSec, width, height] = await Promise.all([
      input.computeDuration(),
      track.getDisplayWidth(),
      track.getDisplayHeight(),
    ]);
    if (
      !Number.isFinite(durationSec) ||
      durationSec <= 0 ||
      width <= 0 ||
      height <= 0
    )
      throw new Error("Generated video metadata is invalid");
    return { durationSec, width, height };
  } finally {
    input.dispose();
  }
}
