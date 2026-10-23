import { describe, expect, it } from "vitest";
import {
  assignScriptReferenceImage,
  listScriptImageNs,
} from "./scriptReferenceAssign";

describe("assignScriptReferenceImage", () => {
  it("rewrites an existing REFERENCES line label", () => {
    const src = `REFERENCES
@image_1 = the girl. Use it for her face.
@image_2 = the hare. Use it for the mount.

SHOTS
Shot 1 (0.0s–2.0s) — Wide.`;
    const out = assignScriptReferenceImage(src, 1, "Maya");
    expect(out).toContain("@image_1 = Maya. Use it for her face.");
    expect(out).toContain("@image_2 = the hare. Use it for the mount.");
  });

  it("inserts under REFERENCES when the slot is missing", () => {
    const src = `REFERENCES
@image_2 = the hare. Use it for the mount.

SHOTS`;
    const out = assignScriptReferenceImage(src, 1, "Maya");
    expect(out).toMatch(
      /REFERENCES\n@image_1 = Maya\. Use it for its exact appearance\.\n@image_2/,
    );
  });

  it("prepends REFERENCES when none exists", () => {
    const out = assignScriptReferenceImage("SHOTS\nShot 1", 1, "Maya");
    expect(out.startsWith("REFERENCES\n@image_1 = Maya")).toBe(true);
  });
});

describe("listScriptImageNs", () => {
  it("returns unique sorted image numbers", () => {
    expect(
      listScriptImageNs(
        "@image_2 and @image_1 then @image_2 again and LOCATION — @image_3:",
      ),
    ).toEqual([1, 2, 3]);
  });
});
