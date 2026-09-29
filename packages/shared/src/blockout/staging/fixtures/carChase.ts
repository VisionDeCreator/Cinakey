/** Night car chase through city streets, ending in a crash. */
export const CAR_CHASE_SCRIPT = `REFERENCES
@image_1 = the red coupe. Use it for the car.
@image_2 = the police cruiser. Use it for the pursuer.
@image_3 = the city at night. Use it for the streets.
ART STYLE — LOCKED TO THE REFERENCE IMAGES:
Neon noir.
IMAGE QUALITY — ALWAYS SHARP AND CLEAN:
Sharp.
THE COUPE — @image_1: a red sports coupe driven by a woman in a leather jacket.
THE CRUISER — @image_2: a black-and-white police cruiser.
LOCATION — @image_3: rain-slick downtown streets at night, tall buildings on both sides, a sharp right turn at an intersection.
SHOTS (15 seconds total, multi-shot, 16:9):
Shot 1 (0.0s–3.0s) — Aerial shot: the coupe races down the avenue, the cruiser close behind.
Shot 2 (3.0s–5.0s) — Low tracking shot alongside the coupe at speed.
Shot 3 (5.0s–7.0s) — Close-up on the driver through the windshield: she glances at the mirror.
Shot 4 (7.0s–10.0s) — Wide shot at the intersection: the coupe drifts through the right turn; the cruiser follows.
Shot 5 (10.0s–12.0s) — Rear shot behind the cruiser as it gains.
Shot 6 (12.0s–15.0s) — Wide static shot: the cruiser skids and crashes into a parked truck.
CONSISTENCY:
Same.
MOTION AND PHYSICS:
Real.
LIGHTING:
Neon and streetlights.
TECHNICAL:
16:9, 24fps.
MUSIC:
Synth.
AUDIO (native sound, synced to picture):
0.0s sirens.
`;

export const CAR_CHASE_PLAN = {
  schema: "cinakey.staging/1.0",
  set: {
    terrain: "urban",
    timeOfDay: "night",
    features: [
      {
        kind: "road",
        at: [0, 0],
        points: [
          [-10, 0],
          [150, 0],
          [150, 100],
        ],
        size: [12, 0.02, 0],
      },
      { kind: "building", at: [40, 14], size: [40, 30, 12] },
      { kind: "building", at: [40, -14], size: [40, 25, 12] },
      { kind: "building", at: [100, 14], size: [40, 40, 12] },
      { kind: "building", at: [100, -14], size: [40, 22, 12] },
      { kind: "building", at: [170, -30], size: [20, 35, 30] },
      {
        kind: "car",
        id: "truck",
        name: "Parked truck",
        at: [157, 60],
        size: [2.4, 3, 7],
        rot: 0,
      },
      { kind: "lamp", at: [70, 7], size: [0.3, 6, 0.3] },
    ],
  },
  cast: [
    {
      id: "coupe",
      name: "Red coupe",
      kind: "vehicle",
      imageN: 1,
      at: [0, -2],
      facing: 90,
    },
    {
      id: "driver",
      name: "Driver",
      kind: "person",
      at: [0, -2],
      rides: "coupe",
      ridesFrom: 0,
    },
    {
      id: "cruiser",
      name: "Police cruiser",
      kind: "vehicle",
      imageN: 2,
      at: [-18, -2],
      facing: 90,
      color: "#e6e6e3",
    },
  ],
  shots: [
    {
      n: 1,
      moves: [
        { who: "coupe", action: "drive", path: [[60, -2]] },
        { who: "cruiser", action: "drive", path: [[44, -2]] },
      ],
      camera: {
        size: "wide",
        angle: "overhead",
        side: "back",
        move: "follow",
        subject: "coupe",
      },
    },
    {
      n: 2,
      moves: [
        { who: "coupe", action: "drive", path: [[100, -2]] },
        { who: "cruiser", action: "drive", path: [[82, -2]] },
      ],
      camera: {
        size: "full",
        angle: "low",
        side: "left",
        move: "track",
        subject: "coupe",
      },
    },
    {
      n: 3,
      moves: [
        { who: "coupe", action: "drive", path: [[136, -2]] },
        { who: "cruiser", action: "drive", path: [[120, -2]] },
      ],
      camera: {
        size: "cu",
        angle: "eye",
        side: "front",
        move: "follow",
        subject: "driver",
      },
    },
    {
      n: 4,
      moves: [
        {
          who: "coupe",
          action: "drive",
          path: [
            [148, -1],
            [152, 6],
            [152, 40],
          ],
        },
        {
          who: "cruiser",
          action: "drive",
          path: [
            [146, -1],
            [151, 6],
            [151, 20],
          ],
        },
      ],
      camera: {
        size: "wide",
        angle: "high",
        side: "front_right",
        move: "pan",
        subject: "coupe",
      },
    },
    {
      n: 5,
      moves: [
        { who: "coupe", action: "drive", path: [[152, 70]] },
        { who: "cruiser", action: "drive", path: [[151, 50]] },
      ],
      camera: {
        size: "full",
        angle: "eye",
        side: "back",
        move: "follow",
        subject: "cruiser",
      },
    },
    {
      n: 6,
      moves: [
        { who: "coupe", action: "drive", path: [[152, 110]] },
        {
          who: "cruiser",
          action: "drive",
          path: [
            [154, 55],
            [156.5, 56.5],
          ],
          face: 30,
          to: 0.5,
        },
      ],
      camera: {
        size: "wide",
        angle: "eye",
        side: "right",
        move: "static",
        subject: "truck",
      },
    },
  ],
};
