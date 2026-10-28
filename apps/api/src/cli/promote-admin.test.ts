import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import { loadRootEnvironment } from "../config/load-root-env";
import { adminClient } from "../runtime/context";
import { runPromoteAdmin } from "./promote-admin";

vi.mock("../config/load-root-env", () => ({ loadRootEnvironment: vi.fn() }));
vi.mock("../runtime/context", () => ({ adminClient: vi.fn() }));
const mutation = vi.fn();
beforeEach(() => {
  vi.stubEnv("CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("CONVEX_DEPLOY_KEY", "secret-operator-key");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(adminClient).mockReturnValue({ mutation } as unknown as ReturnType<
    typeof adminClient
  >);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

it("shows help without loading credentials or connecting to a deployment", async () => {
  expect(await runPromoteAdmin(["--help"])).toBe(0);
  expect(loadRootEnvironment).not.toHaveBeenCalled();
  expect(adminClient).not.toHaveBeenCalled();
});

it("rejects invalid input before loading credentials or connecting", async () => {
  for (const args of [
    [],
    ["invalid"],
    ["a@test.com", "b@test.com"],
    ["a@test.com", "--reason", " "],
    ["a@test.com", "--unexpected"],
  ]) {
    expect(await runPromoteAdmin(args)).toBe(1);
  }
  expect(loadRootEnvironment).not.toHaveBeenCalled();
  expect(adminClient).not.toHaveBeenCalled();
});

it("promotes only the requested email on the configured deployment", async () => {
  mutation.mockResolvedValue({ email: "owner@test.com", alreadyAdmin: false });
  expect(
    await runPromoteAdmin([
      " OWNER@Test.com ",
      "--reason",
      " Initial administrator ",
    ]),
  ).toBe(0);
  expect(loadRootEnvironment).toHaveBeenCalledOnce();
  expect(mutation).toHaveBeenCalledOnce();
  const [reference, args] = mutation.mock.calls[0]!;
  expect(getFunctionName(reference)).toBe("staff:promoteAdmin");
  expect(args).toEqual({
    email: "owner@test.com",
    reason: "Initial administrator",
  });
  expect(console.log).toHaveBeenCalledWith(
    "Deployment: https://test.convex.cloud",
  );
});

it("reports an existing administrator as a successful no-op", async () => {
  mutation.mockResolvedValue({ email: "owner@test.com", alreadyAdmin: true });
  expect(await runPromoteAdmin(["owner@test.com"])).toBe(0);
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining("already a platform administrator"),
  );
});

it("requires deployment credentials before making a request", async () => {
  vi.stubEnv("CONVEX_DEPLOY_KEY", "");
  expect(await runPromoteAdmin(["owner@test.com"])).toBe(1);
  expect(mutation).not.toHaveBeenCalled();
});

it("reports backend validation errors but hides raw transport errors and secrets", async () => {
  mutation.mockRejectedValueOnce(
    new ConvexError("No existing account has this email."),
  );
  expect(await runPromoteAdmin(["owner@test.com"])).toBe(1);
  expect(console.error).toHaveBeenCalledWith(
    "No existing account has this email.",
  );
  mutation.mockRejectedValueOnce(
    new Error("Request failed using secret-operator-key"),
  );
  expect(await runPromoteAdmin(["owner@test.com"])).toBe(1);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
    "secret-operator-key",
  );
});
