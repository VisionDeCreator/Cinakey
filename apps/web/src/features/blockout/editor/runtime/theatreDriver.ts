import { getProject, type ISheet, type ISheetObject } from "@theatre/core";
import {
  BLOCKOUT_THEATRE_SHEET_ID,
  buildTheatreProjectState,
  type BlockoutNode,
  type BlockoutTracks,
  type BlockoutTransform,
} from "@cinakey/shared";

type TransformProps = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
};

let projectCounter = 0;

function toProps(t: BlockoutTransform): TransformProps {
  const [px, py, pz] = t.position;
  const [rx, ry, rz] = t.rotation;
  const [sx, sy, sz] = t.scale;
  return {
    position: { x: px, y: py, z: pz },
    rotation: { x: rx, y: ry, z: rz },
    scale: { x: sx, y: sy, z: sz },
  };
}

export type AnimatedTransform = TransformProps;

/**
 * Theatre.js playback for one shot. Theatre core only reads keyframes from a
 * project state, so every edit builds a fresh project (unique id) from the
 * shot's tracks; sampling is synchronous (`sequence.position` then `value`).
 */
export class TheatreDriver {
  private sheet: ISheet;
  private objects = new Map<string, ISheetObject<TransformProps>>();

  constructor(
    nodes: BlockoutNode[],
    tracks: BlockoutTracks,
    durationSec: number,
    fps: number,
    scope = "shot",
  ) {
    const state = buildTheatreProjectState({ tracks, durationSec, fps });
    projectCounter += 1;
    const project = getProject(`cinakey-${scope}-${projectCounter}`, {
      state,
    });
    this.sheet = project.sheet(BLOCKOUT_THEATRE_SHEET_ID);
    for (const node of nodes) {
      if (!tracks[node.id]?.length) continue;
      this.objects.set(node.id, this.sheet.object(node.id, toProps(node.transform)));
    }
  }

  get animatedNodeIds(): string[] {
    return [...this.objects.keys()];
  }

  /** Sample every animated node at time `t` (seconds). */
  sample(t: number): Map<string, AnimatedTransform> {
    this.sheet.sequence.position = t;
    const out = new Map<string, AnimatedTransform>();
    for (const [id, obj] of this.objects) out.set(id, obj.value);
    return out;
  }

  dispose(): void {
    for (const id of this.objects.keys()) this.sheet.detachObject(id);
    this.objects.clear();
  }
}
