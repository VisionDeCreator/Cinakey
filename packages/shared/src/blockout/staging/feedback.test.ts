import { describe, expect, it } from "vitest";
import { buildAuditRepairMessage } from "./feedback";
import { KITCHEN_PLAN } from "./fixtures/kitchen";
import { parseStagingPlan } from "./schema";
const parsed = parseStagingPlan(KITCHEN_PLAN);
if (!parsed.ok) throw new Error(parsed.error);
const plan = parsed.plan;

describe("buildAuditRepairMessage", () => {
  it("lists each faulty shot once with a hint and its current camera", () => {
    const msg = buildAuditRepairMessage(
      [
        { shot: 4, frame: 241, problem: "Maya out of frame" },
        { shot: 4, frame: 280, problem: "Maya out of frame" },
        { shot: 5, frame: 300, problem: "camera inside counter" },
      ],
      plan,
    );
    expect(msg.content.match(/Shot 4:/g)).toHaveLength(1);
    expect(msg.content).toMatch(
      /Shot 4: Maya out of frame \(the camera does not see them/,
    );
    expect(msg.content).toMatch(
      /Shot 5: camera inside counter \(the camera is inside a set piece/,
    );
    expect(msg.content).toContain('"subject":"maya"');
    expect(msg.content).toMatch(/Return the corrected full JSON object only/);
  });
});
