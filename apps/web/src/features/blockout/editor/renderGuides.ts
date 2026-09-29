import {
  ASPECT_DIMS,
  camAt,
  objAt,
  type BlockoutDocument,
} from "@cinakey/shared";
import * as THREE from "three";
import { buildObjectMesh } from "./runtime/objects";
import { LAYER_CONTENT } from "./runtime/layers";

export const GUIDE_TAGS = {
  keyframe: ["guide", "blockout-keyframe"],
  depth: ["guide", "blockout-depth"],
} as const;

const depthMat = new THREE.ShaderMaterial({
  uniforms: { uNear: { value: 0.5 }, uFar: { value: 45 } },
  vertexShader:
    "varying float vZ;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vZ=-mv.z;gl_Position=projectionMatrix*mv;}",
  fragmentShader:
    "uniform float uNear;uniform float uFar;varying float vZ;void main(){float d=clamp((vZ-uNear)/(uFar-uNear),0.0,1.0);d=pow(d,0.6);gl_FragColor=vec4(vec3(1.0-d),1.0);}",
});

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
}

function buildTempScene(doc: BlockoutDocument) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(doc.env?.sky ?? "#1c222a");
  scene.add(new THREE.HemisphereLight(0xc9d6e6, 0x2a241d, 0.75));
  const sun = new THREE.DirectionalLight(0xfff1dd, 0.85);
  scene.add(sun);
  scene.add(sun.target);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: 0x2c323b }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const groups = new Map<string, THREE.Group>();
  for (const o of doc.objects) {
    const g = buildObjectMesh(o);
    groups.set(o.id, g);
    scene.add(g);
  }
  return { scene, sun, groups };
}

function renderAt(
  doc: BlockoutDocument,
  frame: number,
  width: number,
  height: number,
  mode: "clay" | "depth",
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(width, height, false);
  const { scene, sun, groups } = buildTempScene(doc);
  const cam = new THREE.PerspectiveCamera(40, width / height, 0.05, 500);
  const pose = camAt(doc.camera.keys, frame);
  for (const o of doc.objects) {
    const g = groups.get(o.id);
    if (!g) continue;
    const s = objAt(o, frame);
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = (s.rot * Math.PI) / 180;
  }
  cam.position.set(...pose.pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(...pose.target);
  if (pose.roll) cam.rotateZ(THREE.MathUtils.degToRad(pose.roll));
  cam.filmGauge = doc.camera.sensor;
  cam.aspect = width / height;
  cam.setFocalLength(pose.focal);
  cam.layers.set(LAYER_CONTENT);
  const at = new THREE.Vector3(...pose.target);
  sun.position.copy(at).add(new THREE.Vector3(-12, 24, 14));
  sun.target.position.copy(at);

  if (mode === "depth") {
    scene.overrideMaterial = depthMat;
    scene.background = new THREE.Color(0);
    scene.fog = null;
  }
  renderer.render(scene, cam);
  renderer.dispose();
  renderer.forceContextLoss?.();
  return canvas;
}

/** Mid-frame keyframe + depth stills for each cut marker. */
export async function renderGuidesForDocument(doc: BlockoutDocument): Promise<
  Array<{
    shotId?: string;
    n: number;
    keyframe: Blob;
    depth: Blob;
    width: number;
    height: number;
  }>
> {
  const [bw, bh] = ASPECT_DIMS[doc.aspect] ?? [1280, 720];
  const width = bw;
  const height = bh;
  const cuts = doc.shots.length
    ? doc.shots
    : [{ n: 1, start: 0, end: doc.frames, desc: "", shotId: undefined }];
  const out: Array<{
    shotId?: string;
    n: number;
    keyframe: Blob;
    depth: Blob;
    width: number;
    height: number;
  }> = [];
  for (const cut of cuts) {
    const mid = Math.floor((cut.start + cut.end) / 2);
    const keyCanvas = renderAt(doc, mid, width, height, "clay");
    const depthCanvas = renderAt(doc, mid, width, height, "depth");
    out.push({
      shotId: cut.shotId,
      n: cut.n,
      keyframe: await canvasToBlob(keyCanvas),
      depth: await canvasToBlob(depthCanvas),
      width,
      height,
    });
  }
  return out;
}

/** @deprecated Use renderGuidesForDocument */
export async function renderGuideImages() {
  throw new Error("renderGuideImages removed — use renderGuidesForDocument");
}
