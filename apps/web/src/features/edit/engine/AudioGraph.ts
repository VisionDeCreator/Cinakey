/**
 * Web Audio graph: schedule clip buffers with volume, fades, and music ducking.
 */

import type { TimelineClip, TimelineDocument, TimelineTrack } from "@cinakey/shared";
import type { MediaCache } from "./MediaCache";
import { audioUrlForClip, type MediaUrlMap } from "../mediaUrls";

const DUCK_GAIN = 0.25;
const DUCK_RAMP_SEC = 0.05;

type Scheduled = {
  source: AudioBufferSourceNode;
  gain: GainNode;
};

export class AudioGraph {
  readonly ctx: AudioContext;
  private master: GainNode;
  private scheduled: Scheduled[] = [];
  private playing = false;
  private startCtxTime = 0;
  private startTimelineSec = 0;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  stopAll() {
    for (const s of this.scheduled) {
      try {
        s.source.stop();
      } catch {
        /* already stopped */
      }
      try {
        s.source.disconnect();
        s.gain.disconnect();
      } catch {
        /* */
      }
    }
    this.scheduled = [];
    this.playing = false;
  }

  /**
   * Schedule all audio-bearing clips from `fromSec` onward.
   * Video/take clips use original media audio; music/sfx use their assets.
   */
  async schedule(
    doc: TimelineDocument,
    fromSec: number,
    urls: MediaUrlMap,
    cache: MediaCache,
  ) {
    this.stopAll();
    await this.resume();
    cache.setAudioContext(this.ctx);

    this.startCtxTime = this.ctx.currentTime;
    this.startTimelineSec = fromSec;
    this.playing = true;

    const dialogueRanges = collectDialogueRanges(doc);
    const audioTracks = doc.tracks.filter(
      (t) =>
        !t.muted &&
        (t.kind === "video" ||
          t.kind === "music" ||
          t.kind === "sfx"),
    );

    for (const track of audioTracks) {
      for (const clip of track.clips) {
        if (clip.source.type === "text") continue;
        const end = clip.startSec + clip.durationSec;
        if (end <= fromSec) continue;

        const url = audioUrlForClip(clip.source, urls);
        if (!url) continue;
        const assetId =
          clip.source.type === "take" || clip.source.type === "asset"
            ? clip.source.assetId
            : null;
        if (!assetId) continue;

        const buffer = await cache.ensureAudio(assetId, url);
        if (!buffer) continue;

        const offsetInClip = Math.max(0, fromSec - clip.startSec);
        const sourceOffset = clip.inSec + offsetInClip * clip.speed;
        const remain = Math.max(0, clip.durationSec - offsetInClip);
        if (remain < 0.01) continue;

        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = clip.speed;

        const gain = this.ctx.createGain();
        const baseVol = clip.volume ?? 1;
        const when = this.startCtxTime + Math.max(0, clip.startSec - fromSec);

        applyEnvelope(gain, this.ctx, when, remain, baseVol, clip);

        if (track.kind === "music" && dialogueRanges.length > 0) {
          applyDucking(
            gain,
            this.ctx,
            when,
            clip.startSec,
            remain,
            fromSec,
            baseVol,
            dialogueRanges,
          );
        }

        src.connect(gain);
        gain.connect(this.master);

        try {
          src.start(when, sourceOffset, remain * clip.speed);
        } catch {
          continue;
        }
        this.scheduled.push({ source: src, gain });
      }
    }
  }

  timelineSecNow(): number | null {
    if (!this.playing) return null;
    return (
      this.startTimelineSec + (this.ctx.currentTime - this.startCtxTime)
    );
  }

  dispose() {
    this.stopAll();
    void this.ctx.close();
  }
}

function collectDialogueRanges(
  doc: TimelineDocument,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const track of doc.tracks) {
    if (track.kind !== "dialogue" || track.muted) continue;
    for (const clip of track.clips) {
      out.push({
        start: clip.startSec,
        end: clip.startSec + clip.durationSec,
      });
    }
  }
  return out;
}

function applyEnvelope(
  gain: GainNode,
  _ctx: AudioContext,
  when: number,
  duration: number,
  baseVol: number,
  clip: TimelineClip,
) {
  const fadeIn = Math.min(clip.fadeInSec ?? 0, duration / 2);
  const fadeOut = Math.min(clip.fadeOutSec ?? 0, duration / 2);
  gain.gain.cancelScheduledValues(when);
  if (fadeIn > 0) {
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(baseVol, when + fadeIn);
  } else {
    gain.gain.setValueAtTime(baseVol, when);
  }
  if (fadeOut > 0) {
    const fadeStart = when + duration - fadeOut;
    gain.gain.setValueAtTime(baseVol, fadeStart);
    gain.gain.linearRampToValueAtTime(0, when + duration);
  }
}

function applyDucking(
  gain: GainNode,
  _ctx: AudioContext,
  when: number,
  clipStart: number,
  remain: number,
  fromSec: number,
  baseVol: number,
  dialogue: Array<{ start: number; end: number }>,
) {
  const clipEnd = clipStart + remain;
  for (const d of dialogue) {
    const overlapStart = Math.max(clipStart, d.start, fromSec);
    const overlapEnd = Math.min(clipEnd, d.end);
    if (overlapEnd <= overlapStart) continue;
    const t0 = when + (overlapStart - Math.max(clipStart, fromSec));
    const t1 = when + (overlapEnd - Math.max(clipStart, fromSec));
    const ducked = baseVol * DUCK_GAIN;
    gain.gain.setValueAtTime(baseVol, Math.max(when, t0 - DUCK_RAMP_SEC));
    gain.gain.linearRampToValueAtTime(ducked, t0);
    gain.gain.setValueAtTime(ducked, t1);
    gain.gain.linearRampToValueAtTime(baseVol, t1 + DUCK_RAMP_SEC);
  }
}

export function videoClipsAt(
  tracks: TimelineTrack[],
  t: number,
): TimelineClip[] {
  const out: TimelineClip[] = [];
  for (const track of tracks) {
    if (track.kind !== "video" || track.muted) continue;
    for (const clip of track.clips) {
      if (t >= clip.startSec && t < clip.startSec + clip.durationSec) {
        out.push(clip);
      }
    }
  }
  return out;
}

export function textClipsAt(
  tracks: TimelineTrack[],
  t: number,
): TimelineClip[] {
  const out: TimelineClip[] = [];
  for (const track of tracks) {
    if (
      (track.kind !== "titles" && track.kind !== "dialogue") ||
      track.muted
    )
      continue;
    for (const clip of track.clips) {
      if (
        clip.source.type === "text" &&
        t >= clip.startSec &&
        t < clip.startSec + clip.durationSec
      ) {
        out.push(clip);
      }
    }
  }
  return out;
}
