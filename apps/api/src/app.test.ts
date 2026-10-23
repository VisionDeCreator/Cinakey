import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { createApp } from "./app";
import { registry } from "./registry";
import { validateArgs } from "./runtime/validation";

const original = registry.get("storage:storeJson")!;
const request = (path: string, body: unknown = { args: {} }, token?: string) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.stubEnv("CONVEX_URL", "https://example.convex.cloud");
  vi.stubEnv("CONVEX_DEPLOY_KEY", "test-only");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  registry.set("storage:storeJson", original);
});
describe("API boundary", () => {
  it("requires a session and never exposes internal operations", async () => {
    const app = createApp();
    expect((await app.handle(request("/v1/projects/listMine"))).status).toBe(
      401,
    );
    expect(
      (
        await app.handle(
          request("/v1/generation/submitAndTrack", { args: {} }, "token"),
        )
      ).status,
    ).toBe(404);
    expect(
      (await app.handle(request("/v1/tasks/claim", { args: {} }, "token")))
        .status,
    ).toBe(404);
  });
  it("rejects invalid sessions before executing a service", async () => {
    const spy = vi
      .spyOn(ConvexHttpClient.prototype, "query")
      .mockRejectedValue(new Error("Invalid token"));
    const response = await createApp().handle(
      request("/v1/storage/storeJson", { args: { value: {} } }, "expired"),
    );
    expect(response.status).toBe(401);
    expect(spy).toHaveBeenCalledOnce();
  });
  it("forwards authenticated data operations and preserves structured errors", async () => {
    vi.spyOn(ConvexHttpClient.prototype, "query").mockImplementation(
      async (...[reference]) =>
        getFunctionName(reference as any) === "apiIdentity:current"
          ? { identity: { subject: "user|session" } }
          : [{ title: "Film" }],
    );
    const response = await createApp().handle(
      request("/v1/projects/listMine", { args: {} }, "token"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: [{ title: "Film" }] });
  });
  it("streams deltas without persisting each delta", async () => {
    vi.spyOn(ConvexHttpClient.prototype, "query").mockResolvedValue({
      identity: { subject: "user|session" },
    });
    const writes = vi.spyOn(ConvexHttpClient.prototype, "mutation");
    registry.set("storage:storeJson", {
      visibility: "public",
      args: { value: v.any() },
      handler: async (ctx) => {
        await ctx.runMutation(
          makeFunctionReference<any>("copilot:appendAssistantDelta"),
          { messageId: "m1", delta: "Hello" },
        );
        return { saved: true };
      },
    });
    const response = await createApp().handle(
      request(
        "/v1/storage/storeJson",
        { args: { value: {} }, stream: true },
        "token",
      ),
    );
    expect(response.status).toBe(200);
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events[0]).toMatchObject({ type: "delta", delta: "Hello" });
    expect(events[1]).toEqual({ type: "result", value: { saved: true } });
    expect(writes).not.toHaveBeenCalled();
  });
  it("rejects malformed and unknown service arguments", () => {
    const validators = {
      id: v.id("projects"),
      count: v.optional(v.number()),
      nested: v.object({ name: v.string() }),
    };
    expect(() =>
      validateArgs(validators, { id: "p", nested: { name: "Film" } }),
    ).not.toThrow();
    expect(() =>
      validateArgs(validators, { id: "p", nested: { name: 2 } }),
    ).toThrow("Invalid args.nested.name");
    expect(() =>
      validateArgs(validators, {
        id: "p",
        nested: { name: "Film" },
        admin: true,
      }),
    ).toThrow("Unexpected args.admin");
  });
});
