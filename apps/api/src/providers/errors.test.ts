import { describe, expect, it } from "vitest";
import { safeErrorMessage, workerCancellationError } from "./errors";

describe("ES2021-compatible cancellation errors", () => {
  it("preserves the cause without an ErrorOptions constructor or enumerable secret details", () => {
    const cause = new Error("private diagnostic");
    const error = workerCancellationError(cause);
    expect(error).toBeInstanceOf(Error);
    expect(Object.getOwnPropertyDescriptor(error, "cause")).toMatchObject({
      value: cause,
      enumerable: false,
    });
    expect(safeErrorMessage(error)).toBe("Worker request cancelled");
    expect(JSON.stringify(error)).not.toContain("private diagnostic");
  });
});
