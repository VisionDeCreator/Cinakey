import * as THREE from "three";
import type { BlockoutNode, BlockoutTracks } from "@cinakey/shared";
import { SceneAssembly } from "./sceneAssembly";

export type RenderableShot = {
  nodes: BlockoutNode[];
  cameraNodeId: string;
  tracks: BlockoutTracks;
  durationSec: number;
  lensMm: number;
};

export function parseAspect(aspectRatio: string): number {
  const [w, h] = aspectRatio.split(":").map(Number);
  return w && h ? w / h : 16 / 9;
}

/** Even pixel size (H.264 needs even dimensions) for a long edge. */
export function frameSize(aspect: number, longEdge: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return aspect >= 1
    ? { width: even(longEdge), height: even(longEdge / aspect) }
    : { width: even(longEdge * aspect), height: even(longEdge) };
}

const depthMaterial = new THREE.ShaderMaterial({
  uniforms: { uNear: { value: 0.1 }, uFar: { value: 20 } },
  vertexShader: /* glsl */ `
    varying float vViewZ;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vViewZ = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uNear;
    uniform float uFar;
    varying float vViewZ;
    void main() {
      float d = clamp((vViewZ - uNear) / (uFar - uNear), 0.0, 1.0);
      gl_FragColor = vec4(vec3(1.0 - d), 1.0);
    }
  `,
});

/** Offscreen renderer of the shot camera view (no editor helpers). */
export class ShotRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  private renderer: THREE.WebGLRenderer;
  private assembly = new SceneAssembly(false);

  constructor(shot: RenderableShot, fps: number, width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.assembly.syncNodes(shot.nodes, shot.cameraNodeId);
    this.assembly.setLens(shot.lensMm, width / height);
    this.assembly.setTracks(shot.tracks, shot.durationSec, fps);
  }

  renderColor(t: number): HTMLCanvasElement {
    this.assembly.applyTime(t);
    this.renderer.render(this.assembly.scene, this.assembly.shotCamera);
    return this.canvas;
  }

  /** Linear depth, near = white, far = black; range fitted to the content. */
  renderDepth(t: number): HTMLCanvasElement {
    this.assembly.applyTime(t);
    const camera = this.assembly.shotCamera;
    camera.updateMatrixWorld();
    const bounds = this.assembly.contentBounds();
    let far = 20;
    if (!bounds.isEmpty()) {
      const camPos = camera.getWorldPosition(new THREE.Vector3());
      const corners: THREE.Vector3[] = [];
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
          for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
      far = Math.min(80, Math.max(5, ...corners.map((c) => c.distanceTo(camPos))) * 1.15);
    }
    depthMaterial.uniforms.uNear!.value = 0.1;
    depthMaterial.uniforms.uFar!.value = far;
    const scene = this.assembly.scene;
    const background = scene.background;
    scene.background = new THREE.Color("#000000");
    scene.overrideMaterial = depthMaterial;
    this.renderer.render(scene, camera);
    scene.overrideMaterial = null;
    scene.background = background;
    return this.canvas;
  }

  dispose() {
    this.assembly.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png"): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), type);
  });
}
