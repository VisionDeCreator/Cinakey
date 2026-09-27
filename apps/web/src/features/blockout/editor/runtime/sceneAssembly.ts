import * as THREE from "three";
import type { BlockoutNode, BlockoutTracks } from "@cinakey/shared";
import {
  applyTransform,
  buildNodeObject,
  disposeObject,
  lensToCamera,
  structureKey,
} from "./objects";
import { TheatreDriver } from "./theatreDriver";

type Entry = {
  node: BlockoutNode;
  key: string;
  object: THREE.Object3D;
  extra?: THREE.Object3D;
};

export const SCENE_BACKGROUND = "#1c1c22";

/** A three.js scene rebuilt from blockout nodes and animated by Theatre. */
export class SceneAssembly {
  readonly scene = new THREE.Scene();
  private entries = new Map<string, Entry>();
  private driver: TheatreDriver | null = null;
  private cameraNodeId = "";
  private lensMm = 35;
  private aspect = 16 / 9;

  constructor(private readonly helpers: boolean) {
    this.scene.background = new THREE.Color(SCENE_BACKGROUND);
    this.scene.add(new THREE.HemisphereLight("#dbe4ff", "#2a2a30", 0.6));
  }

  get shotCamera(): THREE.PerspectiveCamera {
    const obj = this.entries.get(this.cameraNodeId)?.object;
    if (obj instanceof THREE.PerspectiveCamera) return obj;
    throw new Error("Shot camera missing");
  }

  objectFor(nodeId: string): THREE.Object3D | undefined {
    return this.entries.get(nodeId)?.object;
  }

  nodeObjects(): THREE.Object3D[] {
    return [...this.entries.values()].map((e) => e.object);
  }

  syncNodes(nodes: BlockoutNode[], cameraNodeId: string) {
    this.cameraNodeId = cameraNodeId;
    const seen = new Set<string>();
    let mannequinIndex = 0;
    for (const node of nodes) {
      seen.add(node.id);
      const index = node.kind === "mannequin" ? mannequinIndex++ : 0;
      const key = `${structureKey(node)}|${index}`;
      const existing = this.entries.get(node.id);
      if (existing && existing.key === key) {
        existing.node = node;
        applyTransform(existing.object, node.transform);
        continue;
      }
      if (existing) this.remove(node.id);
      const built = buildNodeObject(node, {
        helpers: this.helpers,
        mannequinIndex: index,
      });
      this.scene.add(built.object);
      if (built.extra) this.scene.add(built.extra);
      this.entries.set(node.id, { node, key, ...built });
    }
    for (const id of [...this.entries.keys()]) {
      if (!seen.has(id)) this.remove(id);
    }
    this.applyCamera();
  }

  setLens(lensMm: number, aspect: number) {
    this.lensMm = lensMm;
    this.aspect = aspect;
    this.applyCamera();
  }

  private applyCamera() {
    const cam = this.entries.get(this.cameraNodeId)?.object;
    if (cam instanceof THREE.PerspectiveCamera) {
      cam.aspect = this.aspect;
      lensToCamera(cam, this.lensMm);
    }
  }

  setTracks(tracks: BlockoutTracks, durationSec: number, fps: number) {
    this.driver?.dispose();
    const nodes = [...this.entries.values()].map((e) => e.node);
    this.driver = new TheatreDriver(nodes, tracks, durationSec, fps);
  }

  /** Pose every node at time `t`; nodes without keyframes use their base transform. */
  applyTime(t: number) {
    const animated = this.driver?.sample(t) ?? new Map();
    for (const [id, entry] of this.entries) {
      const v = animated.get(id);
      if (!v) {
        applyTransform(entry.object, entry.node.transform);
        continue;
      }
      entry.object.position.set(v.position.x, v.position.y, v.position.z);
      entry.object.rotation.set(v.rotation.x, v.rotation.y, v.rotation.z);
      entry.object.scale.set(v.scale.x, v.scale.y, v.scale.z);
    }
  }

  /** Bounds of visible content (excludes ground, lights and the camera). */
  contentBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const entry of this.entries.values()) {
      const kind = entry.node.kind;
      if (kind === "ground" || kind === "light" || kind === "camera") continue;
      box.expandByObject(entry.object);
    }
    return box;
  }

  private remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.scene.remove(entry.object);
    if (entry.extra) this.scene.remove(entry.extra);
    disposeObject(entry.object);
    this.entries.delete(id);
  }

  dispose() {
    this.driver?.dispose();
    for (const id of [...this.entries.keys()]) this.remove(id);
  }
}
