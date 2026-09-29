import { describe, expect, it } from "vitest";
import { parseScriptPromptText } from "./parse";
import { normalizePromptText } from "./renderers";
import { directPartDocumentFromScript } from "../blockout/director";

const CHASE_MD = `REFERENCES
@[Image 1](image_1) = the girl. Use it for her exact face, hair, freckles, scar, cloak, clothing, gear, pistol and proportions from every angle.
@[Image 2](image_2) = the giant riding hare. Use it for its exact tall, long-legged body shape, fur, ears, leg brace and springs, bridle, neck scarf, saddle and side satchel.
@[Image 3](image_3) = the night forest and chasm. Use it for the exact giant trees, roots, ferns, glowing mushrooms, fireflies, moonlight, cliff, chasm, waterfall and far side of the forest.
@[Image 4](image_4) = the campfire. Use it for the exact campsite, fire, stone ring, log bench, pot, tent and surrounding forest.
@[Image 5](image_5) = the bandits and their raptors. Use it for the exact look of all four bandits and their dinosaur mounts.

ART STYLE — LOCKED TO THE REFERENCE IMAGES:
Soft painted anime.

IMAGE QUALITY — ALWAYS SHARP AND CLEAN:
Every frame sharp.

THE GIRL — @[Image 1](image_1), identical in every shot:
A slim young woman with light olive skin.

THE HARE — @[Image 2](image_2): a tall, lean, horse-sized hare standing high on long, slender legs.

THE BANDITS — @[Image 5](image_5), four of them, identical: lean men in pale bone-white duster coats. They ride pony-sized, two-legged raptors with charcoal-black scales.

LOCATIONS: the @[Image 4](image_4) campfire at night, then the @[Image 3](image_3) moonlit forest and chasm. No readable text.

SHOTS (30 seconds total, multi-shot, 16:9):
Shot 1 (0.0s–1.5s) — Close-up on the @[Image 4](image_4) campfire at night: sparks drift upward.
Shot 3 (3.0s–4.0s) — Close-up on @[Image 1](image_1): she takes the pouch and tucks it into the @[Image 2](image_2) hare's satchel.
Shot 9 (10.0s–11.0s) — Low wide shot: four @[Image 5](image_5) bandits on their raptors burst out of the ferns.
Shot 10 (11.0s–12.0s) — Close-up: she snaps the reins; the hare explodes into a full sprint.

CONSISTENCY:
Style never changes.

MOTION AND PHYSICS:
The hare moves like a real hare.

LIGHTING:
Warm orange firelight.

TECHNICAL:
16:9, 24fps.

MUSIC:
Eerie score.

AUDIO (native sound, synced to picture, no dialogue):
0.0s crackling fire.
`;

describe("markdown @Image chips + LOCATIONS", () => {
  it("normalizes @[Image N](image_N) to @image_N", () => {
    const n = normalizePromptText(
      "@[Image 2](image_2) and @[IMAGE 5](IMAGE_5)\nLOCATIONS: camp",
    );
    expect(n).toContain("@image_2");
    expect(n).toContain("@image_5");
    expect(n).toMatch(/^LOCATION —/m);
  });

  it("parses girl, hare, bandits cast and directs full stand-ins", () => {
    const script = parseScriptPromptText(CHASE_MD);
    expect(script.references.map((r) => r.imageN).sort()).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(script.castBlocks.map((c) => c.name)).toEqual([
      "girl",
      "hare",
      "bandits",
    ]);
    expect(script.location.description.toLowerCase()).toMatch(/campfire/);

    const doc = directPartDocumentFromScript(
      script,
      { id: "p", title: "Chase", aspectRatio: "16:9", fps: 24 },
      { sequenceTitle: "SEQ01" },
    );

    const figures = doc.objects.filter((o) =>
      ["character", "hare", "raptor"].includes(o.type),
    );
    const names = figures.map((o) => o.name);
    // Pure TS director (gen_chase algorithms) — girl / hare / Bandit n / Raptor n
    expect(names.some((n) => /girl/i.test(n))).toBe(true);
    expect(names.some((n) => /hare/i.test(n))).toBe(true);
    expect(figures.filter((o) => /bandit/i.test(o.name)).length).toBe(4);
    expect(figures.filter((o) => /raptor/i.test(o.name)).length).toBe(4);
    expect(figures.filter((o) => /^Bandit 1$/i.test(o.name)).length).toBe(1);
    expect(figures.some((o) => o.name === "Figure")).toBe(false);
    expect(figures.length).toBe(10); // girl + hare + 4 bandits + 4 raptors
    expect(doc.objects.filter((o) => o.type === "tree").length).toBeGreaterThan(40);
    expect(doc.objects.filter((o) => o.type === "strip").length).toBeGreaterThan(5);
    expect(doc.objects.length).toBeGreaterThan(80); // dense set dressing, not stub
    expect(doc.camera.keys.length).toBeGreaterThanOrEqual(doc.shots.length);

    // Mount travels continuously mid-chase (speed-integrated X growth)
    const mount = figures.find((o) => /hare/i.test(o.name))!;
    const xAt = (sec: number) => {
      const f = Math.round(sec * 24);
      const keys = mount.keys;
      const a = [...keys].reverse().find((k) => k.f <= f) ?? keys[0]!;
      return a.x;
    };
    expect(xAt(14)).toBeGreaterThan(xAt(8));
    expect(xAt(20)).toBeGreaterThan(xAt(14));

    // No duplicate cast display names
    const castNames = figures.map((o) => o.name);
    expect(new Set(castNames).size).toBe(castNames.length);

    // Hold cuts on shot boundaries after the first camera key
    const holds = doc.camera.keys.filter((k) => k.ease === "hold");
    expect(holds.length).toBeGreaterThan(0);
  });
});
