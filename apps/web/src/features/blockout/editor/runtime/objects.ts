import * as THREE from "three";
import type {
  BlockoutNode,
  BlockoutPropType,
  BlockoutTransform,
  MannequinPose,
} from "@cinakey/shared";

/** Layer for editor-only helpers (labels, light/camera bodies, grid). */
export const HELPER_LAYER = 1;

export const SENSOR_WIDTH_MM = 36;

// Shared geometry/materials keep 10 mannequins + 20 props cheap.
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const limb = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
const head = new THREE.SphereGeometry(0.5, 16, 12);
const wheel = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
const helperSphere = new THREE.SphereGeometry(0.15, 12, 8);
const groundPlane = new THREE.PlaneGeometry(1, 1);

const materials = new Map<string, THREE.MeshStandardMaterial>();
function material(color: string): THREE.MeshStandardMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
    materials.set(color, m);
  }
  return m;
}
const helperMaterial = new THREE.MeshBasicMaterial({ color: "#facc15" });
const cameraBodyMaterial = new THREE.MeshBasicMaterial({ color: "#38bdf8" });

export const MANNEQUIN_COLORS = [
  "#e07a5f",
  "#81b29a",
  "#f2cc8f",
  "#6d9dc5",
  "#c77dff",
  "#ef476f",
  "#06d6a0",
  "#ffd166",
  "#118ab2",
  "#b5838d",
];

export const DEFAULT_COLORS: Record<string, string> = {
  ground: "#3f3f46",
  set: "#71717a",
  prop: "#a1a1aa",
};

function mesh(
  geometry: THREE.BufferGeometry,
  color: string,
  size: [number, number, number],
  position: [number, number, number],
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material(color));
  m.scale.set(...size);
  m.position.set(...position);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function markHelper(obj: THREE.Object3D): THREE.Object3D {
  obj.traverse((o) => o.layers.set(HELPER_LAYER));
  obj.userData.helper = true;
  return obj;
}

function labelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(9,9,11,0.75)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#fafafa";
  ctx.font = "600 30px 'IBM Plex Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 16), 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  sprite.scale.set(0.8, 0.2, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// ---------------------------------------------------------------------------
// Mannequin
// ---------------------------------------------------------------------------

type Joints = {
  hips: THREE.Group;
  leftHip: THREE.Group;
  rightHip: THREE.Group;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  leftShoulder: THREE.Group;
  rightShoulder: THREE.Group;
  leftElbow: THREE.Group;
  rightElbow: THREE.Group;
};

function limbSegment(color: string, length: number, radius: number): THREE.Mesh {
  // Capsule total height = radius*2 + body; hangs down from the pivot.
  const m = mesh(limb, color, [radius * 2, length / 2, radius * 2], [0, -length / 2, 0]);
  return m;
}

function buildMannequin(color: string): { root: THREE.Group; joints: Joints } {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  root.add(hips);

  hips.add(mesh(unitBox, color, [0.34, 0.14, 0.2], [0, 0, 0]));
  const torso = mesh(unitBox, color, [0.4, 0.5, 0.22], [0, 0.32, 0]);
  hips.add(torso);
  hips.add(mesh(limb, color, [0.1, 0.06, 0.1], [0, 0.62, 0]));
  hips.add(mesh(head, color, [0.22, 0.26, 0.24], [0, 0.8, 0]));
  // Nose marks the facing direction (+Z).
  hips.add(mesh(unitBox, color, [0.05, 0.05, 0.06], [0, 0.8, 0.13]));

  const joint = (parent: THREE.Object3D, x: number, y: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    parent.add(g);
    return g;
  };
  const leftHip = joint(hips, 0.1, -0.05);
  const rightHip = joint(hips, -0.1, -0.05);
  leftHip.add(limbSegment(color, 0.45, 0.07));
  rightHip.add(limbSegment(color, 0.45, 0.07));
  const leftKnee = joint(leftHip, 0, -0.45);
  const rightKnee = joint(rightHip, 0, -0.45);
  leftKnee.add(limbSegment(color, 0.43, 0.06));
  rightKnee.add(limbSegment(color, 0.43, 0.06));

  const leftShoulder = joint(hips, 0.26, 0.54);
  const rightShoulder = joint(hips, -0.26, 0.54);
  leftShoulder.add(limbSegment(color, 0.3, 0.05));
  rightShoulder.add(limbSegment(color, 0.3, 0.05));
  const leftElbow = joint(leftShoulder, 0, -0.3);
  const rightElbow = joint(rightShoulder, 0, -0.3);
  leftElbow.add(limbSegment(color, 0.28, 0.045));
  rightElbow.add(limbSegment(color, 0.28, 0.045));

  return {
    root,
    joints: {
      hips,
      leftHip,
      rightHip,
      leftKnee,
      rightKnee,
      leftShoulder,
      rightShoulder,
      leftElbow,
      rightElbow,
    },
  };
}

function applyPose(j: Joints, pose: MannequinPose) {
  for (const g of Object.values(j)) g.rotation.set(0, 0, 0);
  j.hips.position.y = 0.95;
  j.leftShoulder.rotation.z = 0.08;
  j.rightShoulder.rotation.z = -0.08;
  if (pose === "walking") {
    j.leftHip.rotation.x = -0.45;
    j.rightHip.rotation.x = 0.35;
    j.rightKnee.rotation.x = 0.5;
    j.leftShoulder.rotation.x = 0.4;
    j.rightShoulder.rotation.x = -0.4;
    j.leftElbow.rotation.x = -0.3;
    j.rightElbow.rotation.x = -0.5;
  } else if (pose === "sitting") {
    j.hips.position.y = 0.5;
    j.leftHip.rotation.x = -Math.PI / 2;
    j.rightHip.rotation.x = -Math.PI / 2;
    j.leftKnee.rotation.x = Math.PI / 2;
    j.rightKnee.rotation.x = Math.PI / 2;
    j.leftShoulder.rotation.x = -0.5;
    j.rightShoulder.rotation.x = -0.5;
    j.leftElbow.rotation.x = -0.6;
    j.rightElbow.rotation.x = -0.6;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

function buildProp(type: BlockoutPropType, color: string): THREE.Group {
  const g = new THREE.Group();
  const add = (
    geo: THREE.BufferGeometry,
    size: [number, number, number],
    pos: [number, number, number],
    c = color,
  ) => {
    const m = mesh(geo, c, size, pos);
    g.add(m);
    return m;
  };
  switch (type) {
    case "box":
      add(unitBox, [1, 1, 1], [0, 0.5, 0]);
      break;
    case "chair":
      add(unitBox, [0.46, 0.05, 0.46], [0, 0.45, 0]);
      add(unitBox, [0.46, 0.5, 0.05], [0, 0.72, -0.2]);
      for (const [x, z] of [
        [0.2, 0.2],
        [-0.2, 0.2],
        [0.2, -0.2],
        [-0.2, -0.2],
      ] as const)
        add(unitBox, [0.04, 0.45, 0.04], [x, 0.225, z]);
      break;
    case "table":
      add(unitBox, [1.4, 0.05, 0.8], [0, 0.75, 0]);
      for (const [x, z] of [
        [0.64, 0.34],
        [-0.64, 0.34],
        [0.64, -0.34],
        [-0.64, -0.34],
      ] as const)
        add(unitBox, [0.06, 0.73, 0.06], [x, 0.365, z]);
      break;
    case "door":
      add(unitBox, [0.08, 2.2, 0.12], [-0.49, 1.1, 0], "#52525b");
      add(unitBox, [0.08, 2.2, 0.12], [0.49, 1.1, 0], "#52525b");
      add(unitBox, [1.06, 0.08, 0.12], [0, 2.24, 0], "#52525b");
      add(unitBox, [0.9, 2.1, 0.05], [0, 1.05, 0]);
      add(unitBox, [0.06, 0.06, 0.08], [0.35, 1.0, 0.05], "#27272a");
      break;
    case "car": {
      add(unitBox, [1.8, 0.7, 4.2], [0, 0.6, 0]);
      add(unitBox, [1.6, 0.55, 2.1], [0, 1.22, -0.2], "#27272a");
      for (const [x, z] of [
        [0.85, 1.3],
        [-0.85, 1.3],
        [0.85, -1.3],
        [-0.85, -1.3],
      ] as const) {
        const w = add(wheel, [0.66, 0.25, 0.66], [x, 0.33, z], "#18181b");
        w.rotation.z = Math.PI / 2;
      }
      break;
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/** Fields whose change needs a rebuild (transform-only edits do not). */
export function structureKey(node: BlockoutNode): string {
  return [
    node.kind,
    node.propType,
    node.lightRole,
    node.pose,
    node.color,
    node.intensity,
    node.name,
  ].join("|");
}

export function lensToCamera(camera: THREE.PerspectiveCamera, lensMm: number) {
  camera.filmGauge = SENSOR_WIDTH_MM;
  camera.setFocalLength(lensMm);
  camera.updateProjectionMatrix();
}

export function applyTransform(obj: THREE.Object3D, t: BlockoutTransform) {
  obj.position.set(...t.position);
  obj.rotation.set(...t.rotation);
  obj.scale.set(...t.scale);
}

export type BuiltNode = {
  object: THREE.Object3D;
  /** Directional light targets must be added to the scene separately. */
  extra?: THREE.Object3D;
};

export function buildNodeObject(
  node: BlockoutNode,
  opts: { helpers: boolean; mannequinIndex?: number },
): BuiltNode {
  let object: THREE.Object3D;
  let extra: THREE.Object3D | undefined;
  switch (node.kind) {
    case "ground": {
      const m = new THREE.Mesh(groundPlane, material(node.color ?? DEFAULT_COLORS.ground!));
      m.rotation.x = -Math.PI / 2;
      m.scale.set(40, 40, 1);
      m.receiveShadow = true;
      const g = new THREE.Group();
      g.add(m);
      if (opts.helpers) {
        const grid = new THREE.GridHelper(40, 40, "#52525b", "#3f3f46");
        grid.position.y = 0.002;
        g.add(markHelper(grid));
      }
      object = g;
      break;
    }
    case "set": {
      const g = new THREE.Group();
      g.add(mesh(unitBox, node.color ?? DEFAULT_COLORS.set!, [1, 1, 1], [0, 0.5, 0]));
      object = g;
      break;
    }
    case "mannequin": {
      const color =
        node.color ??
        MANNEQUIN_COLORS[(opts.mannequinIndex ?? 0) % MANNEQUIN_COLORS.length]!;
      const { root, joints } = buildMannequin(color);
      applyPose(joints, node.pose ?? "standing");
      if (opts.helpers) {
        const label = labelSprite(node.name);
        label.position.y = 2.05;
        root.add(markHelper(label));
      }
      object = root;
      break;
    }
    case "prop":
      object = buildProp(node.propType ?? "box", node.color ?? DEFAULT_COLORS.prop!);
      break;
    case "light": {
      const role = node.lightRole ?? "key";
      const defaults = { key: 2.4, fill: 0.8, back: 1.4 } as const;
      const light = new THREE.DirectionalLight(
        node.color ?? "#ffffff",
        node.intensity ?? defaults[role],
      );
      if (role === "key") {
        light.castShadow = true;
        light.shadow.mapSize.set(1024, 1024);
        const cam = light.shadow.camera;
        cam.left = -10;
        cam.right = 10;
        cam.top = 10;
        cam.bottom = -10;
        cam.far = 60;
        light.shadow.bias = -0.0005;
      }
      extra = light.target;
      if (opts.helpers) {
        const s = new THREE.Mesh(helperSphere, helperMaterial);
        light.add(markHelper(s));
      }
      object = light;
      break;
    }
    case "camera": {
      const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 200);
      cam.layers.set(0);
      if (opts.helpers) {
        const body = new THREE.Group();
        const box = new THREE.Mesh(unitBox, cameraBodyMaterial);
        box.scale.set(0.2, 0.15, 0.3);
        box.position.z = 0.15;
        body.add(box);
        const lens = new THREE.Mesh(wheel, cameraBodyMaterial);
        lens.scale.set(0.12, 0.1, 0.12);
        lens.rotation.x = Math.PI / 2;
        lens.position.z = -0.05;
        body.add(lens);
        cam.add(markHelper(body));
      }
      object = cam;
      break;
    }
  }
  object.userData.nodeId = node.id;
  object.traverse((o) => {
    o.userData.nodeId = node.id;
  });
  applyTransform(object, node.transform);
  return { object, extra };
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof THREE.Sprite) {
      o.material.map?.dispose();
      o.material.dispose();
    }
    if (o instanceof THREE.DirectionalLight) o.shadow.map?.dispose();
    if (o instanceof THREE.GridHelper) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}
