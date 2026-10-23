import { internal as databaseInternal } from "./_generated/api";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";

async function fixture() {
  const t = makeTest();
  const userId = await createTestUser(t, "focus@test.com");
  const asUser = t.withIdentity(authIdentity(userId));
  const workspaceId = await asUser.mutation(
    api.users.ensurePersonalWorkspace,
    {},
  );
  const projectId = await asUser.mutation(api.projects.create, {
    title: "Existing film",
  });
  async function image(name: string) {
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob([name], { type: "image/png" })),
    );
    return asUser.mutation(api.storage.createAssetFromUpload, {
      projectId,
      storageId,
      type: "image",
      name,
    });
  }
  return { t, asUser, userId, workspaceId, projectId, image };
}

describe("video-focused production", () => {
  it("rejects removed generation operations before reserving credits or creating jobs", async () => {
    const { t, asUser, projectId } = await fixture();
    const before = await asUser.query(api.credits.getBalance, {});
    for (const [adapterId, kind] of [
      ["gpt-image-2", "text-to-image"],
      ["gpt-image-2", "image-edit"],
      ["seedance-2.5", "text-to-image"],
      ["deepseek", "chat"],
    ]) {
      await expect(
        asUser.action(api.generation.startGeneration, {
          projectId,
          adapterId: adapterId!,
          kind: kind!,
          prompt: "test",
        }),
      ).rejects.toThrow("Only video generation");
    }
    expect(await asUser.query(api.credits.getBalance, {})).toEqual(before);
    expect(
      await t.run((ctx) => ctx.db.query("generationJobs").collect()),
    ).toHaveLength(0);
    expect(
      (await asUser.query(api.generation.listCapabilities, {})).map(
        (c) => c.kind,
      ),
    ).toEqual(["video"]);
  });

  it("preserves image files when references are assigned, replaced and cleared", async () => {
    const { t, asUser, projectId, image } = await fixture();
    const entityId = await asUser.mutation(api.entities.create, {
      projectId,
      kind: "location",
      name: "Cafe",
    });
    const first = await image("historical.png"),
      second = await image("uploaded.png");
    await asUser.action(api.entities.lockReference, {
      entityId,
      assetId: first,
      referenceSheet: true,
    });
    await asUser.action(api.entities.lockReference, {
      entityId,
      assetId: second,
      referenceSheet: true,
    });
    expect(
      (await asUser.action(api.entities.getWithSheet, { entityId }))?.sheet
        .referenceSheetAssetId,
    ).toBe(second);
    expect(
      (await asUser.query(api.entities.get, { entityId }))
        ?.lockedReferenceAssetIds[0],
    ).toBe(second);
    await asUser.action(api.entities.unlockReference, {
      entityId,
      referenceSheet: true,
    });
    expect(
      (await asUser.query(api.entities.get, { entityId }))
        ?.lockedReferenceAssetIds,
    ).toEqual([]);
    for (const assetId of [first, second])
      expect(
        await asUser.query(api.storage.getAssetUrl, { assetId }),
      ).toBeTruthy();
    expect(
      await t.run((ctx) => ctx.db.query("generationJobs").collect()),
    ).toHaveLength(0);
    expect((await asUser.query(api.projects.get, { projectId }))?.title).toBe(
      "Existing film",
    );
  });

  it("passes uploaded images to video generation in order with the selected starting frame", async () => {
    const { t, asUser, projectId, image } = await fixture();
    const first = await image("first.png"),
      second = await image("second.png");
    const { jobId } = await asUser.action(api.generation.startGeneration, {
      projectId,
      adapterId: "seedance-2.5",
      kind: "image-to-video",
      prompt: "Camera pans across the cafe",
      referenceAssetIds: [second, first],
      startFrameAssetId: first,
      input: { mockDelayMs: 0 },
    });
    const job = await asUser.query(api.generation.getJob, { jobId });
    const input = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(job!.inputsFileId!);
      return JSON.parse(await blob!.text());
    });
    expect(input.referenceImageUrls).toEqual(
      await Promise.all(
        [second, first].map((assetId) =>
          asUser.query(api.storage.getAssetUrl, { assetId }),
        ),
      ),
    );
    expect(input.startFrameUrl).toBe(
      await asUser.query(api.storage.getAssetUrl, { assetId: first }),
    );
    await t.finishAllScheduledFunctions(() => {});
    expect((await asUser.query(api.generation.getJob, { jobId }))?.status).toBe(
      "succeeded",
    );
  });

  it("refunds unsubmitted legacy image jobs once without calling a provider", async () => {
    const { t, asUser, projectId, workspaceId, userId } = await fixture();
    const before = (await asUser.query(api.credits.getBalance, {})).balance;
    const jobId = await t.mutation(internal.generation.createQueuedJob, {
      projectId,
      workspaceId,
      model: "gpt-image-2",
      modelVersion: "legacy",
      kind: "text-to-image",
      prompt: "legacy",
      estimatedCostCredits: 10,
      createdBy: userId,
    });
    // Simulate a pre-migration job with no input file and a missing dispatch.
    await t.run(async (ctx) => {
      for (const task of await ctx.db.query("apiTasks").collect())
        await ctx.db.delete(task._id);
    });
    await t.mutation(databaseInternal.tasks.reconcileGeneration, {
      status: "queued",
      cursor: null,
    });
    expect(
      await t.run((ctx) => ctx.db.query("apiTasks").collect()),
    ).toHaveLength(1);
    await t.action(internal.generation.submitAndTrack, { jobId });
    await t.action(internal.generation.submitAndTrack, { jobId });
    expect((await asUser.query(api.generation.getJob, { jobId }))?.status).toBe(
      "refunded",
    );
    expect((await asUser.query(api.credits.getBalance, {})).balance).toBe(
      before,
    );
  });

  it("parks ambiguous legacy image jobs while preserving their reserved credits", async () => {
    const { t, asUser, projectId, workspaceId, userId } = await fixture();
    const jobId = await t.mutation(internal.generation.createQueuedJob, {
      projectId,
      workspaceId,
      model: "gpt-image-2",
      modelVersion: "legacy",
      kind: "text-to-image",
      prompt: "legacy",
      estimatedCostCredits: 10,
      createdBy: userId,
    });
    const reserved = (await asUser.query(api.credits.getBalance, {})).balance;
    await t.run((ctx) =>
      ctx.db.patch(jobId, {
        status: "submitted",
        providerJobId: "legacy-paid-job",
        submissionState: "accepted",
      }),
    );
    await expect(
      t.action(internal.generation.pollJob, { jobId, pollAttempt: 0 }),
    ).rejects.toThrow();
    expect(
      (await asUser.query(api.generation.getJob, { jobId }))?.submissionState,
    ).toBe("uncertain");
    expect((await asUser.query(api.credits.getBalance, {})).balance).toBe(
      reserved,
    );
  });

  it("recovers a persisted historical image result without resubmitting it", async () => {
    const { t, asUser, projectId, workspaceId, userId } = await fixture();
    const jobId = await t.mutation(internal.generation.createQueuedJob, {
      projectId,
      workspaceId,
      model: "gpt-image-2",
      modelVersion: "legacy",
      kind: "text-to-image",
      prompt: "legacy",
      estimatedCostCredits: 10,
      createdBy: userId,
    });
    const providerResultFileId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob(
          [
            JSON.stringify({
              outputs: [
                {
                  type: "image",
                  base64: btoa("historical image"),
                  contentType: "image/png",
                },
              ],
            }),
          ],
          { type: "application/json" },
        ),
      ),
    );
    await t.run((ctx) =>
      ctx.db.patch(jobId, {
        status: "submitted",
        providerJobId: "legacy",
        submissionState: "accepted",
        providerResultFileId,
        providerActualUnits: 1,
      }),
    );
    await t.action(internal.generation.pollJob, { jobId, pollAttempt: 0 });
    const job = await asUser.query(api.generation.getJob, { jobId });
    expect(job?.status).toBe("succeeded");
    expect(job?.outputAssetIds).toHaveLength(1);
    expect(
      await asUser.query(api.storage.getAssetUrl, {
        assetId: job!.outputAssetIds[0]!,
      }),
    ).toBeTruthy();
  });
});
