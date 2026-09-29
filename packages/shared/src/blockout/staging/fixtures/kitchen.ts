/** Dialogue scene: two people in a kitchen, one walks out. */
export const KITCHEN_SCRIPT = `REFERENCES
@image_1 = Maya. Use it for her face.
@image_2 = Leo. Use it for his face.
@image_3 = the kitchen. Use it for the room.
ART STYLE — LOCKED TO THE REFERENCE IMAGES:
Naturalistic.
IMAGE QUALITY — ALWAYS SHARP AND CLEAN:
Sharp.
THE WOMAN — @image_1: Maya, thirties, tired.
THE MAN — @image_2: Leo, thirties, defensive.
LOCATION — @image_3: a small apartment kitchen at night, a counter along one wall, a table with two chairs, a door to the hallway.
SHOTS (20 seconds total, multi-shot, 16:9):
Shot 1 (0.0s–4.0s) — Wide shot: Maya sits at the table, Leo stands at the counter with his back to her.
Shot 2 (4.0s–7.0s) — Over-the-shoulder on Maya: she asks where he was last night.
Shot 3 (7.0s–10.0s) — Medium close-up on Leo: he turns to face her, jaw tight.
Shot 4 (10.0s–13.0s) — Close-up on Maya: her eyes fill; she looks down.
Shot 5 (13.0s–17.0s) — Medium shot, tracking: Leo crosses the kitchen to the door.
Shot 6 (17.0s–20.0s) — Wide shot: Maya alone at the table as the door closes.
CONSISTENCY:
Same.
MOTION AND PHYSICS:
Real.
LIGHTING:
Single pendant lamp.
TECHNICAL:
16:9, 24fps.
MUSIC:
None.
AUDIO (native sound, synced to picture):
0.0s fridge hum.
`;

export const KITCHEN_PLAN = {
  schema: "cinakey.staging/1.0",
  set: {
    terrain: "interior",
    timeOfDay: "night",
    features: [
      { kind: "floor", at: [0, 0], size: [8, 0.05, 6] },
      { kind: "wall", at: [0, -3], size: [8, 2.7, 0.2], rot: 0 },
      { kind: "wall", at: [-4, 0], size: [6, 2.7, 0.2], rot: 90 },
      {
        kind: "counter",
        id: "counter",
        at: [-1.5, -2.5],
        size: [3, 0.95, 0.7],
      },
      { kind: "table", id: "table", at: [1, 0.5] },
      { kind: "chair", at: [1, 1.3], rot: 180 },
      { kind: "chair", at: [1, -0.3] },
      { kind: "door", id: "door", at: [3.8, -1.5], rot: 90 },
      { kind: "lamp", at: [1, 0.5], size: [0.3, 2.3, 0.3] },
    ],
  },
  cast: [
    {
      id: "maya",
      name: "Maya",
      kind: "person",
      imageN: 1,
      at: [1, 1.3],
      facing: 180,
    },
    {
      id: "leo",
      name: "Leo",
      kind: "person",
      imageN: 2,
      at: [-1.5, -1.9],
      facing: 180,
    },
  ],
  shots: [
    {
      n: 1,
      moves: [{ who: "maya", action: "sit" }],
      camera: {
        size: "wide",
        angle: "eye",
        side: "front_left",
        move: "static",
        subject: "maya",
        subject2: "leo",
      },
    },
    {
      n: 2,
      moves: [],
      camera: {
        size: "mcu",
        angle: "eye",
        side: "front",
        move: "static",
        subject: "maya",
        subject2: "leo",
        overShoulder: true,
      },
    },
    {
      n: 3,
      moves: [{ who: "leo", action: "turn", face: "maya", to: 0.4 }],
      camera: {
        size: "mcu",
        angle: "eye",
        side: "front",
        move: "static",
        subject: "leo",
      },
    },
    {
      n: 4,
      moves: [{ who: "maya", action: "sit", face: 200 }],
      camera: {
        size: "cu",
        angle: "eye",
        side: "front_right",
        move: "push_in",
        subject: "maya",
      },
    },
    {
      n: 5,
      moves: [
        {
          who: "leo",
          action: "walk",
          path: [
            [1.5, -1.8],
            [3.4, -1.5],
          ],
          face: 90,
        },
      ],
      camera: {
        size: "medium",
        angle: "eye",
        side: "left",
        move: "follow",
        subject: "leo",
      },
    },
    {
      n: 6,
      moves: [{ who: "leo", action: "walk", path: [[5, -1.5]], to: 0.3 }],
      camera: {
        size: "wide",
        angle: "high",
        side: "front_left",
        move: "static",
        subject: "maya",
      },
    },
  ],
};
