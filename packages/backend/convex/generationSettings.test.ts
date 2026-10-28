import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../../apps/api/src/operations";
import { setTestProviders } from "../../../apps/api/test/setup";
import { authIdentity, createFundedTestUser, makeTest } from "../test/helpers";

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
