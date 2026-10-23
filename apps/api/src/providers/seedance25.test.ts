import { describe, expect, it, vi } from "vitest";
import { seedance25Adapter as adapter } from "./seedance25";
import { setProviderTransportForTests } from "./transport";

describe("documented Seedance task contract (no network)", () => {
  it("submits model IDs, reference roles and seeds using recorded request shapes", async () => {
    vi.stubEnv("USE_MOCK_ADAPTERS", "false");
    vi.stubEnv("SEEDANCE_API_KEY", "test-key");
    const send = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "fixture-task" })));
    setProviderTransportForTests(send);
    const body = await adapter.buildRequest({
      kind: "text-to-video",
      prompt: "A scene",
      durationSec: 5,
      seed: 42,
      referenceImageUrls: ["https://fixture.test/ref.png"],
      referenceVideoUrl: "https://fixture.test/previz.mp4",
    });
    expect(body).toMatchObject({
      model: "doubao-seedance-2-5-260628",
      seed: 42,
      duration: 5,
      omni_reference_task_type: "reference",
    });
    expect(body.content).toEqual([
      { type: "text", text: "A scene" },
      {
        type: "image_url",
        image_url: { url: "https://fixture.test/ref.png" },
        role: "reference_image",
      },
      {
        type: "video_url",
        video_url: { url: "https://fixture.test/previz.mp4" },
        role: "reference_video",
      },
    ]);
    expect(await adapter.submit(body)).toEqual({
      providerJobId: "fixture-task",
    });
    expect(JSON.parse(send.mock.calls[0]![1].body)).toEqual(body);
    expect(send).toHaveBeenCalledOnce();
  });
  it("uses adaptive first-frame and extension requests without invented operation fields", async () => {
    const frame = await adapter.buildRequest({
      kind: "image-to-video",
      startFrameUrl: "https://fixture.test/frame.png",
      endFrameUrl: "https://fixture.test/end.png",
      durationSec: 5,
    });
    expect(frame.ratio).toBe("adaptive");
    expect(frame).not.toHaveProperty("operation");
    const extension = await adapter.buildRequest({
      kind: "extend",
      referenceVideoUrl: "https://fixture.test/video.mp4",
      durationSec: 5,
    });
    expect(extension).toMatchObject({
      ratio: "adaptive",
      omni_reference_task_type: "extend",
    });
    await expect(adapter.buildRequest({ kind: "upscale" })).rejects.toThrow(
      "not supported",
    );
    await expect(adapter.buildRequest({ durationSec: 31 })).rejects.toThrow(
      "4 to 30",
    );
    await expect(
      adapter.buildRequest({
        startFrameUrl: "https://fixture.test/f.png",
        referenceImageUrls: ["https://fixture.test/r.png"],
      }),
    ).rejects.toThrow("cannot be combined");
  });
  it("handles expiry, unknown responses, and provider output metadata", async () => {
    vi.stubEnv("USE_MOCK_ADAPTERS", "false");
    vi.stubEnv("SEEDANCE_API_KEY", "test-key");
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "expired" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "unexpected" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: { video_url: "https://fixture.test/result.mp4" },
            duration: 5,
          }),
        ),
      );
    setProviderTransportForTests(send);
    expect((await adapter.poll("task")).status).toBe("failed");
    await expect(adapter.poll("task")).rejects.toThrow("unrecognized");
    expect(
      (await adapter.collect("task")).outputs[0]?.metadata?.durationSec,
    ).toBe(5);
  });
});
