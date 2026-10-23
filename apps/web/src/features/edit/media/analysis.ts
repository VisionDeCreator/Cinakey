/** Fixed-size, absolute-amplitude envelopes; stereo channels must never cancel out. */
export function addPeaks(
  peaks: number[],
  channels: Float32Array[],
  sampleRate: number,
  timestamp: number,
  duration: number,
) {
  if (!(duration > 0) || !(sampleRate > 0)) return;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      const bin = Math.floor(
        ((timestamp + i / sampleRate) / duration) * peaks.length,
      );
      if (bin >= 0 && bin < peaks.length)
        peaks[bin] = Math.max(peaks[bin]!, Math.min(1, Math.abs(channel[i]!)));
    }
  }
}

export function sourceTime(
  inSec: number,
  speed: number,
  timelineOffset: number,
) {
  return inSec + speed * timelineOffset;
}

export function proxyDimensions(width: number, height: number) {
  const scale = Math.min(1, 640 / Math.max(width, height));
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
  };
}
