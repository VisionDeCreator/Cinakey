import { describe, expect, it } from "vitest";
import { parseScriptPromptText } from "../prompt-templates/parse";
import { directPartDocumentFromScript } from "./director";
import { camAt, objAt } from "./engine";

const SAMPLE = `REFERENCES
@image_1 = the boy. Use it for his face.
@image_2 = the giant cheetah. Use it for the mount.
@image_3 = the savanna. Use it for grassland and river.
@image_5 = the hybrid antelope. Use it for the herd.
@image_6 = the crocodile-shark. Use it for the river creature.

ART STYLE — LOCKED TO THE REFERENCE IMAGES:
Soft painted anime.

IMAGE QUALITY — ALWAYS SHARP AND CLEAN:
Every frame sharp.

THE BOY — @image_1, identical in every shot:
A lean teenage boy.

THE CHEETAH — @image_2: a horse-sized cheetah.

THE ANTELOPE — @image_5, every one in the herd: slender antelope.

THE CROCODILE-SHARK — @image_6: a huge river creature.

LOCATION — @image_3: golden savanna at sunset, tall grass, acacia trees, a river between red earth cliffs.

SHOTS (30 seconds total, multi-shot, 16:9):
Shot 1 (0.0s–1.5s) — Extreme wide shot, slow drift forward: the @image_3 savanna at sunset; far off, a herd of @image_5 antelope grazes.
Shot 2 (1.5s–3.0s) — Close-up: a single antelope grazing.
Shot 3 (3.0s–5.0s) — Low side shot: the @image_2 cheetah lies flattened beside @image_1.
Shot 4 (5.0s–8.0s) — Low shot at ground level: the herd explodes into motion, hooves pounding past the camera.
Shot 5 (8.0s–12.0s) — Low tracking shot alongside at full speed: the cheetah stretched out in a full sprint, the boy crouched low.
Shot 6 (12.0s–16.0s) — High rear drone shot: they cut into the breakaway group.
Shot 7 (16.0s–20.0s) — Wide side shot: the cheetah leaps out over the river.
Shot 8 (20.0s–24.0s) — Low shot from the water: the @image_6 crocodile-shark erupts from the river.
Shot 9 (24.0s–28.0s) — Medium shot: the cheetah skids to a stop and the boy raises the rifle.
Shot 10 (28.0s–30.0s) — Hard cut to black as the gunshot rings out.

CONSISTENCY:
Style never changes.

MOTION AND PHYSICS:
Cheetah gait is real.

LIGHTING:
Warm golden sunset.

TECHNICAL:
16:9, 24fps.

MUSIC:
Epic score.

AUDIO (native sound, synced to picture, no dialogue):
0.0s wind. 5.0s hooves. 28.0s gunshot.
`;

describe("directPartDocumentFromScript", () => {
  it("builds a full chase-style part from SHOTS", () => {
    const script = parseScriptPromptText(SAMPLE);
    const doc = directPartDocumentFromScript(
      script,
      {
        id: "proj",
        title: "Hunt",
        aspectRatio: "16:9",
        fps: 24,
      },
      { sequenceId: "seq1", sequenceTitle: "Part 1" },
    );

    expect(doc.schema).toBe("cinakey.blockout/2.0");
    expect(doc.frames).toBe(720);
    expect(doc.shots.length).toBe(10);
    // One key per cut boundary (hold cuts share the boundary frame).
    expect(doc.camera.keys.length).toBeGreaterThanOrEqual(10);

    const cast = doc.objects.filter(
      (o) => o.type === "character" || o.type === "hare" || o.type === "raptor",
    );
    expect(cast.length).toBeGreaterThanOrEqual(4);

    const moving = cast.filter((o) => o.keys.length > 10);
    expect(moving.length).toBeGreaterThanOrEqual(2);

    // Camera and cast evaluate without throwing mid-chase
    const mid = camAt(doc.camera.keys, 300);
    expect(mid.pos[0]).toBeGreaterThan(5);
    const mount = cast.find((o) => /cheetah/i.test(o.name));
    expect(mount).toBeTruthy();
    const pose = objAt(mount!, 300);
    expect(pose.x).toBeGreaterThan(5);
  });

  it("moving shots animate within the shot and cut hard at boundaries", () => {
    const script = parseScriptPromptText(SAMPLE);
    const doc = directPartDocumentFromScript(script, {
      id: "p",
      title: "T",
      aspectRatio: "16:9",
      fps: 24,
    });
    const mount = doc.objects.find((o) => /cheetah/i.test(o.name))!;

    // Shot 5 (8–12s) is a low tracking shot: the camera must travel with the mount.
    const a = camAt(doc.camera.keys, 8 * 24 + 6);
    const b = camAt(doc.camera.keys, 12 * 24 - 6);
    expect(b.pos[0] - a.pos[0]).toBeGreaterThan(10);
    const mb = objAt(mount, 12 * 24 - 6);
    expect(Math.abs(b.target[0] - mb.x)).toBeLessThan(3);

    // Every shot's first key is not a hold unless the shot is static (one key).
    for (const cut of doc.shots) {
      const inShot = doc.camera.keys.filter(
        (k) => k.f >= cut.start && k.f < cut.end,
      );
      if (inShot.length >= 2) expect(inShot[0]!.ease).not.toBe("hold");
      expect(inShot[inShot.length - 1]?.ease).toBe("hold");
    }
  });

  it("dresses a savanna, not the SEQ01 forest", () => {
    const script = parseScriptPromptText(SAMPLE);
    const doc = directPartDocumentFromScript(script, {
      id: "p",
      title: "T",
      aspectRatio: "16:9",
      fps: 24,
    });
    const has = (id: string) => doc.objects.some((o) => o.id === id);
    const count = (t: string) => doc.objects.filter((o) => o.type === t).length;
    expect(has("fire")).toBe(false);
    expect(has("moon")).toBe(false);
    expect(has("fx-gold")).toBe(false);
    expect(has("river")).toBe(true);
    expect(has("sun")).toBe(true);
    expect(count("strip")).toBe(0);
    expect(count("tree")).toBeGreaterThan(2);
    expect(count("tree")).toBeLessThan(40);
    expect(doc.env?.sky).not.toBe("#2a2d33");
  });

  it("stages the herd ahead of the hunters and the river creature in its shot", () => {
    const script = parseScriptPromptText(SAMPLE);
    const doc = directPartDocumentFromScript(script, {
      id: "p",
      title: "T",
      aspectRatio: "16:9",
      fps: 24,
    });
    const byName = (re: RegExp) => doc.objects.find((o) => re.test(o.name))!;
    const cheetah = byName(/cheetah/i);
    const antelope = byName(/^antelope$/i);
    const herd = doc.objects.filter((o) => /^antelope \d/i.test(o.name));
    expect(herd).toHaveLength(4);

    // Grazing well ahead, not glued to the cheetah
    const a0 = objAt(antelope, 0);
    expect(a0.x - objAt(cheetah, 0).x).toBeGreaterThan(8);
    expect(objAt(antelope, 24).x).toBeCloseTo(a0.x, 1);
    // Bolts when the herd explodes into motion (5 s)
    expect(objAt(antelope, 7 * 24).x - a0.x).toBeGreaterThan(5);
    // Herd members scatter wide of the path
    expect(
      Math.max(...herd.map((o) => Math.abs(objAt(o, 20 * 24).z))),
    ).toBeGreaterThan(10);

    // Crocodile-shark only in shot 8 (20–24 s)
    const croc = byName(/crocodile/i);
    expect(objAt(croc, 10 * 24).y).toBeLessThan(-20);
    expect(objAt(croc, 22 * 24).y).toBeGreaterThan(-5);
  });

  it("still creates character stand-ins when only REFERENCES exist (no THE cast blocks)", () => {
    const thin = SAMPLE.replace(/THE BOY[\s\S]*?(?=LOCATION)/, "");
    const script = parseScriptPromptText(thin);
    expect(script.castBlocks.length).toBe(0);
    expect(script.references.length).toBeGreaterThanOrEqual(4);

    const doc = directPartDocumentFromScript(script, {
      id: "p",
      title: "T",
      aspectRatio: "16:9",
      fps: 24,
    });
    const figures = doc.objects.filter(
      (o) => o.type === "character" || o.type === "hare" || o.type === "raptor",
    );
    expect(figures.length).toBeGreaterThanOrEqual(3);
    expect(figures.some((o) => /boy/i.test(o.name))).toBe(true);
    expect(figures.some((o) => /cheetah/i.test(o.name))).toBe(true);

    // Shot that names the boy should have him keyed into that range
    const boy = figures.find((o) => /boy/i.test(o.name))!;
    const shot3 = script.shots.find((s) => s.n === 3)!;
    const f = Math.round(((shot3.startSec + shot3.endSec) / 2) * 24);
    const near = boy.keys.filter((k) => Math.abs(k.f - f) <= 24);
    expect(near.length).toBeGreaterThan(0);
  });
});
