import { describe, expect, it, vi } from "vitest";
import { withProviderSignal } from "../runtime/provider-scope";
import {
  ProviderError,
  redactSensitiveValue,
  safeErrorMessage,
} from "./errors";
import {
  providerFetch,
  retryAfterMs,
  setProviderTransportForTests,
} from "./transport";
function live() {
  vi.stubEnv("USE_MOCK_ADAPTERS", "false");
  vi.stubEnv("PROVIDER_READ_RETRIES", "1");
}
describe("controlled provider transport", () => {
  it("cannot send a paid call in mock mode or through a real test transport", async () => {
    const send = vi.fn();
    setProviderTransportForTests(send);
    await expect(
      providerFetch("openai", "https://api.openai.com/v1/images/generations", {
        method: "POST",
      }),
    ).rejects.toThrow("mock mode");
    expect(send).not.toHaveBeenCalled();
    live();
    setProviderTransportForTests();
    await expect(
      providerFetch("openai", "https://api.openai.com/v1/images/generations", {
        method: "POST",
      }),
    ).rejects.toThrow("blocked in tests");
  });
  it("never retries a paid POST after ambiguous failure, and hides response bodies", async () => {
    live();
    const send = vi
      .fn()
      .mockResolvedValue(
        new Response("private prompt and credentials", { status: 503 }),
      );
    setProviderTransportForTests(send);
    const error = await providerFetch(
      "openai",
      "https://api.openai.com/v1/images/generations",
      { method: "POST" },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.uncertain).toBe(true);
    expect(String(error)).not.toContain("private prompt");
    expect(send).toHaveBeenCalledOnce();
  });
  it("retries safe reads with a bounded budget and Retry-After support", async () => {
    live();
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("busy", { status: 429, headers: { "Retry-After": "0" } }),
      )
      .mockResolvedValueOnce(new Response("{}"));
    setProviderTransportForTests(send);
    expect(
      (await providerFetch("sume", "https://api.sume.com/v1/jobs/task/status"))
        .ok,
    ).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(retryAfterMs("120")).toBe(30_000);
  });
  it("propagates cancellation and timeouts without blindly retrying a paid call", async () => {
    live();
    const controller = new AbortController();
    controller.abort();
    const send = vi.fn();
    setProviderTransportForTests(send);
    await expect(
      withProviderSignal(controller.signal, () =>
        providerFetch("deepseek", "https://api.deepseek.com/chat/completions", {
          method: "POST",
        }),
      ),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    vi.stubEnv("PROVIDER_TIMEOUT_MS", "100");
    send.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    await expect(
      providerFetch("deepseek", "https://api.deepseek.com/chat/completions", {
        method: "POST",
      }),
    ).rejects.toMatchObject({ uncertain: true });
    expect(send).toHaveBeenCalledOnce();
  });
  it("blocks credential redirects and redacts nested errors", async () => {
    live();
    const send = vi.fn();
    setProviderTransportForTests(send);
    await expect(
      providerFetch("openai", "https://example.com/steal"),
    ).rejects.toThrow("origin");
    expect(send).not.toHaveBeenCalled();
    vi.stubEnv("OPENAI_API_KEY", "private-test-value");
    expect(
      safeErrorMessage(
        new Error(
          "private-test-value Bearer credential https://example.com/signed?token=x",
        ),
      ),
    ).not.toContain("private-test-value");
    expect(
      redactSensitiveValue({ apiKey: "value", message: "private-test-value" }),
    ).toEqual({ apiKey: "[redacted]", message: "[redacted]" });
  });
});

it("returns a bounded validation reason without exposing provider keys or signed URLs", async () => {
  live();
  vi.stubEnv("SUME_API_KEY", "validation-test-secret");
  setProviderTransportForTests(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            message:
              "Image too small validation-test-secret https://private.test/file?secret=1",
          },
        }),
        { status: 400 },
      ),
  );
  const error = await providerFetch(
    "sume",
    "https://api.sume.com/v1/jobs/task/status",
    { method: "POST" },
  ).catch((e) => e);
  expect(String(error)).toContain("Image too small");
  expect(String(error)).not.toContain("validation-test-secret");
  expect(String(error)).not.toContain("private.test");
});
