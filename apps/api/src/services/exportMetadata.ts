import { BlobSource, EncodedPacketSink, Input, MP4 } from "mediabunny";
/** Validate browser-compatible tracks and real packet presence without trusting MIME/extension. */
export async function readExportMetadata(blob: Blob) {
  const input = new Input({ source: new BlobSource(blob), formats: [MP4] });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video || (await video.getCodec()) !== "avc")
      throw new Error("Export needs an H.264 video track");
    const packets = new EncodedPacketSink(video);
    const durationSec = await input.computeDuration();
    const [first, last, width, height] = await Promise.all([
      packets.getFirstPacket(),
      packets.getPacket(Math.max(0, durationSec - 0.001)),
      video.getDisplayWidth(),
      video.getDisplayHeight(),
    ]);
    if (
      !first?.data.length ||
      !last?.data.length ||
      first.type !== "key" ||
      !Number.isFinite(durationSec) ||
      durationSec <= 0 ||
      Math.abs(last.timestamp + last.duration - durationSec) > 0.75 ||
      width <= 0 ||
      height <= 0
    )
      throw new Error("Export video packets or metadata are invalid");
    const audio = await input.getPrimaryAudioTrack();
    if (
      audio &&
      ((await audio.getCodec()) !== "aac" ||
        !(await new EncodedPacketSink(audio).getFirstPacket())?.data.length)
    )
      throw new Error("Export audio must use AAC");
    return { durationSec, width, height };
  } finally {
    input.dispose();
  }
}
