import { describe, expect, it } from "vitest";
import { authIdentity, createTestUser, makeTest } from "../../test/helpers";
import { api, internal } from "../_generated/api";

describe("versioning", () => {
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

    const v1 = await asUser.mutation(internal.timelineVersions.createVersion, {
      projectId,
      timelineFileId: file1,
    });
    const v2 = await asUser.mutation(internal.timelineVersions.createVersion, {
      projectId,
      parentId: v1,
      timelineFileId: file2,
    });

    const list = await asUser.query(api.timelineVersions.listForProject, {
      projectId,
    });
    expect(list.find((x: { _id: string }) => x._id === v2)?.parentId).toBe(v1);
  });
});
