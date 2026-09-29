import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import {
  ASPECT_DIMS,
  camAt,
  objAt,
  timecodeString,
  type BlockoutDocument,
} from "@cinakey/shared";
import * as THREE from "three";
import { buildObjectMesh } from "@/features/blockout/editor/runtime/objects";
import {
  LAYER_CONTENT,
  LAYER_GRID,
  LAYER_LABELS,
} from "@/features/blockout/editor/runtime/layers";

export type VideoProgress = {
  frame: number;
  totalFrames: number;
  label?: string;
};

export type EncodePartOptions = {
  document: BlockoutDocument;
  /** Inclusive start / exclusive end frame. Defaults to whole part. */
  range?: { start: number; end: number };
  burnIn: boolean;
  mode: "clay" | "depth";
  longEdge?: number;
  signal: AbortSignal;
  onProgress: (p: VideoProgress) => void;
};

const CODEC_CANDIDATES = [
  "avc1.640028",
  "avc1.4d0028",
  "avc1.42e028",
  "avc1.42001f",
];

const depthMat = new THREE.ShaderMaterial({
  uniforms: { uNear: { value: 0.5 }, uFar: { value: 45 } },
  vertexShader:
    "varying float vZ;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vZ=-mv.z;gl_Position=projectionMatrix*mv;}",
  fragmentShader:
    "uniform float uNear;uniform float uFar;varying float vZ;void main(){float d=clamp((vZ-uNear)/(uFar-uNear),0.0,1.0);d=pow(d,0.6);gl_FragColor=vec4(vec3(1.0-d),1.0);}",
});

export function webCodecsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "VideoEncoder" in window &&
    "VideoFrame" in window
  );
}

async function pickCodec(
  width: number,
  height: number,
  fps: number,
): Promise<VideoEncoderConfig> {
  for (const codec of CODEC_CANDIDATES) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      framerate: fps,
      bitrate: 6_000_000,
      avc: { format: "avc" },
    };
    const support = await VideoEncoder.isConfigSupported(config);
    if (support.supported) return config;
  }
  throw new Error("This browser cannot encode H.264 video");
}

function frameSize(
  aspect: string,
  longEdge: number,
): { width: number; height: number } {
  const [bw, bh] = ASPECT_DIMS[aspect] ?? [1280, 720];
  const a = bw / bh;
  if (a >= 1) {
    const width = longEdge;
    const height = Math.round(longEdge / a / 2) * 2;
    return { width: Math.round(width / 2) * 2, height };
  }
  const height = longEdge;
  const width = Math.round((longEdge * a) / 2) * 2;
  return { width, height: Math.round(height / 2) * 2 };
}

function applyPose(
  cam: THREE.PerspectiveCamera,
  pose: ReturnType<typeof camAt>,
  aspect: number,
  sensor: number,
) {
  cam.position.set(...pose.pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(...pose.target);
  if (pose.roll) cam.rotateZ(THREE.MathUtils.degToRad(pose.roll));
  cam.filmGauge = sensor;
  cam.aspect = aspect;
  cam.setFocalLength(pose.focal);
}

function drawBurnIn(
  g: CanvasRenderingContext2D,
  doc: BlockoutDocument,
  w: number,
  h: number,
  frame: number,
  focal: number,
) {
  const s = w / 900;
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
    doc.shots.find((s) => frame >= s.start && frame < s.end) ??
    doc.shots[doc.shots.length - 1];
  const title = cut
    ? `Shot ${cut.n}${cut.shotType ? ` · ${cut.shotType}` : ""}`
    : doc.name;
  txt(title, pad + 6 * s, pad + 3 * s, "left");
  txt(
    `${Math.round(focal)}mm  ${doc.camera.sensor}mm`,
    w - pad - 6 * s,
    pad + 3 * s,
    "right",
  );
  txt(
    timecodeString(frame, doc.fps),
    pad + 6 * s,
    h - pad - fs - 3 * s,
    "left",
  );
  txt(
    `F ${String(frame).padStart(3, "0")} / ${doc.frames}  ${doc.fps}fps`,
    w - pad - 6 * s,
    h - pad - fs - 3 * s,
    "right",
  );
}

/**
 * Encode a part document to MP4 via WebCodecs + mp4-muxer.
 * Matches reference HTML: keyframe every 2s, clay/depth, optional burn-in.
 */
export async function encodePartToMp4(input: EncodePartOptions): Promise<Blob> {
  const doc = input.document;
  const fps = doc.fps;
  const start = input.range?.start ?? 0;
  const end = input.range?.end ?? doc.frames;
  const F = Math.max(1, end - start);
  const { width, height } = frameSize(doc.aspect, input.longEdge ?? 1280);
  const config = await pickCodec(width, height, fps);

  const glc = document.createElement("canvas");
  glc.width = width;
  glc.height = height;
  const renderer = new THREE.WebGLRenderer({
    canvas: glc,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const sky = new THREE.Color(doc.env?.sky ?? "#1c222a");
  scene.background = sky;
  if (doc.env?.fog !== false) {
    scene.fog = new THREE.Fog(
      sky,
      doc.env?.fogNear ?? 60,
      doc.env?.fogFar ?? 160,
    );
  }
  scene.add(new THREE.HemisphereLight(0xc9d6e6, 0x2a241d, 0.75));
  const sun = new THREE.DirectionalLight(0xfff1dd, 0.85);
  sun.castShadow = true;
  scene.add(sun);
  scene.add(sun.target);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: doc.env?.groundColor ?? 0x2c323b }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  if (doc.env?.ground !== false) scene.add(ground);

  const groups = new Map<string, THREE.Group>();
  for (const o of doc.objects) {
    const g = buildObjectMesh(o);
    groups.set(o.id, g);
    scene.add(g);
  }

  const cam = new THREE.PerspectiveCamera(40, width / height, 0.05, 500);
  const comp = document.createElement("canvas");
  comp.width = width;
  comp.height = height;
  const cg = comp.getContext("2d")!;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width, height, frameRate: fps },
    fastStart: "in-memory",
  });
  let encErr: unknown = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encErr = e;
    },
  });
  enc.configure(config);

  const sunOff = new THREE.Vector3(-12, 24, 14);
  const aspect = width / height;

  try {
    for (let i = 0; i < F; i++) {
      if (input.signal.aborted)
        throw new DOMException("Export cancelled", "AbortError");
      if (encErr) throw encErr;
      const f = start + i;
      const pose = camAt(doc.camera.keys, f);
      for (const o of doc.objects) {
        const g = groups.get(o.id);
        if (!g) continue;
        const s = objAt(o, f);
        g.position.set(s.x, s.y, s.z);
        g.rotation.y = (s.rot * Math.PI) / 180;
      }
      applyPose(cam, pose, aspect, doc.camera.sensor);
      const at = new THREE.Vector3(...pose.target);
      sun.position.copy(at).add(sunOff);
      sun.target.position.copy(at);
      sun.target.updateMatrixWorld();

      cam.layers.set(LAYER_CONTENT);
      if (input.mode === "clay") {
        cam.layers.enable(LAYER_LABELS);
        cam.layers.enable(LAYER_GRID);
      }

      const prevBg: THREE.Scene["background"] = scene.background;
      const prevFog: THREE.Scene["fog"] = scene.fog;
      if (input.mode === "depth") {
        scene.overrideMaterial = depthMat;
        scene.background = new THREE.Color(0);
        scene.fog = null;
      }
      renderer.render(scene, cam);
      scene.overrideMaterial = null;
      scene.background = prevBg;
      scene.fog = prevFog;

      cg.drawImage(glc, 0, 0);
      if (input.burnIn) drawBurnIn(cg, doc, width, height, f, pose.focal);

      const vf = new VideoFrame(comp, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      });
      enc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      while (enc.encodeQueueSize > 6) {
        await new Promise((r) => setTimeout(r, 4));
      }
      if (i % 3 === 0) {
        input.onProgress({ frame: i + 1, totalFrames: F });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await enc.flush();
    if (encErr) throw encErr;
    muxer.finalize();
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    try {
      enc.close();
    } catch {
      /* ignore */
    }
    renderer.dispose();
    renderer.forceContextLoss?.();
  }
}

/** @deprecated Prefer encodePartToMp4 */
export async function encodeClipsToMp4(): Promise<Blob> {
  throw new Error("encodeClipsToMp4 removed — use encodePartToMp4");
}

export function framesForDuration(durationSec: number, fps: number): number {
  return Math.max(1, Math.round(durationSec * fps));
}
