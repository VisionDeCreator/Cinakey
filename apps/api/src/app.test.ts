import * as publications from "./services/publishedExports";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
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
  it("does not expose retired assistant or image entrypoints", async () => {
    const app = createApp();
    for (const path of [
      "copilot/runTurn",
      "copilot/listMessages",
      "proposals/accept",
      "generation/startIdentitySet",
      "promptSheets/approveAssetSheet",
    ]) {
      expect(
        (await app.handle(request(`/v1/${path}`, { args: {} }, "token")))
          .status,
      ).toBe(404);
    }
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

describe("export/sharing HTTP boundaries", () => {
  it("blocks unauthenticated upload/download and hides internal publication operations", async () => {
    const app = createApp();
    const upload = await app.handle(
      new Request("http://localhost/exports/example/upload", {
        method: "POST",
        headers: { "Content-Type": "video/mp4" },
        body: new Uint8Array([1, 2, 3]),
      }),
    );
    expect(upload.status).toBe(401);
    expect(
      (await app.handle(new Request("http://localhost/exports/example/file")))
        .status,
    ).toBe(401);
    expect(
      (
        await app.handle(
          request("/v1/publishedExports/finalize", { args: {} }, "token"),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.handle(
          request("/v1/exportSharing/openSession", { args: {} }, "token"),
        )
      ).status,
    ).toBe(404);
  });
  it("passes raw MP4 bytes to the authenticated upload service without JSON parsing", async () => {
    vi.spyOn(ConvexHttpClient.prototype, "query").mockResolvedValue({
      identity: { subject: "user|session" },
    });
    const bytes = new Uint8Array([0, 1, 2, 3, 4]);
    const upload = vi
      .spyOn(publications, "uploadPublication")
      .mockImplementation(async (_ctx, publicationId, request) => {
        expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);
        return { publicationId };
      });
    const response = await createApp().handle(
      new Request("http://localhost/exports/publication/upload", {
        method: "POST",
        headers: {
          "Content-Type": "video/mp4",
          Authorization: "Bearer fixture",
        },
        body: bytes,
      }),
    );
    expect(response.status).toBe(200);
    expect(upload).toHaveBeenCalledOnce();
  });
  it("rejects unauthenticated media, including HEAD, without disclosing storage locations", async () => {
    const app = createApp();
    for (const method of ["GET", "HEAD"]) {
      const response = await app.handle(
        new Request("http://localhost/public/shares/example/media", { method }),
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});

it("returns actionable authorization errors without Convex request IDs or stack frames", async () => {
  vi.spyOn(ConvexHttpClient.prototype, "query").mockResolvedValue({
    identity: { subject: "user|session" },
  });
  vi.spyOn(ConvexHttpClient.prototype, "mutation").mockRejectedValue(
    new Error(
      "[Request ID: abc123] Server Error\nUncaught Error: Workspace access denied\n    at requireWorkspaceAccess (../../convex/lib/access.ts:112:9)",
    ),
  );
  const response = await createApp().handle(
    request(
      "/v1/teams/invite",
      {
        args: {
          workspaceId: "workspace",
          email: "qa@example.test",
          role: "creator",
        },
      },
      "token",
    ),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ message: "Workspace access denied" });
});

it("keeps payment settlement internal and rejects unsigned Polar webhooks", async () => {
  const app = createApp();
  expect(
    (
      await app.handle(
        request("/v1/payments/applyOrder", { args: {} }, "token"),
      )
    ).status,
  ).toBe(404);
  expect((await app.handle(request("/webhooks/polar", {}))).status).toBe(503);
  for (const [name, value] of Object.entries({
    POLAR_PAYMENTS_ENABLED: "true",
    POLAR_ENVIRONMENT: "sandbox",
    POLAR_ACCESS_TOKEN: "test-token",
    POLAR_WEBHOOK_SECRET: "test-secret",
    POLAR_WORKSPACE_PRODUCT_ID: "sub",
    POLAR_TOPUP_10_PRODUCT_ID: "top-10",
    POLAR_TOPUP_25_PRODUCT_ID: "top-25",
    POLAR_TOPUP_50_PRODUCT_ID: "top-50",
  }))
    vi.stubEnv(name, value);
  expect(
    (
      await app.handle(
        request("/webhooks/polar", {
          type: "order.paid",
          data: { id: "order" },
        }),
      )
    ).status,
  ).toBe(403);
});
it("protects the unauthenticated OTP endpoint against foreign origins, oversized and unexpected payloads", async () => {
  const app = createApp();
  const foreign = new Request("http://localhost/auth/email/request", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://foreign.example",
    },
    body: JSON.stringify({ email: "person@example.com" }),
  });
  expect((await app.handle(foreign)).status).toBe(403);
  expect(
    (
      await app.handle(
        request("/auth/email/request", {
          email: "person@example.com",
          code: "123456",
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await app.handle(
        request("/auth/email/request", { email: "x".repeat(2000) }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await app.handle(
        request("/auth/email/request", { email: "person@example.com" }),
      )
    ).status,
  ).toBe(503);
  expect(
    (await app.handle(request("/v1/authOtp/issue", { args: {} }, "token")))
      .status,
  ).toBe(404);
});
