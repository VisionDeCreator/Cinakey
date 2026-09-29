/**
 * A savanna hunt (not the SEQ01 forest chase): the director must stage the
 * scene the script describes — open ground, a river jump, a grazing herd that
 * bolts and scatters, a mount that waits for its launch, carried props.
 */
import { describe, expect, it } from "vitest";
import { parseScriptPromptText } from "../../prompt-templates/parse";
import { camAt, objAt } from "../engine";
import { HUNT_SCRIPT as HUNT } from "../staging/fixtures/hunt";
import { directPartDocumentFromScript } from "./index";

describe("director on a savanna hunt", () => {
  const doc = directPartDocumentFromScript(parseScriptPromptText(HUNT), {
    id: "p",
    title: "Hunt",
    aspectRatio: "16:9",
    fps: 24,
  });
  const F = (t: number) => Math.round(t * 24);
  const obj = (re: RegExp) => doc.objects.find((o) => re.test(o.name))!;
  const cheetah = obj(/^cheetah$/i);
  const boy = obj(/^boy$/i);
  const antelope = obj(/^antelope$/i);

  it("builds savanna set dressing", () => {
    const ids = doc.objects.map((o) => o.id);
    for (const id of ["fire", "moon", "fx-hand", "fx-gold"])
      expect(ids).not.toContain(id);
    for (const id of ["river", "sun", "fx-flash-rider"])
      expect(ids).toContain(id);
    expect(doc.objects.filter((o) => o.type === "strip")).toHaveLength(0);
    expect(doc.objects.filter((o) => o.type === "tree").length).toBeLessThan(
      40,
    );
    expect(doc.objects.some((o) => o.name === "Rock")).toBe(true);
  });

  it("keeps the cheetah still until it launches in shot 11", () => {
    expect(objAt(cheetah, F(11)).x).toBeCloseTo(objAt(cheetah, 0).x, 1);
    expect(objAt(cheetah, F(14)).x).toBeGreaterThan(8);
    // The boy waits beside it, then rides
    expect(objAt(boy, F(6)).y).toBeLessThan(0.1);
    expect(objAt(boy, F(14)).y).toBeGreaterThan(0.8);
  });

  it("has the antelope jump the river in its own shot, before the cheetah", () => {
    const edge = doc.objects.find((o) => o.id === "river")!;
    const riverX = edge.pos[0];
    const a = objAt(antelope, F(18));
    expect(Math.abs(a.x - riverX)).toBeLessThan(edge.size[0]);
    expect(a.y).toBeGreaterThan(0.8);
    expect(objAt(cheetah, F(18)).x).toBeLessThan(riverX - 3);
    expect(objAt(cheetah, F(20.5)).x).toBeGreaterThan(riverX);
  });

  it("carries the rifle and shows the bird only in the last shot", () => {
    const rifle = obj(/^rifle$/i);
    const bird = obj(/^bird$/i);
    for (const t of [3, 15, 25]) {
      const r = objAt(rifle, F(t));
      const b = objAt(boy, F(t));
      expect(Math.hypot(r.x - b.x, r.z - b.z)).toBeLessThan(0.6);
    }
    expect(objAt(bird, F(20)).y).toBeLessThan(-20);
    const bb = objAt(bird, F(29));
    const bo = objAt(boy, F(29));
    expect(bb.y).toBeGreaterThan(0);
    expect(Math.hypot(bb.x - bo.x, bb.z - bo.z)).toBeLessThan(0.8);
  });

  it("frames each shot's subject", () => {
    const near = (f: number, o: typeof antelope, d: number) => {
      const c = camAt(doc.camera.keys, f);
      const p = objAt(o, f);
      return Math.hypot(c.target[0] - p.x, c.target[2] - p.z) < d;
    };
    expect(near(F(0.7), antelope, 2)).toBe(true); // 1 close-up on the antelope
    expect(near(F(5.5), antelope, 2)).toBe(true); // 5 scope POV on the antelope
    expect(near(F(9.5), boy, 2)).toBe(true); // 9 close-up on the boy
    expect(near(F(13), cheetah, 3)).toBe(true); // 12 tracking the cheetah
    // 23 walk-away: locked off, the cheetah moves away from camera
    const c0 = camAt(doc.camera.keys, F(27.6));
    const c1 = camAt(doc.camera.keys, F(29.9));
    expect(c1.pos).toEqual(c0.pos);
    expect(objAt(cheetah, F(29.9)).x).toBeGreaterThan(
      objAt(cheetah, F(27.6)).x,
    );
  });
});
