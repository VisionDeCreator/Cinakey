import { expect, it } from "vitest";
import { FEATURES } from "@dirrio/shared";
import { api } from "../../../apps/api/src/operations";
import { authIdentity, createFundedTestUser, makeTest } from "../test/helpers";

it("hides Remix capabilities and rejects direct requests before creating work or charges", async () => {
  expect(FEATURES.remix).toBe(false);
  const t = makeTest();
  const userId = await createFundedTestUser(t, "remix-disabled@test.com");
  const user = t.withIdentity(authIdentity(userId));
  const projectId = await user.mutation(api.projects.create, {
    title: "Video",
  });
  const capabilities = await user.query(api.generation.listCapabilities, {});
  expect(capabilities.some((c) => c.id === "sume-remix-lite")).toBe(false);
  expect(capabilities.some((c) => c.id === "seedance-2.5")).toBe(true);
  await expect(
    user.mutation(api.genjutsu.create, { title: "Blocked" }),
  ).rejects.toThrow("Remix is temporarily unavailable.");
  await expect(
    user.action(api.generation.startGeneration, {
      projectId,
      adapterId: "sume-remix-lite",
      kind: "image-to-video",
      prompt: "Swap actor",
    }),
  ).rejects.toThrow("Remix is temporarily unavailable.");
  await expect(
    user.mutation(api.generation.quote, {
      projectId,
      adapterId: "sume-remix-lite",
      kind: "image-to-video",
      durationSec: 5,
      resolution: "720p",
    }),
  ).rejects.toThrow("Remix is temporarily unavailable.");
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["fixture"])),
  );
  const sourceAssetId = await user.mutation(api.storage.createAssetFromUpload, {
    projectId,
    storageId,
    type: "video",
    name: "Source",
    durationSec: 5,
  });
  await expect(
    user.action(api.transforms.analyze, {
      projectId,
      sourceAssetId,
      referenceAssetIds: [],
      instruction: "Swap actor",
      frames: [],
    }),
  ).rejects.toThrow("Remix is temporarily unavailable.");
  await expect(
    user.action(api.transforms.generate, {
      projectId,
      sourceAssetId,
      referenceAssetIds: [],
      plan: {},
      resolution: "720p",
      requestId: "disabled",
    }),
  ).rejects.toThrow("Remix is temporarily unavailable.");
  await t.run(async (ctx) => {
    expect(await ctx.db.query("genjutsuSessions").collect()).toEqual([]);
    expect(await ctx.db.query("generationJobs").collect()).toEqual([]);
    expect(await ctx.db.query("usageQuotes").collect()).toEqual([]);
  });
});
