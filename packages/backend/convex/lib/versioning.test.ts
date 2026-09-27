import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import {
  authIdentity,
  createTestUser,
  makeTest,
} from "../../test/helpers";

describe("versioning", () => {
  it("creates script versions with parent pointers without overwriting", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "v@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    const projectId = await asUser.mutation(api.projects.create, {
      title: "Scripted",
    });

    const file1 = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob([JSON.stringify({ body: "v1" })], {
          type: "application/json",
        }),
      );
    });
    const file2 = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob([JSON.stringify({ body: "v2" })], {
          type: "application/json",
        }),
      );
    });

    const v1 = await asUser.mutation(api.scriptVersions.createVersion, {
      projectId,
      format: "screenplay",
      label: "Draft 1",
      contentFileId: file1,
    });
    const v2 = await asUser.mutation(api.scriptVersions.createVersion, {
      projectId,
      parentId: v1,
      format: "screenplay",
      label: "Draft 2",
      contentFileId: file2,
    });

    expect(v1).not.toEqual(v2);

    const versions = await asUser.query(api.scriptVersions.listForProject, {
      projectId,
    });
    expect(versions).toHaveLength(2);

    const first = versions.find((x) => x._id === v1)!;
    const second = versions.find((x) => x._id === v2)!;
    expect(first.parentId).toBeUndefined();
    expect(first.contentFileId).toBe(file1);
    expect(second.parentId).toBe(v1);
    expect(second.contentFileId).toBe(file2);
    // Original version row was not mutated.
    expect(first.label).toBe("Draft 1");
  });

  it("creates timeline versions with parent pointers", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "tl@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    const projectId = await asUser.mutation(api.projects.create, {
      title: "Edit",
    });

    const file1 = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob([JSON.stringify({ tracks: [] })], {
          type: "application/json",
        }),
      );
    });
    const file2 = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob([JSON.stringify({ tracks: [1] })], {
          type: "application/json",
        }),
      );
    });

    const v1 = await asUser.mutation(api.timelineVersions.createVersion, {
      projectId,
      timelineFileId: file1,
    });
    const v2 = await asUser.mutation(api.timelineVersions.createVersion, {
      projectId,
      parentId: v1,
      timelineFileId: file2,
    });

    const list = await asUser.query(api.timelineVersions.listForProject, {
      projectId,
    });
    expect(list.find((x) => x._id === v2)?.parentId).toBe(v1);
  });

  it("updates shot blockoutFileId to a new storage blob (no overwrite)", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "bo@test.com");
    const asUser = t.withIdentity(authIdentity(userId));
    const seeded = await asUser.mutation(api.seed.seedDemoProject, {});
    const shotId = seeded.shotIds[0]!;

    const first = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob([JSON.stringify({ schema: "cinakey.blockout/1.0", n: 1 })], {
          type: "application/json",
        }),
      );
    });
    const second = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob([JSON.stringify({ schema: "cinakey.blockout/1.0", n: 2 })], {
          type: "application/json",
        }),
      );
    });

    await asUser.mutation(api.blockouts.saveBlockout, {
      shotId,
      storageId: first,
    });
    await asUser.mutation(api.blockouts.saveBlockout, {
      shotId,
      storageId: second,
    });

    const shot = await t.run(async (ctx) => ctx.db.get(shotId));
    expect(shot?.blockoutFileId).toBe(second);
    // Previous blob still exists.
    const oldUrl = await t.run(async (ctx) => ctx.storage.getUrl(first));
    expect(oldUrl).toBeTruthy();
  });
});
