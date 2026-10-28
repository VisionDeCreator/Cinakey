/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic storage references bridge query and mutation contracts. */
import { describe, expect, it } from "vitest";
import { makeFunctionReference } from "convex/server";
import { api } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";
const ref = (name: string) => makeFunctionReference<any>(`storageIO:${name}`);
async function fixture() {
  const t = makeTest();
  const ownerId = await createTestUser(t, "r2-owner@test.com");
  const otherId = await createTestUser(t, "r2-other@test.com");
  const owner = t.withIdentity(authIdentity(ownerId));
  const other = t.withIdentity(authIdentity(otherId));
  const projectId = await owner.mutation(api.projects.create, { title: "R2" });
  const args = {
    token: "test-session-token",
    key: "staging/test-object",
    projectId,
  };
  return { t, owner, other, ownerId, projectId, args };
}
describe("R2 metadata and ownership", () => {
  it("authorizes sessions, freezes upload metadata, verifies completion and supports retries", async () => {
    const f = await fixture();
    await expect(
      f.other.mutation(ref("beginR2Upload"), f.args),
    ).rejects.toThrow(/access denied/i);
    await f.owner.mutation(ref("beginR2Upload"), f.args);
    await f.t.mutation(ref("prepareR2Upload"), {
      token: f.args.token,
      size: 100,
      contentType: "image/png",
    });
    await expect(
      f.t.mutation(ref("prepareR2Upload"), {
        token: f.args.token,
        size: 101,
        contentType: "image/png",
      }),
    ).rejects.toThrow(/cannot change/);
    await f.t.mutation(ref("claimR2Upload"), { token: f.args.token });
    await expect(
      f.t.mutation(ref("claimR2Upload"), { token: f.args.token }),
    ).rejects.toThrow(/already in progress/);
    const completed = {
      token: f.args.token,
      size: 100,
      contentType: "image/png",
      bucket: "test-media",
      key: "media/test-object",
    };
    await expect(
      f.t.mutation(ref("completeR2Upload"), { ...completed, size: 101 }),
    ).rejects.toThrow(/does not match/);
    const storageId = await f.t.mutation(ref("completeR2Upload"), completed);
    expect(await f.t.mutation(ref("completeR2Upload"), completed)).toBe(
      storageId,
    );
    expect(
      (await f.t.mutation(ref("claimR2Upload"), { token: f.args.token }))
        .fileId,
    ).toBe(storageId);
    const assetId = await f.owner.mutation(api.storage.createAssetFromUpload, {
      projectId: f.projectId,
      storageId,
      type: "image",
      name: "reference.png",
    });
    expect(await f.owner.query(api.storage.getAssetUrl, { assetId })).toBe(
      `r2://${storageId}`,
    );
    await expect(
      f.other.query(api.storage.getAssetUrl, { assetId }),
    ).rejects.toThrow(/access denied/i);
    await expect(
      f.other.query(ref("authorizeR2File"), { id: storageId }),
    ).rejects.toThrow(/access denied/i);
    expect(
      (await f.owner.query(ref("authorizeR2File"), { id: storageId })).key,
    ).toBe(completed.key);
    const otherProject = await f.other.mutation(api.projects.create, {
      title: "Other",
    });
    await expect(
      f.other.mutation(api.storage.createAssetFromUpload, {
        projectId: otherProject,
        storageId,
        type: "image",
        name: "stolen.png",
      }),
    ).rejects.toThrow(/another workspace/);
    await f.owner.mutation(api.storage.deleteAsset, { assetId });
    const file = await f.t.query(ref("lookupR2File"), { id: storageId });
    expect(file.deletedAt).toBeTypeOf("number");
    const tasks = await f.t.run((ctx) => ctx.db.query("apiTasks").collect());
    expect(
      tasks.some((task) => task.operation === "r2Storage:deleteObject"),
    ).toBe(true);
  });
  it("expires sessions and refuses unregistered file references at the public boundary", async () => {
    const f = await fixture();
    const id = await f.owner.mutation(ref("beginR2Upload"), f.args);
    await f.t.run((ctx) => ctx.db.patch(id, { expiresAt: Date.now() - 1 }));
    await expect(
      f.t.mutation(ref("prepareR2Upload"), {
        token: f.args.token,
        size: 100,
        contentType: "image/png",
      }),
    ).rejects.toThrow(/expired/);
    const fileId = await f.t.mutation(ref("registerR2File"), {
      key: "media/unregistered",
      bucket: "test-media",
      size: 100,
      contentType: "image/png",
    });
    await expect(
      f.owner.query(ref("authorizeR2File"), { id: fileId }),
    ).rejects.toThrow(/access denied/i);
  });
});

it("cleans up unregistered worker media after the grace period", async () => {
  const f = await fixture();
  const fileId = await f.t.mutation(ref("registerR2File"), {
    key: "media/abandoned",
    bucket: "test-media",
    size: 100,
    contentType: "image/png",
  });
  expect(
    await f.t.mutation(ref("registerR2File"), {
      key: "media/abandoned",
      bucket: "test-media",
      size: 100,
      contentType: "image/png",
    }),
  ).toBe(fileId);
  await f.t.run((ctx) =>
    ctx.db.patch(fileId, { createdAt: Date.now() - 2 * 86400_000 }),
  );
  await f.t.mutation(ref("cleanupR2Uploads"), {});
  expect(
    (await f.t.query(ref("lookupR2File"), { id: fileId })).deletedAt,
  ).toBeTypeOf("number");
});
