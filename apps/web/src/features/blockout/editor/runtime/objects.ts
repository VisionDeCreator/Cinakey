import * as THREE from "three";
import type { BlockoutObject, BlockoutLightRole } from "@cinakey/shared";
import { LAYER_CONTENT, LAYER_LABELS } from "./layers";

const matCache = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: string | number): THREE.MeshLambertMaterial {
  const key = String(color);
  let m = matCache.get(key);
  if (!m) {
    // Invalid CSS colour strings (e.g. legacy "C1") become white in three.js;
    // prefer a clay stand-in grey so unknown codes stay readable.
    const resolved =
      typeof color === "string" && !/^#|^0x|^rgb|^hsl|^[a-z]/i.test(color)
        ? 0x9aa0a8
        : color;
    m = new THREE.MeshLambertMaterial({ color: resolved });
    matCache.set(key, m);
  }
  return m;
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function labelSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.font = '600 30px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
  const w = Math.min(248, g.measureText(text).width + 24);
  g.fillStyle = "rgba(12,15,19,.82)";
  roundRect(g, (256 - w) / 2, 10, w, 44, 6);
  g.fill();
  g.fillStyle = color;
  g.fillRect((256 - w) / 2, 10, 4, 44);
  g.fillStyle = "#e8ecf2";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text.slice(0, 18), 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      depthWrite: false,
      transparent: true,
    }),
  );
  s.scale.set(1.4, 0.35, 1);
  s.layers.set(LAYER_LABELS);
  s.userData.label = true;
  return s;
}

function setContentLayers(root: THREE.Object3D) {
  root.traverse((c) => {
    if (!c.userData.label) c.layers.set(LAYER_CONTENT);
  });
}

/** Build a three.js stand-in group for a blockout object. */
export function buildObjectMesh(o: BlockoutObject): THREE.Group {
  const g = new THREE.Group();
  g.userData.objId = o.id;
  g.userData.pick = "object";
  const [w, h, d] = o.size;
  let labelY = h + 0.35;

  const add = (
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    y: number,
  ): THREE.Mesh => {
    const me = new THREE.Mesh(geo, material);
    me.position.y = y;
    me.castShadow = true;
    me.receiveShadow = true;
    g.add(me);
    return me;
  };

  if (o.type === "character" || o.type === "creature") {
    const r = Math.max(0.12, w / 2);
    add(
      new THREE.CapsuleGeometry(r, Math.max(0.1, h - 2 * r), 6, 16),
      mat(o.color),
      h / 2,
    );
    const nose = add(
      new THREE.BoxGeometry(r * 0.7, r * 0.45, r * 0.9),
      mat(0x20242b),
      h - r * 0.9,
    );
    nose.position.z = r * 0.75;
  } else if (o.type === "box" || o.type === "wall" || o.type === "door") {
    add(new THREE.BoxGeometry(w, h, d), mat(o.color), h / 2);
  } else if (o.type === "chair") {
    add(new THREE.BoxGeometry(w, h * 0.08, d), mat(o.color), h * 0.45);
    add(new THREE.BoxGeometry(w, h * 0.45, d * 0.08), mat(o.color), h * 0.72);
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        const leg = add(
          new THREE.BoxGeometry(0.05, h * 0.45, 0.05),
          mat(o.color),
          h * 0.225,
        );
        leg.position.set(sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06));
      }
    }
  } else if (o.type === "table") {
    add(new THREE.BoxGeometry(w, 0.06, d), mat(o.color), h);
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        const leg = add(
          new THREE.BoxGeometry(0.06, h, 0.06),
          mat(o.color),
          h / 2,
        );
        leg.position.set(sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08));
      }
    }
  } else if (o.type === "column") {
    add(new THREE.CylinderGeometry(w / 2, w / 2, h, 24), mat(o.color), h / 2);
  } else if (o.type === "car") {
    add(new THREE.BoxGeometry(w, h * 0.5, d), mat(o.color), h * 0.25 + 0.18);
    const cab = add(
      new THREE.BoxGeometry(w * 0.9, h * 0.42, d * 0.5),
      mat(o.color),
      h * 0.5 + 0.18 + h * 0.21,
    );
    cab.position.z = -d * 0.06;
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        const wh = add(
          new THREE.CylinderGeometry(0.33, 0.33, 0.24, 16),
          mat(0x15181d),
          0.33,
        );
        wh.rotation.z = Math.PI / 2;
        wh.position.set(sx * (w / 2 - 0.1), 0, sz * (d / 2 - 0.8));
      }
    }
  } else if (o.type === "mark") {
    const m = new THREE.MeshBasicMaterial({ color: o.color });
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, 0.07), m);
      t.rotation.y = a;
      t.position.y = 0.006;
      g.add(t);
    }
    labelY = 0.5;
  } else if (o.type === "hare") {
    const M = mat(o.color);
    const legH = h * 0.36;
    const bodyY = legH + 0.22;
    const bodyL = d * 0.62;
    const body = add(
      new THREE.CapsuleGeometry(w * 0.36, bodyL, 6, 12),
      M,
      bodyY,
    );
    body.rotation.x = Math.PI / 2;
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        const lg = add(
          new THREE.CapsuleGeometry(0.06, legH, 4, 8),
          M,
          legH / 2 + 0.03,
        );
        lg.position.set(sx * w * 0.22, 0, sz * bodyL * 0.42);
      }
    }
    const neck = add(
      new THREE.CapsuleGeometry(0.1, h * 0.26, 4, 8),
      M,
      bodyY + h * 0.2,
    );
    neck.position.z = bodyL * 0.55;
    neck.rotation.x = 0.25;
    const head = add(
      new THREE.SphereGeometry(0.16, 12, 10),
      M,
      bodyY + h * 0.36,
    );
    head.position.z = bodyL * 0.62 + 0.12;
    for (const sx of [-1, 1] as const) {
      const ear = add(
        new THREE.CapsuleGeometry(0.04, h * 0.17, 3, 6),
        M,
        bodyY + h * 0.5,
      );
      ear.position.set(sx * 0.07, 0, bodyL * 0.62 + 0.06);
      ear.rotation.x = -0.18;
    }
    labelY = h + 0.3;
  } else if (o.type === "raptor") {
    const M = mat(o.color);
    const S = mat(0xe2c23a);
    const legH = h * 0.42;
    const bodyY = legH + 0.3;
    const body = add(
      new THREE.CapsuleGeometry(w * 0.4, d * 0.3, 6, 12),
      M,
      bodyY,
    );
    body.rotation.x = Math.PI / 2 - 0.25;
    for (const sx of [-1, 1] as const) {
      const lg = add(
        new THREE.CapsuleGeometry(0.09, legH, 4, 8),
        M,
        legH / 2 + 0.05,
      );
      lg.position.x = sx * w * 0.22;
    }
    const tail = add(
      new THREE.CylinderGeometry(0.03, w * 0.28, d * 0.52, 8),
      M,
      bodyY + 0.12,
    );
    tail.rotation.x = -Math.PI / 2 + 0.08;
    tail.position.z = -d * 0.38;
    const neck = add(
      new THREE.CapsuleGeometry(0.1, 0.45, 4, 8),
      M,
      bodyY + 0.42,
    );
    neck.position.z = d * 0.2;
    neck.rotation.x = 0.6;
    const head = add(new THREE.BoxGeometry(0.22, 0.2, 0.46), M, bodyY + 0.66);
    head.position.z = d * 0.3;
    for (const zz of [-0.1, 0.12]) {
      const st = add(
        new THREE.CylinderGeometry(w * 0.42, w * 0.42, 0.09, 14),
        S,
        bodyY,
      );
      st.rotation.x = Math.PI / 2;
      st.position.z = zz;
    }
    labelY = h + 0.3;
  } else if (o.type === "tree") {
    add(
      new THREE.CylinderGeometry(w / 2, (w / 2) * 1.15, h, 10),
      mat(o.color),
      h / 2,
    );
    add(
      new THREE.CylinderGeometry(d / 2, d / 2, 0.45, 18),
      mat(o.color2 || "#2e4632"),
      h,
    );
    labelY = h + 0.6;
  } else if (o.type === "sphere") {
    const m = o.glow
      ? new THREE.MeshBasicMaterial({ color: o.color })
      : mat(o.color);
    const s = add(new THREE.SphereGeometry(w / 2, 24, 16), m, w / 2);
    if (o.glow || w > 4) s.castShadow = false;
    labelY = w + 0.3;
  } else if (o.type === "fire") {
    add(
      new THREE.ConeGeometry(w / 2, h, 14),
      new THREE.MeshBasicMaterial({ color: o.color }),
      h / 2,
    );
    const stone = mat(0x6d7179);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const st = add(new THREE.SphereGeometry(0.1, 8, 6), stone, 0.07);
      st.position.set(Math.cos(a) * w * 0.9, 0, Math.sin(a) * w * 0.9);
    }
    const log = add(new THREE.BoxGeometry(0.9, 0.2, 0.22), mat(0x6d7179), 0.1);
    log.position.set(w * 1.8, 0, 0.2);
    log.rotation.y = 0.4;
    labelY = h + 0.4;
  } else if (o.type === "strip") {
    const s = new THREE.Mesh(
      new THREE.BoxGeometry(w, Math.max(0.005, h), d),
      mat(o.color),
    );
    s.position.y = 0.01;
    s.receiveShadow = true;
    g.add(s);
    labelY = 0.5;
  } else if (o.type === "light") {
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 16, 12),
      new THREE.MeshBasicMaterial({
        color: o.color,
        transparent: true,
        opacity: 0.85,
      }),
    );
    glow.position.y = Math.max(0.4, h);
    glow.castShadow = false;
    g.add(glow);
    const pole = add(
      new THREE.CylinderGeometry(0.03, 0.03, glow.position.y, 8),
      mat("#5b6270"),
      glow.position.y / 2,
    );
    pole.castShadow = false;
    labelY = glow.position.y + 0.45;
  } else {
    add(new THREE.BoxGeometry(w, h, d), mat(o.color), h / 2);
  }

  if (o.label !== false) {
    const s = labelSprite(o.name, o.color);
    s.position.y = labelY;
    g.add(s);
  }
  setContentLayers(g);
  return g;
}

export const LIGHT_DEFAULTS: Record<
  BlockoutLightRole,
  {
    name: string;
    color: string;
    size: [number, number, number];
    intensity: number;
  }
> = {
  key: {
    name: "Key light",
    color: "#fff1dd",
    size: [0.4, 2.4, 0.4],
    intensity: 1.2,
  },
  fill: {
    name: "Fill light",
    color: "#c9d6e6",
    size: [0.4, 2.0, 0.4],
    intensity: 0.6,
  },
  back: {
    name: "Back light",
    color: "#ffe8c8",
    size: [0.4, 2.2, 0.4],
    intensity: 0.8,
  },
  sun: { name: "Sun", color: "#ffd9a0", size: [0.5, 3.0, 0.5], intensity: 1.5 },
};
