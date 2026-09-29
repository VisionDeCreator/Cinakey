/** Savanna hunt: script (trimmed descriptions) and the staging plan a model would write. */
export const HUNT_SCRIPT = `REFERENCES
@[Image 1](image_1) = the boy. Use it for his face and gear.
@[Image 2](image_2) = the giant cheetah. Use it for its body, saddle and harness.
@[Image 3](image_3) = the savanna. Use it for the grassland, acacia trees, rocky outcrop and red-cliffed river.
@[Image 4](image_4) = the rifle. Use it for the carved stock and brass scope.
@[Image 5](image_5) = the hybrid antelope. Use it for every antelope in the herd.
@[Image 7](image_7) = the crowned savanna bird. Use it for the bird the boy carries in the final shot.
ART STYLE — LOCKED TO THE REFERENCE IMAGES:
Soft painted anime.
IMAGE QUALITY — ALWAYS SHARP AND CLEAN:
Sharp.
THE BOY — @[Image 1](image_1), identical in every shot:
A lean teenage boy with goggles and a scarf.
THE CHEETAH — @[Image 2](image_2): a horse-sized cheetah with a leather saddle, harness and short reins.
THE RIFLE — @[Image 4](image_4): a long hunting rifle with a brass scope.
THE ANTELOPE — @[Image 5](image_5), every one in the herd: slender antelope with lyre-shaped horns.
THE BIRD — @[Image 7](image_7) (final shot only): a plump, round crowned bird, shown limp.
LOCATION — @[Image 3](image_3): golden savanna at sunset, tall grass swaying, acacia trees, a rocky outcrop, and a river running between red earth cliffs, low sun and a violet-and-apricot sky.
SHOTS (30 seconds total, multi-shot, 16:9):
Shot 1 (0.0s–1.5s) — Close-up: a single @[Image 5](image_5) antelope grazing, its blue-and-red mandrill face chewing a mouthful of golden grass, ears flicking, amber eyes calm, the rest of the herd grazing softly out of focus behind it.
Shot 2 (1.5s–2.5s) — Extreme close-up, low in the grass: blades part slightly, revealing @[Image 1](image_1)'s eyes watching, perfectly still, amber goggles on his forehead.
Shot 3 (2.5s–3.5s) — Low side shot through the grass: the @[Image 2](image_2) cheetah lies flattened beside him, amber eyes locked on the herd, only the tip of its tail twitching.
Shot 4 (3.5s–5.0s) — Low shot from behind him: lying flat on his stomach in the grass, he slowly slides the @[Image 4](image_4) rifle forward through the blades, presses his cheek to the carved stock and settles his eye behind the scope.
Shot 5 (5.0s–6.0s) — Point of view through the scope: an amber-tinted circle framing the grazing antelope, the crosshair slowly settling on it.
Shot 6 (6.0s–7.0s) — Medium shot on the herd: the antelope suddenly lifts its head and sniffs the air, sensing something.
Shot 7 (7.0s–8.0s) — Low wide shot through the grass: he fires; an amber muzzle flash, and a flock of birds bursts out of the nearest acacia.
Shot 8 (8.0s–9.0s) — Close-up at the antelope's hooves: at that very instant it jerks sideways, and the shot kicks up a spray of red dust just beside its leg. A clean miss.
Shot 9 (9.0s–10.0s) — Close-up on the boy's face: his eyes widen, then narrow, jaw clenched in frustration.
Shot 10 (10.0s–11.5s) — Low shot at ground level: the herd explodes into motion, hooves pounding past the camera, dust and grass flying.
Shot 11 (11.5s–12.5s) — Medium shot: he swings the rifle onto his back and leaps into the saddle as the cheetah rises and launches forward in one explosive movement, grass spraying behind them.
Shot 12 (12.5s–14.0s) — Low tracking shot alongside at full speed: the cheetah stretched out in a full sprint, the boy crouched low in the saddle, scarf streaming, grass whipping past.
Shot 13 (14.0s–15.0s) — Front shot on the boy: he snaps his amber goggles down over his eyes, locked on.
Shot 14 (15.0s–16.5s) — High rear drone shot: they charge into the fleeing herd, which scatters in all directions, until only the one antelope from the start is left running ahead of them, zigzagging through the grass.
Shot 15 (16.5s–17.5s) — Close tracking shot on the target antelope: running flat out, it glances back, eyes wide, mane flying.
Shot 16 (17.5s–18.5s) — Low shot at the river's edge: the antelope leaps the river first.
Shot 17 (18.5s–20.0s) — Rear shot from behind the cheetah: it sprints along the red cliff edge and leaps out over the river, the boy crouched against its back, the sunset ahead of them; it lands hard on the far bank, claws digging into the red earth, and keeps running without breaking stride.
Shot 18 (20.0s–21.5s) — Low tracking shot: the chase continues; the antelope is tiring, its stride shortening as it runs across the open plain.
Shot 19 (21.5s–22.5s) — Side tracking shot: with the cheetah still at full sprint, the boy sits up tall in the saddle, gripping with his legs, swings the rifle off his back and raises it to his shoulder, perfectly balanced.
Shot 20 (22.5s–23.5s) — Point of view through the scope: an amber-tinted circle, bouncing with the cheetah's stride, the fleeing antelope ahead; the scope gradually steadies onto it.
Shot 21 (23.5s–26.5s) — Side tracking shot, slow push-in toward his face as they keep running: his cheek against the stock, one eye at the scope, the wind tearing at his scarf and the grass streaking past behind him. He takes a long, deep breath in, his chest rising, then slowly lets it out; his eye narrows and, for a moment, he is completely still while the world rushes around him.
Shot 22 (26.5s–27.5s) — Hard cut to black as the gunshot rings out and echoes across the plain.
Shot 23 (27.5s–30.0s) — Low angle from behind: the cheetah walks slowly into frame and away from the camera toward the huge, low setting sun far ahead, its tail swaying. The boy sits relaxed in the saddle, the rifle slung across his back, his scarf lifting gently in the breeze. In his lowered hand he holds the @[Image 7](image_7) bird upside down by its feet, its wings drooping open and its golden crown and wingtips dragging through the dust and grass beside the cheetah. They grow smaller as they head into the golden light. Fade out.
CONSISTENCY:
Style never changes.
MOTION AND PHYSICS:
Real cheetah gait.
LIGHTING:
Warm golden sunset light.
TECHNICAL:
16:9, 24fps.
MUSIC:
Savanna score.
AUDIO (native sound, synced to picture, no dialogue):
0.0s wind. 7.0s rifle crack. 26.5s gunshot.
`;

const a = (id: string, name: string, at: [number, number], facing: number) => ({
  id,
  name,
  kind: "quadruped",
  imageN: id === "a1" ? 5 : undefined,
  size: [0.6, 2.0, 1.8],
  at,
  facing,
});

export const HUNT_PLAN = {
  schema: "cinakey.staging/1.0",
  set: {
    terrain: "open",
    timeOfDay: "golden",
    features: [
      { kind: "trees", at: [60, 28], count: 8, spread: 40 },
      { kind: "trees", at: [150, -32], count: 8, spread: 40 },
      { kind: "rocks", at: [18, -14], count: 5, spread: 5 },
      { kind: "river", id: "river", at: [95, 0], size: [8, 2.5, 300] },
      { kind: "sun", at: [420, 0] },
    ],
  },
  cast: [
    {
      id: "boy",
      name: "boy",
      kind: "person",
      imageN: 1,
      at: [0, 1.4],
      facing: 90,
      rides: "cheetah",
      ridesFrom: 11.9,
    },
    {
      id: "cheetah",
      name: "cheetah",
      kind: "quadruped",
      imageN: 2,
      size: [0.9, 2.4, 2.6],
      at: [0, 0],
      facing: 90,
    },
    {
      id: "rifle",
      name: "rifle",
      kind: "prop",
      imageN: 4,
      size: [0.1, 0.1, 1.2],
      at: [0, 1.4],
      carriedBy: "boy",
    },
    a("a1", "antelope", [28, 0], 90),
    a("a2", "antelope 2", [31, -3], 60),
    a("a3", "antelope 3", [25, 3.5], 120),
    a("a4", "antelope 4", [33, 3], 100),
    a("a5", "antelope 5", [24, -3], 75),
    {
      id: "bird",
      name: "bird",
      kind: "bird",
      imageN: 7,
      at: [0, 0],
      carriedBy: "boy",
      visible: [[27.5, 30]],
    },
  ],
  shots: [
    {
      n: 1,
      moves: [{ who: "a1", action: "idle" }],
      camera: {
        size: "cu",
        angle: "eye",
        side: "front_left",
        move: "static",
        subject: "a1",
      },
    },
    {
      n: 2,
      moves: [{ who: "boy", action: "crouch" }],
      camera: {
        size: "ecu",
        angle: "low",
        side: "front",
        move: "static",
        subject: "boy",
      },
    },
    {
      n: 3,
      moves: [{ who: "cheetah", action: "lie" }],
      camera: {
        size: "medium",
        angle: "low",
        side: "left",
        move: "static",
        subject: "cheetah",
      },
    },
    {
      n: 4,
      moves: [{ who: "boy", action: "lie" }],
      camera: {
        size: "medium",
        angle: "low",
        side: "back",
        move: "static",
        subject: "boy",
      },
    },
    {
      n: 5,
      moves: [],
      camera: {
        size: "medium",
        angle: "eye",
        side: "front",
        move: "static",
        pov: "boy",
        subject: "a1",
        lensMm: 135,
      },
    },
    {
      n: 6,
      moves: [{ who: "a1", action: "look", face: 270 }],
      camera: {
        size: "medium",
        angle: "eye",
        side: "front_right",
        move: "static",
        subject: "a1",
      },
    },
    {
      n: 7,
      moves: [{ who: "boy", action: "fire" }],
      camera: {
        size: "wide",
        angle: "low",
        side: "front_left",
        move: "static",
        subject: "boy",
      },
    },
    {
      n: 8,
      moves: [
        { who: "a1", action: "jump", path: [[28, -0.8]], height: 0.4, to: 0.4 },
      ],
      camera: {
        size: "insert",
        angle: "ground",
        side: "left",
        move: "static",
        subject: "a1",
      },
    },
    {
      n: 9,
      moves: [],
      camera: {
        size: "cu",
        angle: "eye",
        side: "front",
        move: "static",
        subject: "boy",
      },
    },
    {
      n: 10,
      moves: [
        { who: "a1", action: "run", path: [[42, 0]] },
        { who: "a2", action: "run", path: [[45, -3]] },
        { who: "a3", action: "run", path: [[39, 3.5]] },
        { who: "a4", action: "run", path: [[47, 3]] },
        { who: "a5", action: "run", path: [[38, -3]] },
      ],
      camera: {
        size: "wide",
        angle: "ground",
        side: "front",
        move: "static",
        subject: "a1",
      },
    },
    {
      n: 11,
      moves: [
        { who: "boy", action: "stand", from: 0, to: 0.3 },
        { who: "cheetah", action: "run", from: 0.4, path: [[6, 0]] },
        { who: "a1", action: "run", path: [[52, 0]] },
        { who: "a2", action: "run", path: [[55, -3]] },
        { who: "a3", action: "run", path: [[49, 3.5]] },
        { who: "a4", action: "run", path: [[57, 3]] },
        { who: "a5", action: "run", path: [[48, -3]] },
      ],
      camera: {
        size: "medium",
        angle: "eye",
        side: "left",
        move: "static",
        subject: "cheetah",
      },
    },
    {
      n: 12,
      moves: [
        { who: "cheetah", action: "sprint", path: [[24, 0]] },
        { who: "a1", action: "run", path: [[66, 0]] },
        { who: "a2", action: "run", path: [[69, -3]] },
        { who: "a3", action: "run", path: [[63, 3.5]] },
        { who: "a4", action: "run", path: [[71, 3]] },
        { who: "a5", action: "run", path: [[62, -3]] },
      ],
      camera: {
        size: "full",
        angle: "low",
        side: "left",
        move: "track",
        subject: "cheetah",
      },
    },
    {
      n: 13,
      moves: [
        { who: "cheetah", action: "sprint", path: [[38, 0.5]] },
        { who: "a1", action: "run", path: [[76, 0]] },
        { who: "a2", action: "run", path: [[79, -3]] },
        { who: "a3", action: "run", path: [[73, 3.5]] },
        { who: "a4", action: "run", path: [[81, 3]] },
        { who: "a5", action: "run", path: [[72, -3]] },
      ],
      camera: {
        size: "mcu",
        angle: "eye",
        side: "front",
        move: "follow",
        subject: "boy",
      },
    },
    {
      n: 14,
      moves: [
        { who: "cheetah", action: "sprint", path: [[58, 0]] },
        {
          who: "a1",
          action: "run",
          path: [
            [82, 2],
            [88, -1],
          ],
        },
        { who: "a2", action: "run", path: [[86, -18]] },
        { who: "a3", action: "run", path: [[80, 20]] },
        { who: "a4", action: "run", path: [[88, 18]] },
        { who: "a5", action: "run", path: [[76, -20]] },
      ],
      camera: {
        size: "wide",
        angle: "overhead",
        side: "back",
        move: "follow",
        subject: "cheetah",
      },
    },
    {
      n: 15,
      moves: [
        { who: "cheetah", action: "sprint", path: [[72, 0]] },
        { who: "a1", action: "run", path: [[90, 1.5]] },
      ],
      camera: {
        size: "medium",
        angle: "low",
        side: "left",
        move: "track",
        subject: "a1",
      },
    },
    {
      n: 16,
      moves: [
        { who: "cheetah", action: "sprint", path: [[86, 0]] },
        { who: "a1", action: "leap", path: [[106, 0]], height: 2.2 },
      ],
      camera: {
        size: "wide",
        angle: "ground",
        side: "left",
        move: "static",
        subject: "a1",
      },
    },
    {
      n: 17,
      moves: [
        { who: "cheetah", action: "sprint", to: 0.3, path: [[93, 0]] },
        {
          who: "cheetah",
          action: "leap",
          from: 0.3,
          to: 0.7,
          path: [[106, 0]],
          height: 2.5,
        },
        { who: "cheetah", action: "sprint", from: 0.7, path: [[111, 0]] },
        { who: "a1", action: "run", path: [[120, 0]] },
      ],
      camera: {
        size: "full",
        angle: "eye",
        side: "back",
        move: "follow",
        subject: "cheetah",
      },
    },
    {
      n: 18,
      moves: [
        { who: "cheetah", action: "sprint", path: [[128, 0]] },
        { who: "a1", action: "run", path: [[134, -1]] },
      ],
      camera: {
        size: "medium",
        angle: "low",
        side: "left",
        move: "track",
        subject: "a1",
      },
    },
    {
      n: 19,
      moves: [
        { who: "cheetah", action: "sprint", path: [[140, 0]] },
        { who: "a1", action: "run", path: [[144, 1]] },
      ],
      camera: {
        size: "medium",
        angle: "eye",
        side: "left",
        move: "track",
        subject: "boy",
      },
    },
    {
      n: 20,
      moves: [
        { who: "cheetah", action: "sprint", path: [[152, 0]] },
        { who: "a1", action: "run", path: [[155, -1]] },
      ],
      camera: {
        size: "medium",
        angle: "eye",
        side: "front",
        move: "follow",
        pov: "boy",
        subject: "a1",
        lensMm: 135,
      },
    },
    {
      n: 21,
      moves: [
        { who: "cheetah", action: "sprint", path: [[188, 0]] },
        { who: "a1", action: "run", path: [[192, 1]] },
      ],
      camera: {
        size: "mcu",
        angle: "eye",
        side: "left",
        move: "push_in",
        subject: "boy",
      },
    },
    {
      n: 22,
      moves: [
        { who: "cheetah", action: "run", path: [[196, 0]] },
        { who: "a1", action: "run", path: [[204, 0]] },
      ],
      camera: {
        size: "wide",
        angle: "eye",
        side: "left",
        move: "static",
        black: true,
      },
    },
    {
      n: 23,
      moves: [
        { who: "cheetah", action: "walk", path: [[200, 0]] },
        { who: "a1", action: "run", to: 0.2, path: [[215, 0]] },
      ],
      camera: {
        size: "full",
        angle: "low",
        side: "back",
        move: "static",
        subject: "cheetah",
      },
    },
  ],
};
