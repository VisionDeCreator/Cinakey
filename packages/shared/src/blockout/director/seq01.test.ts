/**
 * Parity with gen_chase.py (SEQ01 forest chase). Golden values were sampled
 * from the Python generator's output; the TS director must reproduce them.
 */
import { describe, expect, it } from "vitest";
import { parseScriptPromptText } from "../../prompt-templates/parse";
import { camAt, objAt } from "../engine";
import { directPartDocumentFromScript } from "./index";

const SEQ01 = `REFERENCES
@image_1 = the girl. Use it for her face and outfit.
@image_2 = the giant hare. Use it for the mount.
@image_3 = the bandits and their raptors. Use it for the four pursuers.
@image_4 = the moonlit forest. Use it for the forest, campfire and cliff.

ART STYLE — LOCKED TO THE REFERENCE IMAGES:
Painted.

IMAGE QUALITY — ALWAYS SHARP AND CLEAN:
Sharp.

THE GIRL — @image_1, identical in every shot:
A young rider with a satchel and a pistol.

THE HARE — @image_2: a giant hare she rides.

THE BANDITS — @image_3: four bandits riding raptors, with rifles.

LOCATION — @image_4: a night forest with a campfire, a winding path, ending at a cliff edge over a chasm under a full moon.

SHOTS (30 seconds total, multi-shot, 16:9):
Shot 1 (0.0s–1.5s) — Close-up on the campfire cone, particles rising: Close-up on the campfire cone, particles rising
Shot 2 (1.5s–3.0s) — Over the fire: the grey hand enters frame right with the gold
Shot 3 (3.0s–4.0s) — She takes the gold and places it in the satchel: She takes the gold and places it in the satchel
Shot 4 (4.0s–5.5s) — Wide: mounts and rides away into the trees
Shot 5 (5.5s–7.0s) — Low tracking alongside: hare bounds at medium speed
Shot 6 (7.0s–8.0s) — Close-up on the hare's head: ears rotate back
Shot 7 (8.0s–9.0s) — Close-up: she looks back over her shoulder
Shot 8 (9.0s–10.0s) — Her POV into the trees behind: yellow lights
Shot 9 (10.0s–11.0s) — Low wide: four raptors burst out of the trees
Shot 10 (11.0s–12.0s) — Close-up: she leans in, hare goes to full sprint
Shot 11 (12.0s–13.5s) — Top-down: hare on the winding path, raptors gaining
Shot 12 (13.5s–14.5s) — Low tracking on the raptors: riders raise rifles
Shot 13 (14.5s–15.5s) — Side: red flashes, a streak hits a trunk by her head
Shot 14 (15.5s–16.5s) — Close-up: raptor levels on her left, she turns left
Shot 15 (16.5s–17.5s) — Close-up: raptor levels on her right, she turns right
Shot 16 (17.5s–18.5s) — Front: hare cuts between two trunks, raptors swerve
Shot 17 (18.5s–20.0s) — Medium: she twists in the saddle and fires back twice
Shot 18 (20.0s–21.0s) — Low: branch falls across the path, lead raptor stumbles
Shot 19 (21.0s–22.0s) — Close-up: she turns forward, bright light ahead
Shot 20 (22.0s–23.0s) — Wide: trees end at the cliff, the gap and the moon
Shot 21 (23.0s–24.0s) — Close-up on the hare's hind leg compressing: Close-up on the hare's hind leg compressing
Shot 22 (24.0s–26.0s) — Wide side, slow motion: the leap against the moon
Shot 23 (26.0s–27.0s) — Low on the far side: the hare lands
Shot 24 (27.0s–28.5s) — Wide looking back: raptors pace at the edge, hat thrown
Shot 25 (28.5s–30.0s) — Close-up: she looks back, then rides off. Cut to black

CONSISTENCY:
Same.

MOTION AND PHYSICS:
Real.

LIGHTING:
Moonlight.

TECHNICAL:
16:9, 24fps.

MUSIC:
Score.

AUDIO (native sound, synced to picture, no dialogue):
0.0s fire.
`;

const GOLDEN: {
  cam: Record<string, [number[], number[], number]>;
  obj: Record<string, Record<string, [number, number, number, number]>>;
} = {
  cam: {
    "30": [[-1.39, 0.55, 1.67], [-2.4, 0.38, 2.6], 50],
    "100": [[-8.5, 2.4, 5.6], [1.11, 1.25, 0.3], 24],
    "150": [[6.93, 0.55, 6.53], [8.93, 1.2, 0.03], 35],
    "245": [[26.57, 0.45, 6.13], [16.57, 1.3, -0.37], 24],
    "290": [[36.15, 48, 2.32], [36.15, 0, 1.72], 35],
    "340": [[65.81, 0.5, 6.47], [62.31, 1.9, -0.53], 35],
    "400": [[104.55, 2.7, -2.54], [99.75, 2.2, -0.24], 35],
    "430": [[123.19, 1.5, 1.63], [107.19, 1.3, 1.63], 28],
    "480": [[144.45, 0.4, 7.64], [139.45, 0.8, 2.14], 24],
    "540": [[163.45, 4.5, 3.03], [200.39, 2.5, -6], 24],
    "600": [[182.8, 3.83, 16.76], [197.39, 5.8, 0], 28],
    "650": [[214.39, 3.2, 7], [187.39, 1, 0], 35],
    "700": [[208.2, 1.75, 1.9], [210.8, 1.55, 0], 50],
  },
  obj: {
    hare: {
      "90": [0, 0, 0, 90],
      "250": [33.09, 0.21, 2.18, 89],
      "420": [110.39, 0.06, -0.02, 76],
      "600": [197.39, 5.6, 0, 90],
      "690": [210.9, -0.8, 0, 90],
    },
    girl: {
      "90": [-0.72, 0, 0.72, 162],
      "250": [32.99, 1.23, 2.18, 89],
      "420": [110.29, 1.06, -0.04, 54],
      "600": [197.29, 6.6, 0, 90],
      "690": [210.8, 0.2, 0, 211],
    },
    raptor1: {
      "90": [10.59, 0, -9, 90],
      "250": [15.21, 0.05, -4.55, 40],
      "420": [110.19, 0.09, -2.45, 85],
      "600": [186.69, 0.09, -1.44, 180],
      "690": [186.25, 0, -2.54, -115],
    },
    bandit2: {
      "90": [8.34, 1.3, 8.5, 90],
      "250": [13.03, 1.35, 4.93, 133],
      "420": [109.94, 1.39, 2.31, 80],
      "600": [186.65, 1.39, 1.14, 9],
      "690": [185.66, 1.3, 0.71, -19],
    },
    gold: {
      "90": [-0.62, 1.38, 0, 0],
      "250": [32.47, 1.63, 2.17, 0],
      "420": [109.79, 1.44, -0.16, 0],
      "600": [196.77, 6.98, 0, 0],
      "690": [210.28, 0.58, 0, 0],
    },
    hat: {
      "90": [8.34, 2.92, 8.5, 90],
      "250": [13.03, 2.97, 4.93, 133],
      "420": [109.94, 3.01, 2.31, 80],
      "600": [186.65, 3.01, 1.14, 9],
      "690": [188.1, 0, 1.7, 181],
    },
  },
};

const TS_ID: Record<string, string> = {
  hare: "cast-2",
  girl: "cast-1",
  raptor1: "cast-raptor-1",
  bandit2: "cast-bandit-2",
  gold: "fx-gold",
  hat: "fx-hat",
};

const angleDiff = (a: number, b: number) =>
  Math.abs(((((a - b) % 360) + 540) % 360) - 180);

describe("director parity with gen_chase.py (SEQ01)", () => {
  const doc = directPartDocumentFromScript(parseScriptPromptText(SEQ01), {
    id: "p",
    title: "SEQ01",
    aspectRatio: "16:9",
    fps: 24,
  });

  it("matches the camera on every shot", () => {
    expect(doc.shots).toHaveLength(25);
    expect(doc.camera.keys).toHaveLength(42);
    for (const [f, [pos, target, focal]] of Object.entries(GOLDEN.cam)) {
      const c = camAt(doc.camera.keys, Number(f));
      pos.forEach((v, i) => expect(c.pos[i]).toBeCloseTo(v, 1));
      target.forEach((v, i) => expect(c.target[i]).toBeCloseTo(v, 1));
      expect(c.focal).toBe(focal);
    }
  });

  it("matches cast and prop motion", () => {
    for (const [ref, frames] of Object.entries(GOLDEN.obj)) {
      const o = doc.objects.find((x) => x.id === TS_ID[ref]);
      expect(o, ref).toBeTruthy();
      for (const [f, [x, y, z, rot]] of Object.entries(frames)) {
        const p = objAt(o!, Number(f));
        expect(
          Math.hypot(p.x - x, p.y - y, p.z - z),
          `${ref}@${f}`,
        ).toBeLessThan(0.05);
        expect(angleDiff(p.rot, rot), `${ref} rot@${f}`).toBeLessThan(1.5);
      }
    }
  });

  it("dresses the set like gen_chase", () => {
    const count = (t: string) => doc.objects.filter((o) => o.type === t).length;
    expect(count("strip")).toBe(42);
    expect(count("tree")).toBeGreaterThan(150);
    expect(count("tree")).toBeLessThan(215);
    for (const id of [
      "fx-satchel",
      "fx-flash-red",
      "fx-flash-teal",
      "fx-streak",
      "fx-branch",
      "fx-hat",
    ]) {
      expect(
        doc.objects.some((o) => o.id === id),
        id,
      ).toBe(true);
    }
    // Flashes never pop at the campfire
    const red = doc.objects.find((o) => o.id === "fx-flash-red")!;
    expect(red.keys.filter((k) => k.y > -20).every((k) => k.x > 50)).toBe(true);
  });
});
