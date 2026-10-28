import { setTestProviders } from "../../test/setup";
import { describe, expect, it, vi } from "vitest";
import { seedance25Adapter as adapter } from "./seedance25";
import { remixLiteAdapter } from "./sume";
import { setProviderTransportForTests } from "./transport";
function fixture(data: unknown) {
  return new Response(JSON.stringify({ data }));
}
function live() {
  setTestProviders(false);
  vi.stubEnv("ENABLED_PROVIDERS", "deepseek,sume");
  vi.stubEnv("SUME_API_KEY", "test-key");
}
describe("Sume video contracts (no paid network)", () => {
  it("routes Seedance references and sends a stable idempotency key outside the JSON body", async () => {
    live();
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        fixture({
          model: "seedance-2.5",
          currency: "USD",
          usd_micros: 1_156_000,
        }),
      )
      .mockResolvedValueOnce(fixture({ job: { id: "job_fixture" } }));
    setProviderTransportForTests(send);
    const body = await adapter.buildRequest({
      prompt: "A scene",
      durationSec: 5,
      seed: 42,
      referenceImageUrls: ["https://fixture.test/ref.png"],
      referenceVideoUrl: "https://fixture.test/previz.mp4",
    });
    expect(body).toMatchObject({
      model: "seedance-2.5",
      duration: 5,
      seed: 42,
      reference_image_urls: ["https://fixture.test/ref.png"],
      reference_video_urls: ["https://fixture.test/previz.mp4"],
    });
    expect(
      await adapter.submit({
        ...body,
        _idempotencyKey: "cinakey:job:1",
        _maximumRetailUsdMicros: 1_218_000,
      }),
    ).toEqual({
      providerJobId: "job_fixture",
      supplierCostUpperBoundUsdMicros: 1_156_000,
    });
    expect(send.mock.calls[1]![0]).toBe(
      "https://api.sume.com/v1/video-router/generate",
    );
    expect(send.mock.calls[1]![1].headers["Idempotency-Key"]).toBe(
      "cinakey:job:1",
    );
    expect(JSON.parse(send.mock.calls[1]![1].body)).toEqual(body);
  });
  it("maps first/last frames and extension without Ark content fields", async () => {
    expect(
      await adapter.buildRequest({
        kind: "image-to-video",
        startFrameUrl: "https://fixture.test/first.png",
        endFrameUrl: "https://fixture.test/last.png",
      }),
    ).toMatchObject({
      image_url: "https://fixture.test/first.png",
      end_image_url: "https://fixture.test/last.png",
      aspect_ratio: "adaptive",
    });
    expect(
      await adapter.buildRequest({
        kind: "extend",
        referenceVideoUrl: "https://fixture.test/video.mp4",
      }),
    ).toMatchObject({
      video_url: "https://fixture.test/video.mp4",
      extend: true,
    });
    await expect(adapter.buildRequest({ durationSec: 31 })).rejects.toThrow(
      "4 to 30",
    );
  });
  it("routes Genjutsu to Remix Lite and rejects invalid source duration or missing references", async () => {
    live();
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        fixture({
          model: "sume-remix-lite-object-swap",
          currency: "USD",
          usd_micros: 2_000_000,
        }),
      )
      .mockResolvedValueOnce(fixture({ request_id: "job_remix" }));
    setProviderTransportForTests(send);
    const input = {
      durationSec: 10,
      referenceVideoUrl: "https://fixture.test/person.mp4",
      referenceImageUrls: ["https://fixture.test/character.png"],
      resolution: "1080p",
    };
    const body = await remixLiteAdapter.buildRequest(input);
    expect(body).toMatchObject({
      video_url: input.referenceVideoUrl,
      image_urls: input.referenceImageUrls,
      duration: 10,
      resolution: "1080p",
    });
    await remixLiteAdapter.submit({
      ...body,
      _maximumRetailUsdMicros: 3_100_000,
    });
    expect(send.mock.calls[1]![0]).toBe(
      "https://api.sume.com/v1/sume/remix-lite/object-swap/v1.0",
    );
    await expect(
      remixLiteAdapter.buildRequest({ ...input, durationSec: 16 }),
    ).rejects.toThrow("4–15");
    await expect(
      remixLiteAdapter.buildRequest({ ...input, referenceImageUrls: [] }),
    ).rejects.toThrow("1–8");
  });
  it("maps canonical and transport states and collects only video artifacts", async () => {
    live();
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        fixture({ status: "IN_PROGRESS", sume_status: "processing" }),
      )
      .mockResolvedValueOnce(fixture({ status: "COMPLETED" }))
      .mockResolvedValueOnce(
        fixture({
          job: {
            usage_summary: {
              final: true,
              status: "captured",
              captured_usd_cents: 116,
            },
          },
        }),
      )
      .mockResolvedValueOnce(fixture({ job: { status: "canceled" } }))
      .mockResolvedValueOnce(fixture({ status: "unexpected" }))
      .mockResolvedValueOnce(
        fixture({
          result: {
            artifacts: [
              { type: "image", url: "https://fixture.test/poster.png" },
              {
                type: "video",
                url: "https://fixture.test/video.mp4",
                content_type: "video/mp4",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(fixture({ result: { artifacts: [] } }));
    setProviderTransportForTests(send);
    expect(await adapter.poll("job")).toEqual({ status: "running" });
    expect(await adapter.poll("job")).toEqual({
      status: "succeeded",
      supplierActualCostUsdMicros: 1_160_000,
    });
    expect((await adapter.poll("job")).status).toBe("failed");
    await expect(adapter.poll("job")).rejects.toThrow("unrecognized");
    expect((await adapter.collect("job")).outputs).toEqual([
      {
        type: "video",
        url: "https://fixture.test/video.mp4",
        contentType: "video/mp4",
      },
    ]);
    await expect(adapter.collect("job")).rejects.toThrow("no video");
  });
});
it("blocks a supplier price increase before paid submission and strips internal pricing fields", async () => {
  live();
  const send = vi.fn().mockResolvedValue(
    fixture({
      model: "seedance-2.5",
      currency: "USD",
      usd_micros: 1_500_000,
    }),
  );
  setProviderTransportForTests(send);
  const body = await adapter.buildRequest({
    prompt: "A scene",
    durationSec: 5,
    resolution: "720p",
  });
  await expect(
    adapter.submit({
      ...body,
      _maximumRetailUsdMicros: 1_218_000,
      _idempotencyKey: "fixture",
    }),
  ).rejects.toMatchObject({ uncertain: false });
  expect(send).toHaveBeenCalledOnce();
  expect(String(send.mock.calls[0]![0])).toMatch(/\/v1\/open\/estimate$/);
  expect(
    JSON.parse(String(send.mock.calls[0]![1].body)).input,
  ).not.toHaveProperty("_maximumRetailUsdMicros");
});
it("treats an unavailable free estimator as a definite no-submission failure", async () => {
  live();
  const send = vi.fn().mockRejectedValue(new Error("Estimate timeout"));
  setProviderTransportForTests(send);
  await expect(
    adapter.submit({
      model: "seedance-2.5",
      duration: 5,
      resolution: "720p",
      _maximumRetailUsdMicros: 1_218_000,
    }),
  ).rejects.toMatchObject({ uncertain: false });
  expect(send).toHaveBeenCalledOnce();
});

it("requires a final captured supplier receipt and prefers micro-USD precision when available", async () => {
  live();
  const send = vi
    .fn()
    .mockResolvedValueOnce(fixture({ status: "COMPLETED" }))
    .mockResolvedValueOnce(
      fixture({
        job: {
          usage_summary: {
            final: false,
            status: "reserved",
            captured_usd_cents: 116,
          },
        },
      }),
    )
    .mockResolvedValueOnce(fixture({ status: "COMPLETED" }))
    .mockResolvedValueOnce(
      fixture({
        job: {
          usage_summary: {
            final: true,
            status: "captured",
            captured_usd_cents: 116,
            captured_usd_micros: 1156000,
          },
        },
      }),
    );
  setProviderTransportForTests(send);
  await expect(adapter.poll("job")).rejects.toThrow();
  expect(await adapter.poll("job")).toMatchObject({
    status: "succeeded",
    supplierActualCostUsdMicros: 1156000,
  });
});
