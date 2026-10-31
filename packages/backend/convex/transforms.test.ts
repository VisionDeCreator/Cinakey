import { installAnalysisFixture } from "../../../apps/api/test/analysisFixture";
import { setTestProviders } from "../../../apps/api/test/setup";
import { expect, it, vi } from "vitest";
import { api } from "../../../apps/api/src/operations";
import { authIdentity, createFundedTestUser, makeTest } from "../test/helpers";
import { setProviderTransportForTests } from "../../../apps/api/src/providers/transport";

async function fixture() {
  installAnalysisFixture();
  const t = makeTest();
  const userId = await createFundedTestUser(t, "transform@test.com");
  const asUser = t.withIdentity(authIdentity(userId));
  await asUser.mutation(api.users.ensurePersonalWorkspace, {});
  const projectId = await asUser.mutation(api.projects.create, {
    title: "Transform test",
  });
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["fixture"])),
  );
  const sourceAssetId = await asUser.mutation(
    api.storage.createAssetFromUpload,
    {
      projectId,
      storageId,
      type: "video",
      name: "Walk",
      durationSec: 5.056,
      width: 1280,
      height: 720,
    },
  );
  const imageId = await asUser.mutation(api.storage.createAssetFromUpload, {
    projectId,
    storageId,
    type: "image",
    name: "Actor",
    width: 1024,
    height: 1024,
  });
  const args = {
    projectId,
    sourceAssetId,
    referenceAssetIds: [imageId],
    instruction: "Recast the actor",
    frames: [0.1, 2, 4].map((timeSec) => ({
      timeSec,
      dataUrl: "data:image/jpeg;base64,/9j/AA==",
    })),
  };
  return { t, asUser, args, imageId, userId };
}
it("saves a reviewed transformation snapshot and replays the request without a second USD reservation", async () => {
  const { t, asUser, args } = await fixture();
  const result = await asUser.action(api.transforms.analyze, args);
  expect(result.usdMicros).toBeGreaterThanOrEqual(0);
  const request = {
    projectId: args.projectId,
    sourceAssetId: args.sourceAssetId,
    referenceAssetIds: args.referenceAssetIds,
    resolution: "720p" as const,
    requestId: "transform-once",
    plan: {
      version: 1,
      mode: "recast",
      instruction: args.instruction,
      preserveCamera: true,
      preserveMotion: true,
      analysis: result.analysis,
      analysisModel: "deepseek-flash",
      sampledFrameTimes: [0.1, 2, 4],
    },
  };
  const first = await asUser.action(api.transforms.generate, request);
  const replay = await asUser.action(api.transforms.generate, request);
  expect(replay.jobId).toBe(first.jobId);
  expect(first.estimatedCostUsdMicros).toBe(720_000);
  const job = await t.run((ctx) => ctx.db.get(first.jobId));
  const snapshot = await t.run(async (ctx) =>
    JSON.parse(await (await ctx.storage.get(job!.inputsFileId!))!.text()),
  );
  expect(snapshot).toMatchObject({
    durationSec: 6,
    aspectRatio: "adaptive",
    parentAssetIds: [args.sourceAssetId],
    referenceVideoAssetId: args.sourceAssetId,
    transformation: request.plan,
  });
  expect(snapshot.referenceImageUrls).toHaveLength(1);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("generationJobs")
        .filter((q) => q.eq(q.field("kind"), "text-to-video"))
        .collect(),
    ),
  ).toHaveLength(1);
  await expect(
    asUser.action(api.transforms.generate, {
      ...request,
      plan: { ...request.plan, instruction: "Another change" },
    }),
  ).rejects.toThrow("different generation settings");
});
it("rejects unauthorized source access and malformed sampling before invoking a model or reserving usdMicros", async () => {
  const { t, asUser, args } = await fixture();
  await expect(
    asUser.action(api.transforms.analyze, {
      ...args,
      frames: args.frames.slice(0, 2),
    }),
  ).rejects.toThrow("3–8");
  await expect(
    asUser.action(api.transforms.analyze, {
      ...args,
      frames: args.frames.map((frame) => ({ ...frame, timeSec: 1 })),
    }),
  ).rejects.toThrow("Invalid sampled");
  const other = t.withIdentity(
    authIdentity(await createFundedTestUser(t, "other@test.com")),
  );
  await expect(other.action(api.transforms.analyze, args)).rejects.toThrow();
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("generationJobs")
        .filter((q) => q.eq(q.field("kind"), "text-to-video"))
        .collect(),
    ),
  ).toHaveLength(0);
});
it("uses Flash image blocks and refunds invalid model analysis", async () => {
  const { t, asUser, args } = await fixture();
  setTestProviders(false);
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture-key");
  const send = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        choices: [{ message: { content: "{}" } }],
        usage: {
          prompt_tokens: 500,
          completion_tokens: 500,
          prompt_cache_hit_tokens: 0,
          total_tokens: 1000,
        },
      }),
    ),
  );
  setProviderTransportForTests(send);
  await expect(asUser.action(api.transforms.analyze, args)).rejects.toThrow(
    "Video analysis failed",
  );
  const body = JSON.parse(send.mock.calls[0]![1].body);
  expect(body.model).toBe("deepseek-flash");
  expect(
    body.messages[1].content.filter(
      (part: { type: string }) => part.type === "image_url",
    ),
  ).toHaveLength(4);
  const jobs = await t.run((ctx) => ctx.db.query("generationJobs").collect());
  expect(jobs[0]).toMatchObject({
    status: "refunded",
    modelVersion: "deepseek-flash",
  });
});
it("enforces the project spend cap before paid analysis", async () => {
  const { t, asUser, args } = await fixture();
  await t.run((ctx) => ctx.db.patch(args.projectId, { spendCapUsdMicros: 1 }));
  setTestProviders(false);
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture-key");
  const send = vi.fn();
  setProviderTransportForTests(send);
  await expect(asUser.action(api.transforms.analyze, args)).rejects.toThrow(
    "spend cap",
  );
  expect(send).not.toHaveBeenCalled();
});

it("accepts combined transformations with Remix Lite image references", async () => {
  const { t, asUser, args } = await fixture();
  const { analysis } = await asUser.action(api.transforms.analyze, {
    ...args,
    referenceAssetIds: args.referenceAssetIds,
  });
  for (const [index, targets] of [
    [],
    ["recast", "environment", "wardrobe"],
  ].entries()) {
    const result = await asUser.action(api.transforms.generate, {
      projectId: args.projectId,
      sourceAssetId: args.sourceAssetId,
      referenceAssetIds: args.referenceAssetIds,
      resolution: "720p",
      requestId: `combined-${index}`,
      plan: {
        version: 1,
        targets,
        instruction: "Change the character, outfit, and setting as described.",
        preserveCamera: true,
        preserveMotion: true,
        analysis,
        analysisModel: "deepseek-flash",
        sampledFrameTimes: [0.1, 2, 4],
      },
    });
    const job = await t.run((ctx) => ctx.db.get(result.jobId));
    const snapshot = await t.run(async (ctx) =>
      JSON.parse(await (await ctx.storage.get(job!.inputsFileId!))!.text()),
    );
    expect(snapshot.transformation.targets).toEqual(targets);
    expect(snapshot.referenceAssetIds).toEqual(args.referenceAssetIds);
    expect(job!.prompt).toContain("apply all requested changes together");
    if (targets.length)
      expect(job!.prompt).toContain(
        "Optional focus areas: Characters, Environment, Clothing",
      );
    else
      expect(job!.prompt).toContain(
        "Infer what to change entirely from the user's prompt",
      );
  }
});

it("resolves prompt aliases in first-mention order and updates every occurrence when a binding is replaced", async () => {
  const { t, asUser, args, imageId } = await fixture();
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["scene"])),
  );
  const sceneId = await asUser.mutation(api.storage.createAssetFromUpload, {
    projectId: args.projectId,
    storageId,
    name: "Scene",
    type: "image",
    width: 1024,
    height: 1024,
  });
  await asUser.mutation(api.references.bind, {
    projectId: args.projectId,
    alias: "hero",
    assetId: imageId,
  });
  await asUser.mutation(api.references.bind, {
    projectId: args.projectId,
    alias: "scene",
    assetId: sceneId,
  });
  const instruction = "Use @scene behind @hero, then show @scene again.";
  const { analysis } = await asUser.action(api.transforms.analyze, {
    ...args,
    instruction,
    referenceAssetIds: [],
  });
  const request = {
    projectId: args.projectId,
    sourceAssetId: args.sourceAssetId,
    referenceAssetIds: [],
    resolution: "720p" as const,
    requestId: "alias-order",
    plan: {
      version: 1,
      targets: [],
      instruction,
      analysis,
      preserveCamera: true,
      preserveMotion: true,
      analysisModel: "deepseek-flash",
      sampledFrameTimes: [0.1, 2, 4],
    },
  };
  const result = await asUser.action(api.transforms.generate, request);
  const job = await t.run((ctx) => ctx.db.get(result.jobId));
  const snapshot = await t.run(async (ctx) =>
    JSON.parse(await (await ctx.storage.get(job!.inputsFileId!))!.text()),
  );
  expect(snapshot.referenceAssetIds).toEqual([sceneId, imageId]);
  expect(snapshot.transformation).toMatchObject({
    originalInstruction: instruction,
    instruction: "Use @image_1 behind @image_2, then show @image_1 again.",
  });
  await asUser.mutation(api.references.bind, {
    projectId: args.projectId,
    alias: "hero",
    assetId: sceneId,
  });
  const replaced = await asUser.action(api.transforms.generate, {
    ...request,
    requestId: "alias-replaced",
  });
  const replacedJob = await t.run((ctx) => ctx.db.get(replaced.jobId));
  const updated = await t.run(async (ctx) =>
    JSON.parse(
      await (await ctx.storage.get(replacedJob!.inputsFileId!))!.text(),
    ),
  );
  expect(updated.referenceAssetIds).toEqual([sceneId]);
  expect(updated.transformation.instruction).toBe(
    "Use @image_1 behind @image_1, then show @image_1 again.",
  );
});
it("blocks missing or ambiguous prompt references before either analysis or rendering reserves usdMicros", async () => {
  const { t, asUser, args } = await fixture();
  await expect(
    asUser.action(api.transforms.analyze, {
      ...args,
      instruction: "Use @missing",
    }),
  ).rejects.toThrow("missing or ambiguous");
  const { analysis } = await asUser.action(api.transforms.analyze, args);
  await expect(
    asUser.action(api.transforms.generate, {
      projectId: args.projectId,
      sourceAssetId: args.sourceAssetId,
      referenceAssetIds: [],
      resolution: "720p",
      requestId: "invalid-alias",
      plan: {
        version: 1,
        targets: [],
        instruction: "Use @missing",
        analysis,
        preserveCamera: true,
        preserveMotion: true,
        analysisModel: "deepseek-flash",
        sampledFrameTimes: [0.1, 2, 4],
      },
    }),
  ).rejects.toThrow("@missing");
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("generationJobs")
        .filter((q) => q.eq(q.field("kind"), "text-to-video"))
        .collect(),
    ),
  ).toHaveLength(0);
});

it("accepts the source video alias alongside an image without trying to bind video_1 to an image", async () => {
  const { t, asUser, args, imageId } = await fixture();
  await asUser.mutation(api.references.bind, {
    projectId: args.projectId,
    alias: "image_1",
    assetId: imageId,
  });
  const instruction = "Use @image_1 in @video_1, keeping @video_1 motion.";
  const { analysis } = await asUser.action(api.transforms.analyze, {
    ...args,
    instruction,
  });
  const result = await asUser.action(api.transforms.generate, {
    projectId: args.projectId,
    sourceAssetId: args.sourceAssetId,
    referenceAssetIds: [imageId],
    resolution: "720p",
    requestId: "source-video-alias",
    plan: {
      version: 1,
      instruction,
      targets: [],
      analysis,
      preserveCamera: true,
      preserveMotion: true,
      analysisModel: "deepseek-flash",
      sampledFrameTimes: [0.1, 2, 4],
    },
  });
  const job = await t.run((ctx) => ctx.db.get(result.jobId));
  const snapshot = await t.run(async (ctx) =>
    JSON.parse(await (await ctx.storage.get(job!.inputsFileId!))!.text()),
  );
  expect(snapshot.referenceVideoAssetId).toBe(args.sourceAssetId);
  expect(snapshot.referenceAssetIds).toEqual([imageId]);
  expect(snapshot.transformation.instruction).toBe(instruction);
  await expect(
    asUser.mutation(api.references.bind, {
      projectId: args.projectId,
      alias: "video_1",
      assetId: imageId,
    }),
  ).rejects.toThrow("reference name must match the media type");
});

it("rejects Remix Lite renders without images or with sources longer than 15 seconds before reserving usdMicros", async () => {
  const { t, asUser, args } = await fixture();
  const { analysis } = await asUser.action(api.transforms.analyze, args);
  const request = {
    projectId: args.projectId,
    sourceAssetId: args.sourceAssetId,
    referenceAssetIds: [],
    resolution: "720p" as const,
    requestId: "invalid-remix",
    plan: {
      version: 1,
      targets: [],
      instruction: "Recast the actor",
      preserveCamera: true,
      preserveMotion: true,
      analysis,
      analysisModel: "deepseek-flash",
      sampledFrameTimes: [0.1, 2, 4],
    },
  };
  await expect(asUser.action(api.transforms.generate, request)).rejects.toThrow(
    "1–8",
  );
  await t.run((ctx) =>
    ctx.db.patch(args.sourceAssetId, { durationSec: 15.01 }),
  );
  await expect(
    asUser.action(api.transforms.generate, {
      ...request,
      referenceAssetIds: args.referenceAssetIds,
    }),
  ).rejects.toThrow("4–15");
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("generationJobs")
        .filter((q) => q.eq(q.field("kind"), "text-to-video"))
        .collect(),
    ),
  ).toHaveLength(0);
});
