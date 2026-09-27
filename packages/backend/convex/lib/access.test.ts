import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import {
  authIdentity,
  createTestUser,
  makeTest,
} from "../../test/helpers";

describe("access control", () => {
  it("rejects unauthenticated project access", async () => {
    const t = makeTest();
    const ownerId = await createTestUser(t, "owner@test.com");
    const asOwner = t.withIdentity(authIdentity(ownerId));
    await asOwner.mutation(api.users.ensurePersonalWorkspace, {});
    const projectId = await asOwner.mutation(api.projects.create, {
      title: "Secret",
    });

    await expect(t.query(api.projects.get, { projectId })).rejects.toThrow(
      /Not authenticated/,
    );
  });

  it("allows the owner to read their project", async () => {
    const t = makeTest();
    const ownerId = await createTestUser(t, "owner@test.com");
    const asOwner = t.withIdentity(authIdentity(ownerId));
    const projectId = await asOwner.mutation(api.projects.create, {
      title: "Mine",
    });
    const project = await asOwner.query(api.projects.get, { projectId });
    expect(project.title).toBe("Mine");
  });

  it("denies another user from reading or updating a project", async () => {
    const t = makeTest();
    const ownerId = await createTestUser(t, "owner@test.com");
    const otherId = await createTestUser(t, "other@test.com");
    const asOwner = t.withIdentity(authIdentity(ownerId));
    const asOther = t.withIdentity(authIdentity(otherId));

    const projectId = await asOwner.mutation(api.projects.create, {
      title: "Private",
    });

    await expect(
      asOther.query(api.projects.get, { projectId }),
    ).rejects.toThrow(/Project access denied/);

    await expect(
      asOther.mutation(api.projects.update, {
        projectId,
        title: "Hacked",
      }),
    ).rejects.toThrow(/Project access denied/);
  });

  it("allows staff to read another user's project", async () => {
    const t = makeTest();
    const ownerId = await createTestUser(t, "owner@test.com");
    const staffId = await createTestUser(t, "staff@test.com", {
      isStaff: true,
    });
    const asOwner = t.withIdentity(authIdentity(ownerId));
    const asStaff = t.withIdentity(authIdentity(staffId));

    const projectId = await asOwner.mutation(api.projects.create, {
      title: "Owned",
    });
    const project = await asStaff.query(api.projects.get, { projectId });
    expect(project.title).toBe("Owned");
  });
});
