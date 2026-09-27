import { describe, expect, it } from "vitest";
import { parseToolArguments } from "./parseToolArguments";

describe("parseToolArguments", () => {
  it("parses normal JSON", () => {
    const result = parseToolArguments(
      JSON.stringify({ summary: "Draft", document: { scenes: [] } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.summary).toBe("Draft");
  });

  it("unwraps stringified document", () => {
    const result = parseToolArguments(
      JSON.stringify({
        summary: "Draft",
        document: JSON.stringify({ schema: "cinakey.script/1.0", scenes: [{ heading: "INT. A" }] }),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.value.document).toBe("object");
    }
  });

  it("strips markdown fences", () => {
    const result = parseToolArguments(
      "```json\n{\"summary\":\"Hi\",\"scenes\":[]}\n```",
    );
    expect(result.ok).toBe(true);
  });

  it("repairs truncated JSON objects", () => {
    const result = parseToolArguments(
      '{"summary":"Draft","document":{"format":"screenplay","scenes":[{"heading":"EXT. ROAD","beats":[{"action":"Chase"',
    );
    expect(result.ok).toBe(true);
  });
});
