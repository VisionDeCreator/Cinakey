import { expect, it } from "vitest";
import { makeFunctionReference } from "convex/server";
import { api } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";
const remove = makeFunctionReference<"mutation">(
  "bucketCleanup:removeProjects",
);
async function fixture() {
  const t = makeTest();
  const userId = await createTestUser(t, "cleanup@test.com");
  const user = t.withIdentity(authIdentity(userId));
  const projectId = await user.mutation(api.projects.create, {
    title: "Retired media",
  });
  const keepId = await user.mutation(api.projects.create, {
    title: "Keep this project",
  });
  const project = (await user.query(api.projects.get, { projectId }))!;
  const { fileId, assetId } = await t.run(async (ctx) => {
    const fileId = await ctx.db.insert("r2Files", {
      key: "media/old",
      bucket: "retired-media",
      size: 100,
      contentType: "image/png",
      createdAt: Date.now(),
      workspaceId: project.workspaceId,
    });
    const assetId = await ctx.db.insert("assets", {
      projectId,
      workspaceId: project.workspaceId,
      storageId: fileId,
      type: "image",
      name: "Old image",
      searchText: "old image",
      format: "image/png",
      sizeBytes: 100,
      tags: [],
      starred: false,
      createdBy: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { fileId, assetId };
  });
  const args = {
    bucket: "retired-media",
    projectIds: [projectId],
    expectedAssetIds: [assetId],
    reason: "Remove obsolete development project after backup",
  };
  return { t, userId, projectId, keepId, fileId, assetId, args };
}
it("deletes only explicitly selected old-bucket project data and retains unrelated projects and file bytes", async () => {
  const { t, projectId, keepId, fileId, assetId, args } = await fixture();
  const result = await t.mutation(remove, args);
  expect(result.counts.projects).toBe(1);
  await t.run(async (ctx) => {
    expect(await ctx.db.get(projectId)).toBeNull();
    expect(await ctx.db.get(assetId)).toBeNull();
    expect(await ctx.db.get(keepId)).not.toBeNull();
    expect(await ctx.db.get(fileId)).not.toBeNull();
    expect(
      (await ctx.db.query("auditLog").collect()).some(
        (row) => row.action === "projects.removeRetiredBucket",
      ),
    ).toBe(true);
  });
});
it("rejects a mismatched bucket and a changed post-backup asset set without deleting anything", async () => {
  const { t, projectId, args } = await fixture();
  await expect(
    t.mutation(remove, { ...args, bucket: "other-media" }),
  ).rejects.toThrow("no assets");
  await expect(
    t.mutation(remove, { ...args, expectedAssetIds: [] }),
  ).rejects.toThrow("changed after backup");
  expect(await t.run((ctx) => ctx.db.get(projectId))).not.toBeNull();
});
it("rejects shared assets, held media and pending project tasks", async () => {
  const { t, userId, projectId, keepId, fileId, assetId, args } =
    await fixture();
  const link = await t.run((ctx) =>
    ctx.db.insert("projectAssetLinks", { projectId: keepId, assetId }),
  );
  await expect(t.mutation(remove, args)).rejects.toThrow("shared outside");
  await t.run((ctx) => ctx.db.delete(link));
  const control = await t.run((ctx) =>
    ctx.db.insert("mediaControls", {
      storageId: fileId,
      quarantined: false,
      retentionHold: true,
      revision: 1,
      updatedBy: userId,
      updatedAt: Date.now(),
    }),
  );
  await expect(t.mutation(remove, args)).rejects.toThrow("retention hold");
  await t.run((ctx) => ctx.db.delete(control));
  await t.run((ctx) =>
    ctx.db.insert("apiTasks", {
      operation: "test:projectTask",
      args: { projectId },
      dueAt: Date.now(),
      state: "pending",
      attempts: 0,
      createdAt: Date.now(),
    }),
  );
  await expect(t.mutation(remove, args)).rejects.toThrow("queued tasks");
  expect(await t.run((ctx) => ctx.db.get(projectId))).not.toBeNull();
});
