import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type {
  BlockoutNode,
  BlockoutTracks,
  BlockoutTransform,
  Vec3,
} from "@cinakey/shared";
import { HELPER_LAYER } from "./objects";
import { SceneAssembly } from "./sceneAssembly";

export type ViewMode = "orbit" | "shot";
export type GizmoMode = "translate" | "rotate" | "scale";
export type FrameRect = { left: number; top: number; width: number; height: number };

export type EditorCallbacks = {
  onSelect: (nodeId: string | null) => void;
  onTransformCommit: (nodeId: string, transform: BlockoutTransform) => void;
  onTime: (t: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onFrameRect: (rect: FrameRect) => void;
};

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function readTransform(obj: THREE.Object3D): BlockoutTransform {
  const v = (x: number, y: number, z: number): Vec3 => [round(x), round(y), round(z)];
  return {
    position: v(obj.position.x, obj.position.y, obj.position.z),
    rotation: v(obj.rotation.x, obj.rotation.y, obj.rotation.z),
    scale: v(obj.scale.x, obj.scale.y, obj.scale.z),
  };
}

export class EditorRuntime {
  private renderer: THREE.WebGLRenderer;
  private assembly = new SceneAssembly(true);
  private editCamera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
  private orbit: OrbitControls;
  private gizmo: TransformControls;
  private gizmoHelper: THREE.Object3D;
  private cameraHelper: THREE.CameraHelper | null = null;
  private selectionBox = new THREE.BoxHelper(new THREE.Object3D(), "#facc15");
  private raycaster = new THREE.Raycaster();
  private resizeObserver: ResizeObserver;
  private frameHandle = 0;
  private lastTick = 0;
  private needsRender = true;
  private disposed = false;

  private nodes = new Map<string, BlockoutNode>();
  private selectedId: string | null = null;
  private view: ViewMode = "orbit";
  private aspect = 16 / 9;
  private time = 0;
  private duration = 1;
  private playing = false;
  private pointerDown: { x: number; y: number } | null = null;
  private draggingGizmo = false;

  constructor(
    private readonly container: HTMLDivElement,
    private readonly cb: EditorCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.outline = "none";
    container.appendChild(canvas);

    this.editCamera.position.set(7, 5, 9);
    this.editCamera.layers.enable(HELPER_LAYER);
    this.orbit = new OrbitControls(this.editCamera, canvas);
    this.orbit.target.set(0, 1, 0);
    this.orbit.update();
    this.orbit.addEventListener("change", () => this.invalidate());

    this.gizmo = new TransformControls(this.editCamera, canvas);
    this.gizmo.setSize(0.8);
    this.gizmoHelper = this.gizmo.getHelper();
    this.assembly.scene.add(this.gizmoHelper);
    this.gizmo.addEventListener("dragging-changed", (e) => {
      const dragging = Boolean((e as unknown as { value: boolean }).value);
      this.draggingGizmo = dragging;
      this.orbit.enabled = !dragging && this.view === "orbit";
      if (!dragging && this.selectedId && this.gizmo.object) {
        this.cb.onTransformCommit(this.selectedId, readTransform(this.gizmo.object));
      }
    });
    this.gizmo.addEventListener("objectChange", () => this.invalidate());
    this.gizmo.addEventListener("change", () => this.invalidate());

    this.selectionBox.layers.set(HELPER_LAYER);
    this.selectionBox.visible = false;
    this.assembly.scene.add(this.selectionBox);
    this.raycaster.layers.enableAll();

    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointerup", this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(container);
    this.layout();
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  // ---- scene -------------------------------------------------------------

  setShot(nodes: BlockoutNode[], cameraNodeId: string, lensMm: number) {
    this.nodes = new Map(nodes.map((n) => [n.id, n]));
    this.assembly.syncNodes(nodes, cameraNodeId);
    this.assembly.setLens(lensMm, this.aspect);
    const cam = this.assembly.shotCamera;
    if (this.cameraHelper?.camera !== cam) {
      if (this.cameraHelper) {
        this.assembly.scene.remove(this.cameraHelper);
        this.cameraHelper.dispose();
      }
      this.cameraHelper = new THREE.CameraHelper(cam);
      this.cameraHelper.layers.set(HELPER_LAYER);
      this.assembly.scene.add(this.cameraHelper);
    }
    this.cameraHelper.update();
    if (this.selectedId && !this.nodes.has(this.selectedId)) this.select(null);
    else this.attachGizmo();
    this.assembly.applyTime(this.time);
    this.invalidate();
  }

  setTracks(tracks: BlockoutTracks, durationSec: number, fps: number) {
    this.duration = durationSec;
    this.assembly.setTracks(tracks, durationSec, fps);
    this.assembly.applyTime(this.time);
    this.invalidate();
  }

  setAspect(aspect: number) {
    this.aspect = aspect;
    this.layout();
  }

  setView(view: ViewMode) {
    if (view === this.view) {
      this.attachGizmo();
      return;
    }
    this.view = view;
    this.orbit.enabled = view === "orbit";
    this.gizmo.camera = view === "orbit" ? this.editCamera : this.assembly.shotCamera;
    this.attachGizmo();
    this.layout();
  }

  setGizmoMode(mode: GizmoMode) {
    this.gizmo.setMode(mode);
    this.invalidate();
  }

  select(nodeId: string | null) {
    this.selectedId = nodeId;
    this.attachGizmo();
    this.invalidate();
  }

  /** Current (possibly animated) transform of a node. */
  currentTransform(nodeId: string): BlockoutTransform | null {
    const obj = this.assembly.objectFor(nodeId);
    return obj ? readTransform(obj) : null;
  }

  /** Put the orbit camera where the shot camera is (helps framing). */
  orbitFromShotCamera() {
    const cam = this.assembly.shotCamera;
    cam.updateMatrixWorld();
    this.editCamera.position.copy(cam.getWorldPosition(new THREE.Vector3()));
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    this.orbit.target.copy(this.editCamera.position).addScaledVector(dir, 4);
    this.orbit.update();
    this.invalidate();
  }

  private attachGizmo() {
    const obj = this.selectedId ? this.assembly.objectFor(this.selectedId) : undefined;
    const node = this.selectedId ? this.nodes.get(this.selectedId) : undefined;
    const lookingThrough = this.view === "shot" && node?.kind === "camera";
    if (obj && node && node.kind !== "ground" && !lookingThrough) {
      if (this.gizmo.object !== obj) this.gizmo.attach(obj);
      this.selectionBox.setFromObject(obj);
      this.selectionBox.visible = node.kind !== "light" && node.kind !== "camera";
    } else {
      this.gizmo.detach();
      this.selectionBox.visible = false;
    }
  }

  // ---- time --------------------------------------------------------------

  setTime(t: number) {
    this.time = Math.min(Math.max(0, t), this.duration);
    this.assembly.applyTime(this.time);
    this.cb.onTime(this.time);
    this.invalidate();
  }

  play() {
    if (this.playing) return;
    if (this.time >= this.duration - 1e-3) this.setTime(0);
    this.playing = true;
    this.lastTick = performance.now();
    this.cb.onPlayingChange(true);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.cb.onPlayingChange(false);
  }

  // ---- loop / layout -----------------------------------------------------

  invalidate() {
    this.needsRender = true;
  }

  private tick = (now: number) => {
    if (this.disposed) return;
    this.frameHandle = requestAnimationFrame(this.tick);
    if (this.playing) {
      const dt = (now - this.lastTick) / 1000;
      this.lastTick = now;
      let t = this.time + dt;
      if (t >= this.duration) {
        t = this.duration;
        this.playing = false;
        this.cb.onPlayingChange(false);
      }
      this.time = t;
      this.assembly.applyTime(t);
      this.cb.onTime(t);
      this.needsRender = true;
    }
    if (!this.needsRender) return;
    this.needsRender = false;
    if (this.selectionBox.visible && this.gizmo.object) this.selectionBox.setFromObject(this.gizmo.object);
    const camera = this.view === "orbit" ? this.editCamera : this.assembly.shotCamera;
    this.cameraHelper!.visible = this.view === "orbit";
    this.gizmoHelper.visible = true;
    this.renderer.render(this.assembly.scene, camera);
  };

  private layout() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    let rect: FrameRect = { left: 0, top: 0, width: w, height: h };
    if (this.view === "shot") {
      const pad = 16;
      const aw = w - pad * 2;
      const ah = h - pad * 2;
      const fw = Math.min(aw, ah * this.aspect);
      const fh = fw / this.aspect;
      rect = { left: (w - fw) / 2, top: (h - fh) / 2, width: fw, height: fh };
    }
    const canvas = this.renderer.domElement;
    canvas.style.left = `${rect.left}px`;
    canvas.style.top = `${rect.top}px`;
    this.renderer.setSize(Math.round(rect.width), Math.round(rect.height));
    this.editCamera.aspect = rect.width / rect.height;
    this.editCamera.updateProjectionMatrix();
    this.cb.onFrameRect(rect);
    this.invalidate();
  }

  // ---- picking -----------------------------------------------------------

  private handlePointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY };
  };

  private handlePointerUp = (e: PointerEvent) => {
    const start = this.pointerDown;
    this.pointerDown = null;
    if (!start || this.draggingGizmo) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const camera = this.view === "orbit" ? this.editCamera : this.assembly.shotCamera;
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObjects(this.assembly.nodeObjects(), true);
    for (const hit of hits) {
      if (!hit.object.visible || hit.object instanceof THREE.Sprite) continue;
      if (hit.object instanceof THREE.LineSegments) continue;
      const id = hit.object.userData.nodeId as string | undefined;
      const node = id ? this.nodes.get(id) : undefined;
      if (!node || node.kind === "ground") continue;
      if (this.view === "shot" && node.kind === "camera") continue;
      this.cb.onSelect(id!);
      return;
    }
    this.cb.onSelect(null);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.cameraHelper?.dispose();
    this.assembly.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}
