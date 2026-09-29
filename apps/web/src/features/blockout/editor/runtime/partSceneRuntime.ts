import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  ASPECT_DIMS,
  camAt,
  objAt,
  type BlockoutDocument,
  type BlockoutObject,
  type CameraPose,
} from "@cinakey/shared";
import {
  LAYER_CONTENT,
  LAYER_GIZMOS,
  LAYER_GRID,
  LAYER_LABELS,
} from "./layers";
import { buildObjectMesh } from "./objects";

export type GizmoMode = "translate" | "rotate" | "scale";
export type PassMode = "clay" | "depth";
export type MaximizeView = "split" | "shot" | "director";

export type LiveCamera = {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  focal: number;
  roll: number;
};

export type RuntimeCallbacks = {
  onSelectObject: (id: string | null) => void;
  onCameraDirty: () => void;
  onObjectMoved: (
    id: string,
    pose: { x: number; z: number; y: number; rot: number },
  ) => void;
};

const depthMat = new THREE.ShaderMaterial({
  uniforms: { uNear: { value: 0.5 }, uFar: { value: 45 } },
  vertexShader:
    "varying float vZ;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vZ=-mv.z;gl_Position=projectionMatrix*mv;}",
  fragmentShader:
    "uniform float uNear;uniform float uFar;varying float vZ;void main(){float d=clamp((vZ-uNear)/(uFar-uNear),0.0,1.0);d=pow(d,0.6);gl_FragColor=vec4(vec3(1.0-d),1.0);}",
});

function setLayer(obj: THREE.Object3D, layer: number) {
  obj.traverse((c) => c.layers.set(layer));
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

export function aspectDims(aspect: string): [number, number] {
  return ASPECT_DIMS[aspect] ?? [1280, 720];
}

export function parseAspect(aspect: string): number {
  const [w, h] = aspectDims(aspect);
  return w / h;
}

/**
 * Imperative three.js runtime for a part-scoped blockout document.
 * Dual viewports share one scene; poses come from camAt / objAt.
 */
export class PartSceneRuntime {
  readonly scene = new THREE.Scene();
  readonly shotCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 500);
  readonly dirCam = new THREE.PerspectiveCamera(45, 1, 0.1, 800);
  readonly live: LiveCamera = {
    pos: new THREE.Vector3(0, 1.6, 6),
    target: new THREE.Vector3(0, 1.4, 0),
    focal: 35,
    roll: 0,
  };

  private shotRenderer: THREE.WebGLRenderer | null = null;
  private dirRenderer: THREE.WebGLRenderer | null = null;
  private shotCanvas: HTMLCanvasElement | null = null;
  private hudCanvas: HTMLCanvasElement | null = null;
  private transform: TransformControls | null = null;
  private transformHelper: THREE.Object3D | null = null;

  private objGroups = new Map<string, THREE.Group>();
  private doc: BlockoutDocument | null = null;
  private frame = 0;
  private cameraDirty = false;
  private passMode: PassMode = "clay";
  private showGuides = true;
  private showLabels = true;
  private showGrid = true;
  private selectedId: string | null = null;
  private disposed = false;
  private raf = 0;
  private needsRender = true;
  private hudW = 0;
  private hudH = 0;

  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private ground: THREE.Mesh;
  private grid: THREE.GridHelper;
  private gizmo: THREE.Group;
  private frustum: THREE.LineSegments;
  private frustumGeo: THREE.BufferGeometry;
  private targetMesh: THREE.Mesh;
  private aimLine: THREE.Line;
  private aimGeo: THREE.BufferGeometry;
  private pathLine: THREE.Line;
  private pathGeo: THREE.BufferGeometry;
  private keyDots = new THREE.Group();
  private keyDotGeo = new THREE.SphereGeometry(0.09, 12, 8);
  private keyDotMat = new THREE.MeshBasicMaterial({ color: 0xe6a23c });

  private orbit = {
    target: new THREE.Vector3(0, 1, -3),
    theta: 0.85,
    phi: 1.02,
    radius: 17,
    top: false,
  };

  private sky = new THREE.Color("#1c222a");
  private sunOff = new THREE.Vector3(-12, 24, 14);
  private resizeObs: ResizeObserver[] = [];
  private shotStage: HTMLElement | null = null;
  private dirStage: HTMLElement | null = null;

  constructor(private readonly cb: RuntimeCallbacks) {
    this.scene.background = this.sky;
    this.scene.fog = new THREE.Fog(this.sky, 60, 160);

    this.hemi = new THREE.HemisphereLight(0xc9d6e6, 0x2a241d, 0.75);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff1dd, 0.85);
    this.sun.position.set(-12, 24, 14);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -22,
      right: 22,
      top: 22,
      bottom: -22,
      near: 1,
      far: 80,
    });
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshLambertMaterial({ color: 0x2c323b }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.grid = new THREE.GridHelper(40, 40, 0x4a5361, 0x363d48);
    this.grid.position.y = 0.002;
    setLayer(this.grid, LAYER_GRID);
    this.scene.add(this.grid);

    this.shotCam.layers.set(LAYER_CONTENT);
    [LAYER_CONTENT, LAYER_LABELS, LAYER_GIZMOS, LAYER_GRID].forEach((l) =>
      this.dirCam.layers.enable(l),
    );

    this.gizmo = new THREE.Group();
    const camBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.3, 0.48),
      new THREE.MeshBasicMaterial({ color: 0xe6a23c }),
    );
    camBody.position.z = 0.26;
    camBody.userData.pick = "cam";
    this.gizmo.add(camBody);
    this.frustumGeo = new THREE.BufferGeometry();
    this.frustumGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array(3 * 2 * 11), 3),
    );
    this.frustum = new THREE.LineSegments(
      this.frustumGeo,
      new THREE.LineBasicMaterial({ color: 0xe6a23c }),
    );
    this.gizmo.add(this.frustum);
    this.scene.add(this.gizmo);

    this.targetMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16),
      new THREE.MeshBasicMaterial({ color: 0xf2e2c4 }),
    );
    this.targetMesh.userData.pick = "target";
    this.scene.add(this.targetMesh);

    this.aimGeo = new THREE.BufferGeometry();
    this.aimGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array(6), 3),
    );
    this.aimLine = new THREE.Line(
      this.aimGeo,
      new THREE.LineDashedMaterial({
        color: 0xe6a23c,
        dashSize: 0.2,
        gapSize: 0.15,
        transparent: true,
        opacity: 0.7,
      }),
    );
    this.scene.add(this.aimLine);

    this.pathGeo = new THREE.BufferGeometry();
    this.pathLine = new THREE.Line(
      this.pathGeo,
      new THREE.LineBasicMaterial({
        color: 0xe6a23c,
        transparent: true,
        opacity: 0.65,
      }),
    );
    this.scene.add(this.pathLine);
    this.scene.add(this.keyDots);

    [
      this.gizmo,
      this.targetMesh,
      this.aimLine,
      this.pathLine,
      this.keyDots,
    ].forEach((o) => setLayer(o, LAYER_GIZMOS));

    this.updateDirCam();
  }

  mount(opts: {
    shotCanvas: HTMLCanvasElement;
    dirCanvas: HTMLCanvasElement;
    hudCanvas: HTMLCanvasElement;
    shotStage: HTMLElement;
    dirStage: HTMLElement;
  }) {
    this.shotCanvas = opts.shotCanvas;
    this.hudCanvas = opts.hudCanvas;
    this.shotStage = opts.shotStage;
    this.dirStage = opts.dirStage;

    this.shotRenderer = new THREE.WebGLRenderer({
      canvas: opts.shotCanvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.dirRenderer = new THREE.WebGLRenderer({
      canvas: opts.dirCanvas,
      antialias: true,
    });
    for (const r of [this.shotRenderer, this.dirRenderer]) {
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.transform = new TransformControls(this.dirCam, opts.dirCanvas);
    this.transform.setSize(0.75);
    this.transformHelper = this.transform.getHelper();
    setLayer(this.transformHelper, LAYER_GIZMOS);
    this.scene.add(this.transformHelper);
    this.transform.addEventListener("dragging-changed", (e) => {
      const dragging = Boolean((e as unknown as { value: boolean }).value);
      if (!dragging && this.selectedId && this.transform?.object) {
        const obj = this.transform.object;
        this.cb.onObjectMoved(this.selectedId, {
          x: round2(obj.position.x),
          z: round2(obj.position.z),
          y: round2(obj.position.y),
          rot: Math.round((obj.rotation.y * 180) / Math.PI),
        });
      }
      this.invalidate();
    });
    this.transform.addEventListener("objectChange", () => this.invalidate());

    this.bindShotInteraction(opts.shotStage);
    this.bindDirInteraction(opts.dirCanvas);

    const ro1 = new ResizeObserver(() => this.layoutShot());
    ro1.observe(opts.shotStage);
    const ro2 = new ResizeObserver(() => this.layoutDir());
    ro2.observe(opts.dirStage);
    this.resizeObs = [ro1, ro2];

    this.layoutShot();
    this.layoutDir();
    this.loop();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const ro of this.resizeObs) ro.disconnect();
    this.transform?.dispose();
    this.shotRenderer?.dispose();
    this.dirRenderer?.dispose();
    for (const g of this.objGroups.values()) this.scene.remove(g);
    this.objGroups.clear();
  }

  setDocument(doc: BlockoutDocument) {
    this.doc = doc;
    this.applyEnv(doc);
    this.rebuildObjects();
    this.syncLiveFromCurve();
    this.applyObjects(this.frame);
    this.rebuildPath();
    // layoutShot early-outs while !doc; re-layout now that a document is set
    this.layoutShot();
    this.layoutDir();
    this.invalidate();
  }

  setFrame(frame: number, forceSync = false) {
    this.frame = frame;
    if (!this.cameraDirty || forceSync) this.syncLiveFromCurve();
    this.applyObjects(frame);
    this.invalidate();
  }

  getFrame() {
    return this.frame;
  }

  setCameraDirty(dirty: boolean) {
    this.cameraDirty = dirty;
    if (!dirty) this.syncLiveFromCurve();
    this.invalidate();
  }

  isCameraDirty() {
    return this.cameraDirty;
  }

  setPassMode(mode: PassMode) {
    this.passMode = mode;
    this.invalidate();
  }

  setShowGuides(v: boolean) {
    this.showGuides = v;
    this.invalidate();
  }

  setGizmoMode(mode: GizmoMode) {
    this.transform?.setMode(mode);
  }

  selectObject(id: string | null) {
    this.selectedId = id;
    if (!this.transform) return;
    if (!id) {
      this.transform.detach();
    } else {
      const g = this.objGroups.get(id);
      if (g) this.transform.attach(g);
      else this.transform.detach();
    }
    this.invalidate();
  }

  invalidate() {
    this.needsRender = true;
  }

  getLivePose(): CameraPose {
    return {
      pos: [this.live.pos.x, this.live.pos.y, this.live.pos.z],
      target: [this.live.target.x, this.live.target.y, this.live.target.z],
      focal: this.live.focal,
      roll: this.live.roll,
    };
  }

  setLivePose(pose: CameraPose, markDirty = true) {
    this.live.pos.set(...pose.pos);
    this.live.target.set(...pose.target);
    this.live.focal = pose.focal;
    this.live.roll = pose.roll;
    if (markDirty) {
      this.cameraDirty = true;
      this.cb.onCameraDirty();
    }
    this.invalidate();
  }

  /** Offscreen render one frame for export / guides. */
  renderFrameToCanvas(
    canvas: HTMLCanvasElement,
    frame: number,
    opts: {
      mode: PassMode;
      burnIn: boolean;
      width: number;
      height: number;
      labels?: boolean;
    },
  ): void {
    if (!this.doc) return;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(opts.width, opts.height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const cam = new THREE.PerspectiveCamera(
      40,
      opts.width / opts.height,
      0.05,
      500,
    );
    const pose = camAt(this.doc.camera.keys, frame);
    this.applyPose(cam, pose, opts.width / opts.height);
    this.placeSun(new THREE.Vector3(...pose.target));
    this.applyObjects(frame);
    this.setupShotCamLayers(cam, {
      labels: Boolean(opts.labels) && opts.mode === "clay",
      grid: false,
    });
    this.renderShot(renderer, cam, { mode: opts.mode });

    if (opts.burnIn) {
      const comp = document.createElement("canvas");
      comp.width = opts.width;
      comp.height = opts.height;
      const cg = comp.getContext("2d")!;
      cg.drawImage(canvas, 0, 0);
      this.drawHud(cg, opts.width, opts.height, {
        guides: false,
        hud: true,
        frame,
        focal: pose.focal,
        scale: opts.width / 900,
      });
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // WebGL canvas — draw via 2d copy on a temp; callers usually composite
        void ctx;
      }
      // Mutate by reading pixels back through drawImage path for encoder
      const g = canvas.getContext("2d");
      if (!g) {
        // keep GL pixels; burn-in drawn by caller on 2d composite
      }
    }

    renderer.dispose();
    renderer.forceContextLoss?.();
  }

  /** Shared helper used by video export. */
  sampleFrame(
    frame: number,
    aspect: number,
  ): {
    pose: CameraPose;
    apply: (cam: THREE.PerspectiveCamera) => void;
  } {
    const pose = this.doc
      ? camAt(this.doc.camera.keys, frame)
      : {
          pos: [0, 1.6, 6] as [number, number, number],
          target: [0, 1.4, 0] as [number, number, number],
          focal: 35,
          roll: 0,
        };
    return {
      pose,
      apply: (cam) => {
        this.applyObjects(frame);
        this.applyPose(cam, pose, aspect);
        this.placeSun(new THREE.Vector3(...pose.target));
      },
    };
  }

  getScene() {
    return this.scene;
  }

  getPassMode() {
    return this.passMode;
  }

  setupShotCamLayers(
    cam: THREE.Camera,
    opts: { labels: boolean; grid: boolean },
  ) {
    cam.layers.set(LAYER_CONTENT);
    if (opts.labels) cam.layers.enable(LAYER_LABELS);
    if (opts.grid) cam.layers.enable(LAYER_GRID);
  }

  renderShot(
    renderer: THREE.WebGLRenderer,
    cam: THREE.Camera,
    opts: { mode: PassMode },
  ) {
    const prevBg = this.scene.background;
    const prevFog = this.scene.fog;
    const prevOverride = this.scene.overrideMaterial;
    if (opts.mode === "depth") {
      this.scene.overrideMaterial = depthMat;
      this.scene.background = new THREE.Color(0);
      this.scene.fog = null;
    }
    renderer.render(this.scene, cam);
    this.scene.overrideMaterial = prevOverride;
    this.scene.background = prevBg;
    this.scene.fog = prevFog;
  }

  drawHud(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    opts: {
      guides?: boolean;
      hud?: boolean;
      frame: number;
      focal: number;
      scale?: number;
    },
  ) {
    if (!this.doc) return;
    g.clearRect(0, 0, w, h);
    const s = opts.scale || 1;
    if (opts.guides) {
      g.strokeStyle = "rgba(255,255,255,.28)";
      g.lineWidth = 1 * s;
      g.beginPath();
      for (const t of [1 / 3, 2 / 3]) {
        g.moveTo(w * t, 0);
        g.lineTo(w * t, h);
        g.moveTo(0, h * t);
        g.lineTo(w, h * t);
      }
      g.stroke();
      g.strokeStyle = "rgba(230,162,60,.55)";
      g.setLineDash([6 * s, 5 * s]);
      g.strokeRect(w * 0.035, h * 0.035, w * 0.93, h * 0.93);
      g.strokeStyle = "rgba(255,255,255,.3)";
      g.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
      g.setLineDash([]);
      g.strokeStyle = "rgba(255,255,255,.55)";
      const c = 8 * s;
      g.beginPath();
      g.moveTo(w / 2 - c, h / 2);
      g.lineTo(w / 2 + c, h / 2);
      g.moveTo(w / 2, h / 2 - c);
      g.lineTo(w / 2, h / 2 + c);
      g.stroke();
    }
    if (opts.hud) {
      const fs = Math.round(12 * s);
      const pad = Math.round(10 * s);
      g.font = `500 ${fs}px "IBM Plex Mono", ui-monospace, monospace`;
      g.textBaseline = "top";
      const txt = (t: string, x: number, y: number, al: CanvasTextAlign) => {
        g.textAlign = al;
        g.fillStyle = "rgba(0,0,0,.55)";
        const m = g.measureText(t).width;
        const bx = al === "right" ? x - m - 6 * s : x - 6 * s;
        g.fillRect(bx, y - 3 * s, m + 12 * s, fs + 6 * s);
        g.fillStyle = "#f1f3f6";
        g.fillText(t, x, y);
      };
      const cut =
        this.doc.shots.find(
          (s) => opts.frame >= s.start && opts.frame < s.end,
        ) ?? this.doc.shots[this.doc.shots.length - 1];
      const title = cut
        ? `Shot ${cut.n}${cut.shotType ? ` · ${cut.shotType}` : ""}`
        : this.doc.name;
      txt(title, pad + 6 * s, pad + 3 * s, "left");
      txt(
        `${Math.round(opts.focal)}mm  ${this.doc.camera.sensor}mm`,
        w - pad - 6 * s,
        pad + 3 * s,
        "right",
      );
      const fps = this.doc.fps;
      const ff = opts.frame % fps;
      const sec = Math.floor(opts.frame / fps);
      const p = (n: number) => String(n).padStart(2, "0");
      const tc = `${p(Math.floor(sec / 3600))}:${p(Math.floor(sec / 60) % 60)}:${p(sec % 60)}:${p(ff)}`;
      txt(tc, pad + 6 * s, h - pad - fs - 3 * s, "left");
      txt(
        `F ${String(opts.frame).padStart(3, "0")} / ${this.doc.frames}  ${fps}fps`,
        w - pad - 6 * s,
        h - pad - fs - 3 * s,
        "right",
      );
    }
  }

  // ---- internals ----------------------------------------------------------

  private applyEnv(doc: BlockoutDocument) {
    const sky = doc.env?.sky ? new THREE.Color(doc.env.sky) : this.sky;
    this.scene.background = sky;
    if (doc.env?.fog === false) this.scene.fog = null;
    else {
      this.scene.fog = new THREE.Fog(
        sky,
        doc.env?.fogNear ?? 60,
        doc.env?.fogFar ?? 160,
      );
    }
    this.ground.visible = doc.env?.ground !== false;
    if (doc.env?.groundColor) {
      (this.ground.material as THREE.MeshLambertMaterial).color.set(
        doc.env.groundColor,
      );
    }
  }

  private rebuildObjects() {
    for (const g of this.objGroups.values()) this.scene.remove(g);
    this.objGroups.clear();
    if (!this.doc) return;
    for (const o of this.doc.objects) {
      const g = buildObjectMesh(o);
      this.objGroups.set(o.id, g);
      this.scene.add(g);
    }
    if (this.selectedId) this.selectObject(this.selectedId);
  }

  private applyObjects(f: number) {
    if (!this.doc) return;
    for (const o of this.doc.objects) {
      const g = this.objGroups.get(o.id);
      if (!g) continue;
      const s = objAt(o, f);
      g.position.set(s.x, s.y, s.z);
      g.rotation.y = (s.rot * Math.PI) / 180;
    }
  }

  private syncLiveFromCurve() {
    if (!this.doc) return;
    const pose = camAt(this.doc.camera.keys, this.frame);
    this.live.pos.set(...pose.pos);
    this.live.target.set(...pose.target);
    this.live.focal = pose.focal;
    this.live.roll = pose.roll;
  }

  private applyPose(
    cam: THREE.PerspectiveCamera,
    pose: CameraPose,
    aspect: number,
  ) {
    cam.position.set(...pose.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(...pose.target);
    if (pose.roll) cam.rotateZ(THREE.MathUtils.degToRad(pose.roll));
    cam.filmGauge = this.doc?.camera.sensor ?? 36;
    cam.aspect = aspect;
    cam.setFocalLength(pose.focal);
  }

  private placeSun(at: THREE.Vector3) {
    this.sun.position.copy(at).add(this.sunOff);
    this.sun.target.position.copy(at);
    this.sun.target.updateMatrixWorld();
  }

  private rebuildPath() {
    if (!this.doc) return;
    const F = this.doc.frames;
    const n = Math.max(2, Math.min(240, F));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const pose = camAt(this.doc.camera.keys, (F * i) / n);
      pts.push(new THREE.Vector3(...pose.pos));
    }
    this.pathGeo.setFromPoints(pts);
    this.keyDots.clear();
    for (const k of this.doc.camera.keys) {
      const m = new THREE.Mesh(this.keyDotGeo, this.keyDotMat);
      m.position.fromArray(k.pos);
      m.layers.set(LAYER_GIZMOS);
      this.keyDots.add(m);
    }
  }

  private updateGizmo() {
    this.gizmo.position.copy(this.shotCam.position);
    this.gizmo.quaternion.copy(this.shotCam.quaternion);
    const L = 1.1;
    const h = L * Math.tan(THREE.MathUtils.degToRad(this.shotCam.fov) / 2);
    const w = h * this.shotCam.aspect;
    const c: [number, number, number][] = [
      [-w, -h, -L],
      [w, -h, -L],
      [w, h, -L],
      [-w, h, -L],
    ];
    const posAttr = this.frustumGeo.attributes.position;
    if (!posAttr) return;
    const a = posAttr.array as Float32Array;
    let i = 0;
    const seg = (p: number[], q: number[]) => {
      a[i++] = p[0]!;
      a[i++] = p[1]!;
      a[i++] = p[2]!;
      a[i++] = q[0]!;
      a[i++] = q[1]!;
      a[i++] = q[2]!;
    };
    const o = [0, 0, 0];
    for (let j = 0; j < 4; j++) {
      seg(o, c[j]!);
      seg(c[j]!, c[(j + 1) % 4]!);
    }
    const up = [0, h * 1.35, -L];
    seg([-w * 0.35, h * 1.05, -L], up);
    seg(up, [w * 0.35, h * 1.05, -L]);
    seg([-w * 0.35, h * 1.05, -L], [w * 0.35, h * 1.05, -L]);
    posAttr.needsUpdate = true;
    this.frustumGeo.computeBoundingSphere();
    this.targetMesh.position.copy(this.live.target);
    const aimAttr = this.aimGeo.attributes.position;
    if (!aimAttr) return;
    const aa = aimAttr.array as Float32Array;
    this.shotCam.position.toArray(aa, 0);
    this.live.target.toArray(aa, 3);
    aimAttr.needsUpdate = true;
    this.aimGeo.computeBoundingSphere();
    this.aimLine.computeLineDistances();
  }

  private updateDirCam() {
    const { theta, phi, radius, target: t, top } = this.orbit;
    this.dirCam.position.set(
      t.x + radius * Math.sin(phi) * Math.sin(theta),
      t.y + radius * Math.cos(phi),
      t.z + radius * Math.sin(phi) * Math.cos(theta),
    );
    this.dirCam.up.set(0, 1, 0);
    if (top) this.dirCam.up.set(0, 0, -1);
    this.dirCam.lookAt(t);
  }

  private layoutShot() {
    if (!this.shotStage || !this.shotRenderer || !this.doc || !this.hudCanvas)
      return;
    const [W, H] = aspectDims(this.doc.aspect);
    const A = W / H;
    const cw = this.shotStage.clientWidth - 16;
    const ch = this.shotStage.clientHeight - 16;
    if (cw < 10 || ch < 10) return;
    let w: number;
    let h: number;
    if (cw / ch > A) {
      h = ch;
      w = h * A;
    } else {
      w = cw;
      h = w / A;
    }
    w = Math.floor(w);
    h = Math.floor(h);
    this.shotRenderer.setSize(w, h, false);
    if (this.shotCanvas) {
      this.shotCanvas.style.width = `${w}px`;
      this.shotCanvas.style.height = `${h}px`;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.hudCanvas.width = w * dpr;
    this.hudCanvas.height = h * dpr;
    this.hudCanvas.style.width = `${w}px`;
    this.hudCanvas.style.height = `${h}px`;
    this.hudW = w;
    this.hudH = h;
    this.invalidate();
  }

  private layoutDir() {
    if (!this.dirStage || !this.dirRenderer) return;
    const w = this.dirStage.clientWidth;
    const h = this.dirStage.clientHeight;
    if (w < 10 || h < 10) return;
    this.dirRenderer.setSize(w, h, false);
    this.dirCam.aspect = w / h;
    this.dirCam.updateProjectionMatrix();
    this.invalidate();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (
      !this.needsRender ||
      !this.doc ||
      !this.shotRenderer ||
      !this.dirRenderer
    )
      return;
    this.needsRender = false;

    const aspect = parseAspect(this.doc.aspect);
    this.applyPose(this.shotCam, this.getLivePose(), aspect);
    this.placeSun(this.live.target.clone());
    this.updateGizmo();

    this.setupShotCamLayers(this.shotCam, {
      labels: this.showLabels && this.passMode === "clay",
      grid: this.showGrid && this.passMode === "clay",
    });
    this.renderShot(this.shotRenderer, this.shotCam, { mode: this.passMode });

    if (this.hudCanvas && this.hudW > 0) {
      const g = this.hudCanvas.getContext("2d");
      if (g) {
        const dpr = this.hudCanvas.width / Math.max(1, this.hudW);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.drawHud(g, this.hudW, this.hudH, {
          guides: this.showGuides,
          hud: true,
          frame: this.frame,
          focal: this.live.focal,
        });
      }
    }

    this.updateDirCam();
    this.dirRenderer.render(this.scene, this.dirCam);
  };

  private bindShotInteraction(el: HTMLElement) {
    let drag: { x: number; y: number; truck: boolean } | null = null;
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      drag = {
        x: e.clientX,
        y: e.clientY,
        truck: e.shiftKey || e.button === 2,
      };
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      const fovR = THREE.MathUtils.degToRad(this.shotCam.fov);
      const k = fovR / Math.max(1, this.hudH);
      const fwd = this.live.target.clone().sub(this.live.pos);
      const dist = fwd.length();
      fwd.normalize();
      const right = new THREE.Vector3()
        .crossVectors(fwd, new THREE.Vector3(0, 1, 0))
        .normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd);
      if (drag.truck) {
        const m = dist * k;
        const off = right
          .multiplyScalar(-dx * m)
          .add(up.multiplyScalar(dy * m));
        this.live.pos.add(off);
        this.live.target.add(off);
      } else {
        const yaw = Math.atan2(fwd.x, fwd.z) + dx * k * 0.9;
        let pitch =
          Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)) - dy * k * 0.9;
        pitch = THREE.MathUtils.clamp(pitch, -1.45, 1.45);
        const nf = new THREE.Vector3(
          Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          Math.cos(yaw) * Math.cos(pitch),
        );
        this.live.target.copy(this.live.pos).addScaledVector(nf, dist);
      }
      this.cameraDirty = true;
      this.cb.onCameraDirty();
      this.invalidate();
    });
    const end = () => {
      drag = null;
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (e.altKey) {
          this.live.focal = THREE.MathUtils.clamp(
            Math.round(this.live.focal * (e.deltaY > 0 ? 0.95 : 1.053)),
            10,
            200,
          );
        } else {
          const fwd = this.live.target.clone().sub(this.live.pos);
          const d = fwd.length();
          fwd.normalize();
          const step = -Math.sign(e.deltaY) * Math.max(0.05, d * 0.04);
          this.live.pos.addScaledVector(fwd, step);
          this.live.target.addScaledVector(fwd, step);
        }
        this.cameraDirty = true;
        this.cb.onCameraDirty();
        this.invalidate();
      },
      { passive: false },
    );
  }

  private bindDirInteraction(el: HTMLCanvasElement) {
    const ray = new THREE.Raycaster();
    ray.layers.enableAll();
    let drag:
      | { kind: "orbit"; x: number; y: number }
      | { kind: "pan"; x: number; y: number }
      | { kind: "obj" | "cam" | "target"; y: number }
      | null = null;

    const ndc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
    };
    const planeHit = (e: PointerEvent, y: number) => {
      ray.setFromCamera(ndc(e), this.dirCam);
      const p = new THREE.Vector3();
      return ray.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -y),
        p,
      )
        ? p
        : null;
    };

    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      if (this.transform?.dragging) return;
      el.setPointerCapture(e.pointerId);
      if (e.button === 1 || e.button === 2 || e.altKey) {
        drag = {
          kind: e.shiftKey ? "pan" : "orbit",
          x: e.clientX,
          y: e.clientY,
        };
        return;
      }
      ray.setFromCamera(ndc(e), this.dirCam);
      const hits = ray.intersectObjects(this.scene.children, true);
      for (const hit of hits) {
        let o: THREE.Object3D | null = hit.object;
        while (o) {
          if (o.userData.pick === "cam") {
            drag = { kind: "cam", y: this.live.pos.y };
            return;
          }
          if (o.userData.pick === "target") {
            drag = { kind: "target", y: this.live.target.y };
            return;
          }
          if (o.userData.objId) {
            this.cb.onSelectObject(o.userData.objId as string);
            drag = { kind: "obj", y: o.position.y };
            return;
          }
          o = o.parent;
        }
      }
      this.cb.onSelectObject(null);
      drag = { kind: "orbit", x: e.clientX, y: e.clientY };
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (drag.kind === "orbit") {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        this.orbit.theta -= dx * 0.005;
        this.orbit.phi = THREE.MathUtils.clamp(
          this.orbit.phi - dy * 0.005,
          0.08,
          Math.PI - 0.08,
        );
        this.invalidate();
      } else if (drag.kind === "pan") {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        this.dirCam.matrixWorld.extractBasis(right, up, new THREE.Vector3());
        const scale = this.orbit.radius * 0.0015;
        this.orbit.target.addScaledVector(right, -dx * scale);
        this.orbit.target.addScaledVector(up, dy * scale);
        this.invalidate();
      } else if (drag.kind === "cam") {
        const p = planeHit(e, drag.y);
        if (p) {
          this.live.pos.x = p.x;
          this.live.pos.z = p.z;
          this.cameraDirty = true;
          this.cb.onCameraDirty();
          this.invalidate();
        }
      } else if (drag.kind === "target") {
        const p = planeHit(e, drag.y);
        if (p) {
          this.live.target.x = p.x;
          this.live.target.z = p.z;
          this.cameraDirty = true;
          this.cb.onCameraDirty();
          this.invalidate();
        }
      } else if (drag.kind === "obj" && this.selectedId) {
        const p = planeHit(e, drag.y);
        const g = this.objGroups.get(this.selectedId);
        if (p && g) {
          g.position.x = p.x;
          g.position.z = p.z;
          this.invalidate();
        }
      }
    });
    el.addEventListener("pointerup", (e) => {
      if (drag?.kind === "obj" && this.selectedId) {
        const g = this.objGroups.get(this.selectedId);
        if (g) {
          this.cb.onObjectMoved(this.selectedId, {
            x: round2(g.position.x),
            z: round2(g.position.z),
            y: round2(g.position.y),
            rot: Math.round((g.rotation.y * 180) / Math.PI),
          });
        }
      }
      drag = null;
      void e;
    });
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.orbit.radius = THREE.MathUtils.clamp(
          this.orbit.radius * (e.deltaY > 0 ? 1.08 : 0.92),
          2,
          120,
        );
        this.invalidate();
      },
      { passive: false },
    );
  }

  /** Call after document object list changes without full reload. */
  refreshObjects(objects: BlockoutObject[]) {
    if (!this.doc) return;
    this.doc = { ...this.doc, objects };
    this.rebuildObjects();
    this.applyObjects(this.frame);
    this.invalidate();
  }

  refreshCameraPath() {
    this.rebuildPath();
    if (!this.cameraDirty) this.syncLiveFromCurve();
    this.invalidate();
  }
}
