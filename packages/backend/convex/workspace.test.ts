import { setTestProviders } from "../../../apps/api/test/setup";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../../apps/api/src/operations";

import { authIdentity, createFundedTestUser, makeTest } from "../test/helpers";
afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const t = makeTest();
  const userId = await createFundedTestUser(t, "workspace@test.com");
  const user = t.withIdentity(authIdentity(userId));
  const projectId = await user.mutation(api.projects.create, {
    title: "Existing film",
  });
  return { t, user, userId, projectId };
}
it("saves empty or arbitrary plain text without materializing a production hierarchy and rejects stale writes", async () => {
  const { user, projectId } = await fixture();
  await user.action(api.workspace.ensure, { projectId });
  const tip = await user.action(api.workspace.script, { projectId });
  const next = await user.mutation(api.workspace.saveScript, {
    projectId,
    expectedId: tip.id,
    text: "An ordinary paragraph, not a structured prompt.",
  });
  await expect(
    user.mutation(api.workspace.saveScript, {
      projectId,
      expectedId: tip.id,
      text: "Stale window",
    }),
  ).rejects.toThrow("another window");
  await user.mutation(api.workspace.saveScript, {
    projectId,
    expectedId: next,
    text: "",
  });
  expect((await user.action(api.workspace.script, { projectId })).text).toBe(
    "",
  );
});
it("creates and saves project staging without a script hierarchy and protects it from conflicting writes", async () => {
  const { user, projectId } = await fixture();
  await user.action(api.workspace.ensure, { projectId });
  const empty = await user.action(api.workspace.loadStaging, { projectId });
  const saved = await user.action(api.workspace.saveStaging, {
    projectId,
    document: empty.document,
  });
  const loaded = await user.action(api.workspace.loadStaging, {
    projectId,
    id: saved.id,
  });
  loaded.document.name = "Edited camera";
  await user.action(api.workspace.saveStaging, {
    projectId,
    id: saved.id,
    document: loaded.document,
    expectedFileId: saved.fileId,
  });
  await expect(
    user.action(api.workspace.saveStaging, {
      projectId,
      id: saved.id,
      document: loaded.document,
      expectedFileId: saved.fileId,
    }),
  ).rejects.toThrow("another window");
});
it("does not expose another user's documents", async () => {
  const { t, user, projectId } = await fixture();
  await user.action(api.workspace.ensure, { projectId });
  const stranger = await createFundedTestUser(t, "stranger@test.com");
  await expect(
    t
      .withIdentity(authIdentity(stranger))
      .action(api.workspace.script, { projectId }),
  ).rejects.toThrow();
});
it("freezes named aliases to assets while saving plain text", async () => {
  const { t, user, userId, projectId } = await fixture();
  await user.action(api.workspace.ensure, { projectId });
  const assetId = await t.run(async (ctx) =>
    ctx.db.insert("assets", {
      projectId,
      type: "image",
      name: "James",
      searchText: "James",
      storageId: await ctx.storage.store(new Blob(["image"])),
      format: "image/png",
      sizeBytes: 5,
      tags: [],
      starred: false,
      createdBy: userId,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const script = await user.action(api.workspace.script, { projectId });
  await user.mutation(api.workspace.saveScript, {
    projectId,
    text: "@james walks.",
    expectedId: script.id,
  });
  await user.mutation(api.assets.update, { assetId, name: "Renamed" });
  expect(await user.query(api.references.list, { projectId })).toContainEqual({
    alias: "james",
    assetId,
  });
});
it("recompiles a saved staging plan from plain text with no production records or USD charge", async () => {
  const { t, user, projectId } = await fixture();
  await user.action(api.workspace.ensure, { projectId });
  const script = await user.action(api.workspace.script, { projectId });
  await user.mutation(api.workspace.saveScript, {
    projectId,
    expectedId: script.id,
    text: "A person walks, then stops. Plain prose.",
  });
  const initial = await user.action(api.workspace.loadStaging, { projectId });
  const saved = await user.action(api.workspace.saveStaging, {
    projectId,
    document: initial.document,
  });
  await t.run(async (ctx) => {
    const plan = {
      schema: "cinakey.staging/1.0",
      set: { terrain: "open", timeOfDay: "day", features: [] },
      cast: [
        {
          id: "hero",
          name: "Hero",
          kind: "person",
          imageN: 1,
          at: [0, 0],
          facing: 90,
        },
      ],
      shots: [
        {
          n: 1,
          moves: [{ who: "hero", action: "walk", path: [[2, 0]] }],
          camera: {
            size: "wide",
            angle: "eye",
            side: "front",
            move: "static",
            subject: "hero",
          },
        },
        {
          n: 2,
          moves: [{ who: "hero", action: "stand" }],
          camera: {
            size: "wide",
            angle: "eye",
            side: "front",
            move: "static",
            subject: "hero",
          },
        },
      ],
    };
    const fileId = await ctx.storage.store(
      new Blob([JSON.stringify(plan)], { type: "application/json" }),
    );
    await ctx.db.patch(saved.id, { planFileId: fileId });
  });
  const regenerated = await user.action(api.workspace.generateStaging, {
    projectId,
    id: saved.id,
    durationSec: 12,
    reuse: true,
  });
  expect(regenerated.usdMicros).toBe(0);
  const loaded = await user.action(api.workspace.loadStaging, {
    projectId,
    id: saved.id,
  });
  expect(loaded.document.frames).toBe(288);
  expect(loaded.document.shots).toHaveLength(2);
  expect(loaded.document.sequenceId).toBeUndefined();
  const history = await user.action(api.workspace.stagingHistory, {
    id: saved.id,
  });
  expect(history).toHaveLength(2);
  await user.action(api.workspace.restoreStaging, {
    id: saved.id,
    fileId: saved.fileId,
  });
  expect(
    await user.action(api.workspace.stagingHistory, { id: saved.id }),
  ).toHaveLength(3);
});
it("queues generation from text and reference assets with a frozen input snapshot and no production identifiers", async () => {
  setTestProviders(true);
  const { t, user, projectId } = await fixture();
  await user.action(api.workspace.ensure, { projectId });
  const script = await user.action(api.workspace.script, { projectId });
  const version = await user.mutation(api.workspace.saveScript, {
    projectId,
    expectedId: script.id,
    text: "A sailboat moves across a quiet lake.",
  });
  const started = await user.action(api.workspace.generate, {
    projectId,
    durationSec: 5,
    resolution: "720p",
    requestId: "plain-workspace-test",
  });
  await t.run(async (ctx) => {
    const job = await ctx.db.get(started.jobId);
    expect(job).not.toHaveProperty("shotId");
    expect(job).not.toHaveProperty("sequenceId");
    const inputs = JSON.parse(
      await (await ctx.storage.get(job!.inputsFileId!))!.text(),
    );
    expect(inputs.prompt).toBe("A sailboat moves across a quiet lake.");
    expect(inputs.scriptVersionId).toBe(version);
  });
});

it("rejects undersized image references before charging usdMicros or queuing a job", async () => {
  setTestProviders(true);
  const { t, user, userId, projectId } = await fixture();
  await user.action(api.workspace.ensure, { projectId });
  await t.run(async (ctx) =>
    ctx.db.insert("assets", {
      projectId,
      name: "tiny",
      searchText: "tiny",
      type: "image",
      width: 160,
      height: 160,
      storageId: await ctx.storage.store(new Blob(["image"])),
      format: "image/png",
      sizeBytes: 5,
      tags: [],
      starred: false,
      createdBy: userId,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const script = await user.action(api.workspace.script, { projectId });
  await user.mutation(api.workspace.saveScript, {
    projectId,
    expectedId: script.id,
    text: "A boat in the colour of @tiny.",
  });
  const before = await user.query(api.billing.getBalance, {});
  await expect(
    user.action(api.workspace.generate, {
      projectId,
      durationSec: 5,
      resolution: "720p",
      requestId: "invalid-reference",
    }),
  ).rejects.toThrow("300–6000");
  expect(await user.query(api.billing.getBalance, {})).toEqual(before);
  expect(
    await t.run((ctx) => ctx.db.query("generationJobs").collect()),
  ).toHaveLength(0);
});

it("renames all whole mentions atomically, preserves history, and rejects alias collisions and stale scripts", async () => {
  const { t, user, userId, projectId } = await fixture();
  await user.action(api.workspace.ensure, { projectId });
  const assetId = await t.run(async (ctx) =>
    ctx.db.insert("assets", {
      projectId,
      type: "image",
      name: "James",
      searchText: "James",
      storageId: await ctx.storage.store(new Blob(["image"])),
      format: "image/png",
      sizeBytes: 5,
      tags: [],
      starred: false,
      createdBy: userId,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const initial = await user.action(api.workspace.script, { projectId });
  const tip = await user.mutation(api.workspace.saveScript, {
    projectId,
    expectedId: initial.id,
    text: "@James meets @james. @james_2 stays. mail@james.com",
  });
  await user.mutation(api.references.bind, {
    projectId,
    alias: "other",
    assetId,
  });
  await expect(
    user.mutation(api.references.rename, {
      projectId,
      alias: "james",
      newAlias: "other",
      expectedId: tip,
    }),
  ).rejects.toThrow("already in use");
  const result = await user.mutation(api.references.rename, {
    projectId,
    alias: "james",
    newAlias: "young_james",
    expectedId: tip,
  });
  expect(result.text).toBe(
    "@young_james meets @young_james. @james_2 stays. mail@james.com",
  );
  expect(await user.query(api.references.list, { projectId })).toContainEqual({
    alias: "young_james",
    assetId,
  });
  expect(
    (await user.action(api.workspace.script, { projectId, id: tip })).text,
  ).toContain("@James");
  await expect(
    user.mutation(api.references.rename, {
      projectId,
      alias: "young_james",
      newAlias: "again",
      expectedId: tip,
    }),
  ).rejects.toThrow("another window");
});

it("converts mixed baked-in image mentions to an unused video alias and can undo exact formatting", async () => {
  const { t, user, userId, projectId } = await fixture();
  await user.action(api.workspace.ensure, { projectId });
  const ids = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["media"]));
    const common = {
      projectId,
      storageId,
      searchText: "media",
      sizeBytes: 5,
      tags: [],
      starred: false,
      createdBy: userId,
      createdAt: 1,
      updatedAt: 1,
    };
    return {
      image: await ctx.db.insert("assets", {
        ...common,
        type: "image",
        name: "Character",
        format: "image/png",
      }),
      video: await ctx.db.insert("assets", {
        ...common,
        type: "video",
        name: "Character motion",
        format: "video/mp4",
      }),
    };
  });
  const initial = await user.action(api.workspace.script, { projectId });
  const text =
    "REFERENCES\n@[Image 1](image_1) = character. @IMAGE_1 moves. @[IMAGE 2](IMAGE_2) is unchanged. @video_1 already exists.";
  const tip = await user.mutation(api.workspace.saveScript, {
    projectId,
    expectedId: initial.id,
    text,
  });
  await user.mutation(api.references.bind, {
    projectId,
    alias: "image_1",
    assetId: ids.image,
  });
  const replacement = await user.mutation(api.references.replace, {
    projectId,
    expectedId: tip,
    alias: "image_1",
    assetId: ids.video,
    expectedAssetId: ids.image,
  });
  expect(replacement.alias).toBe("video_2");
  expect(replacement.text).toBe(
    text
      .replace("@[Image 1](image_1)", "@[Video 2](video_2)")
      .replace("@IMAGE_1", "@video_2"),
  );
  expect(await user.query(api.references.list, { projectId })).toContainEqual({
    alias: "video_2",
    assetId: ids.video,
  });
  await expect(
    user.mutation(api.references.replace, {
      projectId,
      expectedId: tip,
      alias: "image_1",
      assetId: ids.video,
      expectedAssetId: ids.image,
    }),
  ).rejects.toThrow("another window");
  const restored = await user.mutation(api.references.undoReplacement, {
    projectId,
    expectedId: replacement.id,
    previousVersionId: tip,
    alias: replacement.alias,
    originalAlias: "image_1",
    assetId: ids.video,
    previousAssetId: ids.image,
  });
  expect(restored.text).toBe(text);
  expect(await user.query(api.references.list, { projectId })).toContainEqual({
    alias: "image_1",
    assetId: ids.image,
  });
  await expect(
    user.mutation(api.references.undoReplacement, {
      projectId,
      expectedId: replacement.id,
      previousVersionId: tip,
      alias: replacement.alias,
      originalAlias: "image_1",
      assetId: ids.video,
      previousAssetId: ids.image,
    }),
  ).rejects.toThrow("script has changed");
});
