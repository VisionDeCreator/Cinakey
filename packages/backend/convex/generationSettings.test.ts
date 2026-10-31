import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../../apps/api/src/operations";
import { setTestProviders } from "../../../apps/api/test/setup";
import {
  authIdentity,
  createFundedTestUser,
  fundTestWorkspace,
  makeTest,
} from "../test/helpers";

afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const t = makeTest();
  const userId = await createFundedTestUser(t, "preferences@test.com");
  const user = t.withIdentity(authIdentity(userId));
  const projectId = await user.mutation(api.projects.create, {
    title: "Portrait film",
    aspectRatio: "9:16",
  });
  return { t, user, userId, projectId };
}
it("defaults legacy projects to 720p and keeps generation ratio independent of the timeline canvas", async () => {
  const { user, projectId } = await fixture();
  expect(
    await user.query(api.projects.generationSettings, { projectId }),
  ).toMatchObject({
    resolution: "720p",
    durationSec: 5,
    aspectRatio: "9:16",
    useStaging: false,
  });
  expect(
    (await user.query(api.projects.get, { projectId }))?.generationSettings,
  ).toBeUndefined();
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    resolution: "1080p",
    durationSec: 12,
    aspectRatio: "1:1",
  });
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    resolution: "720p",
  });
  expect(
    await user.query(api.projects.generationSettings, { projectId }),
  ).toMatchObject({ resolution: "720p", durationSec: 12, aspectRatio: "1:1" });
  expect((await user.query(api.projects.get, { projectId }))?.aspectRatio).toBe(
    "9:16",
  );
});
it("rejects unsupported preferences and unauthorized writes", async () => {
  const { t, user, projectId } = await fixture();
  for (const durationSec of [3, 31, 4.5])
    await expect(
      user.mutation(api.projects.saveGenerationSettings, {
        projectId,
        durationSec,
      }),
    ).rejects.toThrow("4 to 30");
  await expect(
    user.mutation(api.projects.saveGenerationSettings, {
      projectId,
      resolution: "4k" as never,
    }),
  ).rejects.toThrow();
  await expect(
    user.mutation(api.projects.saveGenerationSettings, {
      projectId,
      aspectRatio: "4:3" as never,
    }),
  ).rejects.toThrow();
  await expect(
    user.mutation(api.projects.saveGenerationSettings, {
      projectId,
      useStaging: true,
    }),
  ).rejects.toThrow("Choose a staging");
  const strangerId = await createFundedTestUser(
    t,
    "stranger-preferences@test.com",
  );
  const stranger = t.withIdentity(authIdentity(strangerId));
  await expect(
    stranger.mutation(api.projects.saveGenerationSettings, {
      projectId,
      resolution: "1080p",
    }),
  ).rejects.toThrow("access denied");
});
it("validates staging ownership and only enables rendered staging", async () => {
  const { t, user, projectId } = await fixture();
  await user.action(api.workspace.ensure, { projectId });
  const document = await user.action(api.workspace.loadStaging, { projectId });
  const staging = await user.action(api.workspace.saveStaging, {
    projectId,
    document: document.document,
  });
  await expect(
    user.mutation(api.projects.saveGenerationSettings, {
      projectId,
      stagingId: staging.id,
      useStaging: true,
    }),
  ).rejects.toThrow("previsualization");
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    stagingId: staging.id,
    useStaging: false,
  });
  const otherId = await user.mutation(api.projects.create, { title: "Other" });
  await expect(
    user.mutation(api.projects.saveGenerationSettings, {
      projectId: otherId,
      stagingId: staging.id,
    }),
  ).rejects.toThrow("not available");
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    stagingId: null,
  });
  expect(
    (await user.query(api.projects.generationSettings, { projectId }))
      .stagingId,
  ).toBeUndefined();
  expect(await t.run((ctx) => ctx.db.get(staging.id))).not.toBeNull();
});
it("freezes selected resolution, duration and ratio on the job even when saved preferences change", async () => {
  setTestProviders(true);
  const { t, user, projectId } = await fixture();
  await user.action(api.workspace.ensure, { projectId });
  const script = await user.action(api.workspace.script, { projectId });
  await user.mutation(api.workspace.saveScript, {
    projectId,
    expectedId: script.id,
    text: "A sailboat crosses the lake.",
  });
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    resolution: "1080p",
    aspectRatio: "1:1",
    durationSec: 8,
  });
  const job = await user.action(api.workspace.generate, {
    projectId,
    resolution: "720p",
    aspectRatio: "9:16",
    durationSec: 6,
    requestId: "settings-snapshot",
  });
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    aspectRatio: "16:9",
    durationSec: 20,
  });
  await t.run(async (ctx) => {
    const row = await ctx.db.get(job.jobId);
    const input = JSON.parse(
      await (await ctx.storage.get(row!.inputsFileId!))!.text(),
    );
    expect(input).toMatchObject({
      resolution: "720p",
      aspectRatio: "9:16",
      durationSec: 6,
    });
  });
});

it("keeps settings and revisions independent per segment and snapshots project defaults only once", async () => {
  const { user, projectId } = await fixture();
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    resolution: "1080p",
    aspectRatio: "1:1",
    durationSec: 12,
  });
  const second = await user.mutation(api.workspace.createSegment, {
    projectId,
  });
  const first = (await user.query(api.workspace.list, { projectId }))
    .segments[0]!._id;
  expect(
    await user.query(api.projects.generationSettings, {
      projectId,
      segmentId: second,
    }),
  ).toMatchObject({
    resolution: "1080p",
    aspectRatio: "1:1",
    durationSec: 12,
    revision: 1,
  });
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    segmentId: first,
    resolution: "720p",
    durationSec: 18,
  });
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    segmentId: first,
    aspectRatio: "9:16",
  });
  expect(
    await user.query(api.projects.generationSettings, {
      projectId,
      segmentId: first,
    }),
  ).toMatchObject({
    resolution: "720p",
    aspectRatio: "9:16",
    durationSec: 18,
    revision: 3,
  });
  expect(
    await user.query(api.projects.generationSettings, {
      projectId,
      segmentId: second,
    }),
  ).toMatchObject({
    resolution: "1080p",
    aspectRatio: "1:1",
    durationSec: 12,
    revision: 1,
  });
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    resolution: "720p",
    durationSec: 6,
  });
  await user.action(api.workspace.ensure, { projectId });
  expect(
    await user.query(api.projects.generationSettings, {
      projectId,
      segmentId: second,
    }),
  ).toMatchObject({ resolution: "1080p", durationSec: 12 });
  const third = await user.mutation(api.workspace.createSegment, { projectId });
  expect(
    await user.query(api.projects.generationSettings, {
      projectId,
      segmentId: third,
    }),
  ).toMatchObject({ resolution: "720p", durationSec: 6, useStaging: false });
  const segments = (await user.query(api.workspace.list, { projectId }))
    .segments;
  expect(segments.find((segment) => segment._id === first)?.durationSec).toBe(
    18,
  );
});

it("migrates segment duration and only the owning segment's selected staging, idempotently", async () => {
  const { t, user, projectId } = await fixture();
  const second = await user.mutation(api.workspace.createSegment, {
    projectId,
  });
  const first = (await user.query(api.workspace.list, { projectId }))
    .segments[0]!._id;
  const { document } = await user.action(api.workspace.loadStaging, {
    projectId,
    newDocument: true,
  });
  const staging = await user.action(api.workspace.saveStaging, {
    projectId,
    segmentId: second,
    document,
  });
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    stagingId: staging.id,
    useStaging: false,
    resolution: "1080p",
    durationSec: 8,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(first, {
      generationSettings: undefined,
      settingsRevision: undefined,
      durationSec: 25,
    });
    await ctx.db.patch(second, {
      generationSettings: undefined,
      settingsRevision: undefined,
      durationSec: 15,
    });
  });
  await user.action(api.workspace.ensure, { projectId });
  const opening = await user.query(api.projects.generationSettings, {
    projectId,
    segmentId: first,
  });
  expect(opening).toMatchObject({
    durationSec: 25,
    resolution: "1080p",
    useStaging: false,
  });
  expect(opening.stagingId).toBeUndefined();
  expect(
    await user.query(api.projects.generationSettings, {
      projectId,
      segmentId: second,
    }),
  ).toMatchObject({ durationSec: 15, stagingId: staging.id });
  await user.action(api.workspace.ensure, { projectId });
  expect(
    await user.query(api.projects.generationSettings, {
      projectId,
      segmentId: first,
    }),
  ).toEqual(opening);
  await expect(
    user.mutation(api.projects.saveGenerationSettings, {
      projectId,
      segmentId: first,
      stagingId: staging.id,
    }),
  ).rejects.toThrow("not available");
});

it("rejects cross-project and archived segment settings and unauthorized writes", async () => {
  const { t, user, projectId } = await fixture();
  const segmentId = await user.mutation(api.workspace.createSegment, {
    projectId,
  });
  const otherProject = await user.mutation(api.projects.create, {
    title: "Other",
  });
  await expect(
    user.query(api.projects.generationSettings, {
      projectId: otherProject,
      segmentId,
    }),
  ).rejects.toThrow("not found");
  await expect(
    user.mutation(api.projects.saveGenerationSettings, {
      projectId: otherProject,
      segmentId,
      durationSec: 10,
    }),
  ).rejects.toThrow("not found");
  const strangerId = await createFundedTestUser(t, "segment-stranger@test.com");
  await expect(
    t
      .withIdentity(authIdentity(strangerId))
      .mutation(api.projects.saveGenerationSettings, {
        projectId,
        segmentId,
        durationSec: 10,
      }),
  ).rejects.toThrow("access denied");
  await expect(
    user.mutation(api.projects.saveGenerationSettings, {
      projectId,
      segmentId,
      durationSec: 31,
    }),
  ).rejects.toThrow("4 to 30");
  await user.mutation(api.workspace.updateSegment, {
    projectId,
    segmentId,
    archive: true,
  });
  await expect(
    user.query(api.projects.generationSettings, { projectId, segmentId }),
  ).rejects.toThrow("not found");
  await expect(
    user.mutation(api.projects.saveGenerationSettings, {
      projectId,
      segmentId,
      resolution: "1080p",
    }),
  ).rejects.toThrow("not found");
});

it("freezes the segment's actual generation settings on the job when preferences later change", async () => {
  setTestProviders(true);
  const { t, user, userId, projectId } = await fixture();
  await fundTestWorkspace(t, userId, 50_000_000);
  const segmentId = await user.mutation(api.workspace.createSegment, {
    projectId,
  });
  const script = await user.action(api.workspace.script, {
    projectId,
    segmentId,
  });
  const scriptVersionId = await user.mutation(api.workspace.saveScript, {
    projectId,
    segmentId,
    expectedId: script.id,
    text: "A sunrise over the ocean",
  });
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    segmentId,
    resolution: "1080p",
    aspectRatio: "1:1",
    durationSec: 10,
  });
  const { document } = await user.action(api.workspace.loadStaging, {
    projectId,
    newDocument: true,
  });
  const selectedStaging = await user.action(api.workspace.saveStaging, {
    projectId,
    segmentId,
    document,
  });
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    segmentId,
    stagingId: selectedStaging.id,
    useStaging: false,
  });
  const settingsSnapshot = {
    durationSec: 10,
    resolution: "1080p" as const,
    aspectRatio: "1:1" as const,
    stagingId: selectedStaging.id,
    useStaging: false,
  };
  await expect(
    user.action(api.workspace.generate, {
      projectId,
      segmentId,
      scriptVersionId,
      durationSec: 10,
      resolution: "720p",
      settingsSnapshot,
    }),
  ).rejects.toThrow("do not match");
  const job = await user.action(api.workspace.generate, {
    projectId,
    segmentId,
    scriptVersionId,
    settingsSnapshot,
    durationSec: 10,
    resolution: "1080p",
  });
  await user.mutation(api.projects.saveGenerationSettings, {
    projectId,
    segmentId,
    resolution: "720p",
    durationSec: 20,
    aspectRatio: "9:16",
  });
  await t.run(async (ctx) => {
    const row = await ctx.db.get(job.jobId);
    const input = JSON.parse(
      await (await ctx.storage.get(row!.inputsFileId!))!.text(),
    );
    expect(input.generationSettings).toEqual({
      resolution: "1080p",
      aspectRatio: "1:1",
      durationSec: 10,
      stagingId: selectedStaging.id,
      useStaging: false,
    });
    expect(input.scriptVersionId).toBe(scriptVersionId);
    expect(row?.segmentId).toBe(segmentId);
  });
});
