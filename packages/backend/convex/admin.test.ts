import { expect, it } from "vitest";
import { api } from "../../../apps/api/src/operations";
import { makeTest, createTestUser, authIdentity } from "../test/helpers";
async function fixture() {
  const t = makeTest();
  const adminId = await createTestUser(t, "admin@test.com", { isStaff: true });
  const userId = await createTestUser(t, "customer@test.com");
  const admin = t.withIdentity(authIdentity(adminId));
  const customer = t.withIdentity(authIdentity(userId));
  const projectId = await customer.mutation(api.projects.create, {
    title: "Private film",
  });
  const workspaceId = (await customer.query(api.projects.get, { projectId }))!
    .workspaceId;
  return { t, admin, customer, userId, workspaceId };
}
it("enforces server-side administrator access for every directory endpoint", async () => {
  const f = await fixture();
  for (const client of [f.t, f.customer]) {
    const error =
      client === f.t ? "Not authenticated" : "Staff access required";
    await expect(
      client.query(api.staff.listUsers, { cursor: null }),
    ).rejects.toThrow(error);
    await expect(
      client.query(api.staff.listWorkspaces, { cursor: null }),
    ).rejects.toThrow(error);
    await expect(
      client.query(api.staff.userDetail, { userId: f.userId }),
    ).rejects.toThrow(error);
    await expect(
      client.query(api.staff.workspaceDetail, { workspaceId: f.workspaceId }),
    ).rejects.toThrow(error);
  }
});
it("provides cross-workspace diagnostics without granting customer membership or exposing private profile fields", async () => {
  const f = await fixture();
  const user = await f.admin.query(api.staff.userDetail, { userId: f.userId });
  expect(user).toMatchObject({
    email: "customer@test.com",
    isStaff: false,
    emailVerified: true,
    workspaces: [{ _id: f.workspaceId, role: "owner" }],
  });
  expect(user).not.toHaveProperty("phoneVerificationTime");
  const workspace = await f.admin.query(api.staff.workspaceDetail, {
    workspaceId: f.workspaceId,
  });
  expect(workspace).toMatchObject({
    _id: f.workspaceId,
    projectCount: 1,
    members: [{ userId: f.userId, role: "owner" }],
    billingMode: "paid",
  });
  await expect(
    f.admin.query(api.teams.members, { workspaceId: f.workspaceId }),
  ).rejects.toThrow("Workspace access denied");
});
it("paginates users and workspaces without dropping or duplicating records", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 28; i++) {
      await ctx.db.insert("users", { email: `page-${i}@test.com` });
      await ctx.db.insert("workspaces", {
        ownerUserId: f.userId,
        name: `Workspace ${i}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  });
  const users = await f.admin.query(api.staff.listUsers, { cursor: null });
  const nextUsers = await f.admin.query(api.staff.listUsers, {
    cursor: users.continueCursor,
  });
  expect(users.page).toHaveLength(25);
  expect(users.isDone).toBe(false);
  expect(nextUsers.isDone).toBe(true);
  expect(
    new Set([...users.page, ...nextUsers.page].map((u) => u._id)).size,
  ).toBe(30);
  const workspaces = await f.admin.query(api.staff.listWorkspaces, {
    cursor: null,
  });
  const nextWorkspaces = await f.admin.query(api.staff.listWorkspaces, {
    cursor: workspaces.continueCursor,
  });
  expect(workspaces.page).toHaveLength(25);
  expect(
    new Set([...workspaces.page, ...nextWorkspaces.page].map((w) => w._id))
      .size,
  ).toBe(29);
});
it("reports internal workspace cost and seat policy to an administrator who is not a member", async () => {
  const f = await fixture();
  const id = await f.admin.mutation(api.staff.createInternalWorkspace, {
    ownerEmail: "customer@test.com",
    name: "Company",
    monthlyCapUsdMicros: 100_000,
    reason: "Company team",
  });
  expect(
    await f.admin.query(api.staff.workspaceDetail, { workspaceId: id }),
  ).toMatchObject({
    billingMode: "internal",
    paidSeats: 0,
    budget: { spendCapUsdMicros: 100_000 },
    members: [{ userId: f.userId }],
  });
});
