import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";

describe("seed", () => {
  it("creates demo project with 2 scenes, 5 shots, 2 characters, 1 location", async () => {
    const t = makeTest();
    const userId = await createTestUser(t, "seed@test.com");
    const asUser = t.withIdentity(authIdentity(userId));

    const result = await asUser.mutation(api.seed.seedDemoProject, {});
    expect(result.sceneIds).toHaveLength(2);
    expect(result.shotIds).toHaveLength(5);
    expect(result.entityIds.maya).toBeTruthy();
    expect(result.entityIds.jordan).toBeTruthy();
    expect(result.entityIds.cafe).toBeTruthy();

    const project = await asUser.query(api.projects.get, {
      projectId: result.projectId,
    });
    expect(project.title).toBe("Demo Project");

    const user = await asUser.query(api.users.viewer, {});
    expect(user?.personalWorkspaceId).toBeTruthy();
  });
});
