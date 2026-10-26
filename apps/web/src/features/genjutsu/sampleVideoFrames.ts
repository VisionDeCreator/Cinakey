import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";

/** Decode a bounded set of frames locally; only JPEG samples go to the analysis API. */
export async function sampleVideoFrames(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error("Could not download the source video for analysis");
  const blob = await response.blob();
  if (blob.size > 200 * 1024 * 1024)
    throw new Error("Source video exceeds 200 MiB");
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  try {
    const duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration < 4 || duration > 30)
      throw new Error("Choose a whole video between 4 and 30 seconds");
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode()))
      throw new Error(
        "This browser cannot decode this source video for analysis",
      );
    const sink = new CanvasSink(track, {
      width: 768,
      height: 432,
      fit: "contain",
      poolSize: 1,
    });
    const times = Array.from(
      { length: 8 },
      (_, i) => (duration * (i + 0.25)) / 8,
    );
    const frames: { timeSec: number; dataUrl: string }[] = [];
    let index = 0;
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      signal.throwIfAborted();
      const timeSec = times[index++]!;
      if (!frame)
        throw new Error(
          "Could not decode a sampled frame. Try another source video.",
        );
      const canvas = document.createElement("canvas");
      canvas.width = 768;
      canvas.height = 432;
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("Frame capture is unavailable in this browser");
      context.drawImage(frame.canvas, 0, 0);
      frames.push({ timeSec, dataUrl: canvas.toDataURL("image/jpeg", 0.75) });
    }
    if (frames.length !== 8)
      throw new Error("Source frame sampling was incomplete");
    return frames;
  } finally {
    input.dispose();
  }
}
