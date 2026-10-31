import { setTestProviders } from "../../test/setup";
import { afterEach, expect, it, vi } from "vitest";
import { completeChat, chatRequestMaximum } from "./deepseek";
import { normalizeTokenUsage, tokenUsagePrice } from "@dirrio/shared";
afterEach(() => vi.useRealTimers());
function live() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T02:00:00Z"));
  setTestProviders(false);
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture-key");
}
it("pins the verified Flash model, bounded non-thinking output, and preserves cache/input/output usage", async () => {
  live();
  const usage = {
    prompt_tokens: 1000,
    completion_tokens: 500,
    prompt_cache_hit_tokens: 500,
    prompt_cache_miss_tokens: 500,
    total_tokens: 1500,
  };
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      choices: [{ message: { content: "{}" } }],
      usage,
      created: Date.now() / 1000,
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await completeChat({
    messages: [{ role: "user", content: "Test" }],
    maxTokens: 2000,
    maxCostUsdMicros: 10_000,
  });
  expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toMatchObject({
    model: "deepseek-flash",
    max_tokens: 2000,
    thinking: { type: "disabled" },
  });
  expect(result.usage).toEqual(usage);
  expect(tokenUsagePrice(normalizeTokenUsage(result.usage)!)).toBe(904);
});
it("refuses an unbudgeted call or unpriced model without contacting the provider", async () => {
  live();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    completeChat({
      messages: [{ role: "user", content: "Test" }],
      maxCostUsdMicros: 1,
    }),
  ).rejects.toThrow(/budget/);
  await expect(
    completeChat({
      messages: [],
      model: "unpriced",
      maxCostUsdMicros: 100_000,
    }),
  ).rejects.toThrow(/Unpriced/);
  expect(fetch).not.toHaveBeenCalled();
});
it("bounds image tokens without counting base64 as text and includes repeated conversation input", () => {
  const text = chatRequestMaximum([{ role: "user", content: "Test" }], 2000);
  const image = chatRequestMaximum(
    [
      {
        role: "user",
        content: [
          { type: "text", text: "Test" },
          {
            type: "image_url",
            image_url: { url: "data:image/jpeg;base64," + "x".repeat(100000) },
          },
        ],
      },
    ],
    2000,
  );
  expect(image - text).toBeGreaterThan(315);
  expect(image - text).toBeLessThan(1000);
});
it("does not allow the generic adapter to bypass category-based text metering", async () => {
  const { deepseekAdapter } = await import("./deepseek");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(deepseekAdapter.submit({ messages: [] })).rejects.toThrow(
    /metered/,
  );
  expect(fetch).not.toHaveBeenCalled();
});

it.each([true, false])(
  "uses verified off-peak timestamps and holds missing timestamp evidence (%s)",
  async (withTimestamp) => {
    live();
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ message: { content: "{}" } }],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 500,
            prompt_cache_hit_tokens: 500,
          },
          ...(withTimestamp ? { created: Date.now() / 1000 } : {}),
        }),
      ),
    );
    const result = await completeChat({
      messages: [{ role: "user", content: "Test" }],
      maxTokens: 2000,
      maxCostUsdMicros: 10000,
    });
    if (withTimestamp)
      expect(result.billingBatch).toMatchObject({
        period: "off_peak",
        providerCreatedAt: Date.now(),
        cachedInputTokens: 500,
      });
    else expect(result.billingBatch).toBeUndefined();
  },
);
