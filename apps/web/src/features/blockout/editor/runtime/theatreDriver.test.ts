import { blockoutTransform, type BlockoutNode } from "@cinakey/shared";
import { describe, expect, it } from "vitest";
import { TheatreDriver } from "./theatreDriver";

describe("TheatreDriver", () => {
  it("interpolates a camera push-in from generated Theatre state", () => {
    const nodes: BlockoutNode[] = [
      { id: "cam", kind: "camera", name: "Cam", transform: blockoutTransform([0, 1.6, 6]) },
      { id: "box", kind: "prop", name: "Box", propType: "box", transform: blockoutTransform() },
    ];
    const driver = new TheatreDriver(
      nodes,
      {
        cam: [
          { t: 0, position: [0, 1.6, 6], rotation: [0, 0, 0], scale: [1, 1, 1] },
          { t: 4, position: [0, 1.6, 2], rotation: [0, 0.5, 0], scale: [1, 1, 1] },
        ],
      },
      4,
      24,
    );
    expect(driver.animatedNodeIds).toEqual(["cam"]);
    expect(driver.sample(0).get("cam")!.position.z).toBeCloseTo(6);
    expect(driver.sample(4).get("cam")!.position.z).toBeCloseTo(2);
    const mid = driver.sample(2).get("cam")!;
    expect(mid.position.z).toBeCloseTo(4, 1);
    expect(mid.rotation.y).toBeCloseTo(0.25, 1);
    expect(driver.sample(1).get("cam")!.position.z).toBeGreaterThan(4);
  });
});
