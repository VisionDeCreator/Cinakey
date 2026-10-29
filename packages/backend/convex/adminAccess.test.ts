import { expect, it } from "vitest";
import { api } from "../../../apps/api/src/operations";
import { adminRoles, hasAdminPermission } from "@dirrio/shared";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";
async function fixture() {
  const t = makeTest();
  const ownerId = await createTestUser(t, "owner-admin@test.com", {
    isStaff: true,
  });
  const targetId = await createTestUser(t, "role-target@test.com");
  const owner = t.withIdentity(authIdentity(ownerId));
  const target = t.withIdentity(authIdentity(targetId));
  const request = {
    email: "role-target@test.com",
    roles: ["support" as const],
    reason: "Support team access",
    requestId: "role-change-1",
  };
  return { t, ownerId, targetId, owner, target, request };
}
it("preserves legacy administrator access and denies ordinary users", () => {
  expect(adminRoles({ isStaff: true })).toEqual(["platform_admin"]);
  expect(hasAdminPermission({ isStaff: true }, "administrators.manage")).toBe(
    true,
  );
  expect(
    adminRoles({ isStaff: false, adminRoles: ["platform_admin"] }),
  ).toEqual([]);
  expect(
    hasAdminPermission(
      { isStaff: true, adminRoles: ["support"] },
      "billing.read",
    ),
  ).toBe(false);
});
it("enforces roles on direct existing API operations, independently of navigation", async () => {
  const f = await fixture();
  await f.owner.mutation(api.adminAccess.setRoles, f.request);
  expect(
    (await f.target.query(api.staff.listUsers, { cursor: null })).page.length,
  ).toBe(2);
  for (const operation of [
    () => f.target.query(api.staff.lookupUser, { email: f.request.email }),
    () => f.target.query(api.staff.providerHealth, {}),
    () => f.target.query(api.staff.listModerationQueue, {}),
    () => f.target.query(api.staff.listAuditLog, {}),
    () =>
      f.target.query(api.adminAccess.listAudit, {
        paginationOpts: { cursor: null, numItems: 25 },
      }),
    () =>
      f.target.mutation(api.staff.grantUsd, {
        email: f.request.email,
        amount: 100,
        reason: "Not permitted",
      }),
    () =>
      f.target.mutation(api.adminAccess.setRoles, {
        ...f.request,
        roles: ["platform_admin"],
        requestId: "escalate",
      }),
  ])
    await expect(operation()).rejects.toThrow("Staff access denied");
});
it("audits role changes atomically, deduplicates retries, and rejects conflicting request reuse", async () => {
  const f = await fixture();
  await f.owner.mutation(api.adminAccess.setRoles, f.request);
  await f.owner.mutation(api.adminAccess.setRoles, f.request);
  const user = await f.t.run((ctx) => ctx.db.get(f.targetId));
  expect(user).toMatchObject({ isStaff: true, adminRoles: ["support"] });
  const audit = await f.owner.query(api.adminAccess.listAudit, {
    paginationOpts: { cursor: null, numItems: 25 },
    action: "administrators.roles.set",
    targetId: f.targetId,
  });
  expect(audit.page).toHaveLength(1);
  expect(audit.page[0]).toMatchObject({
    actorUserId: f.ownerId,
    requestId: f.request.requestId,
    outcome: "succeeded",
    reason: f.request.reason,
  });
  expect(JSON.parse(audit.page[0]!.before!)).toEqual({ roles: [] });
  expect(JSON.parse(audit.page[0]!.after!)).toEqual({ roles: ["support"] });
  await expect(
    f.owner.mutation(api.adminAccess.setRoles, {
      ...f.request,
      roles: ["billing"],
    }),
  ).rejects.toThrow("request mismatch");
});
it("prevents self changes, unverified grants and unauthorized assignment", async () => {
  const f = await fixture();
  await expect(
    f.owner.mutation(api.adminAccess.setRoles, {
      ...f.request,
      email: "owner-admin@test.com",
      roles: [],
    }),
  ).rejects.toThrow("own roles");
  await f.t.run((ctx) =>
    ctx.db.patch(f.targetId, { emailVerificationTime: undefined }),
  );
  await expect(
    f.owner.mutation(api.adminAccess.setRoles, f.request),
  ).rejects.toThrow("verified account");
  await expect(
    f.target.mutation(api.adminAccess.setRoles, f.request),
  ).rejects.toThrow("Staff access required");
  expect(
    await f.t.run((ctx) => ctx.db.query("auditLog").collect()),
  ).toHaveLength(0);
});
it("supports combined roles and immediate revocation", async () => {
  const f = await fixture();
  await f.owner.mutation(api.adminAccess.setRoles, {
    ...f.request,
    roles: ["billing", "operations"],
  });
  expect(await f.target.query(api.staff.providerHealth, {})).toBeDefined();
  expect(
    await f.target.query(api.staff.lookupUser, { email: f.request.email }),
  ).toBeDefined();
  await f.owner.mutation(api.adminAccess.setRoles, {
    ...f.request,
    roles: [],
    requestId: "revoke",
  });
  await expect(
    f.target.query(api.staff.listUsers, { cursor: null }),
  ).rejects.toThrow("Staff access required");
});
it("preserves a platform administrator during concurrent cross-demotions", async () => {
  const f = await fixture();
  await f.owner.mutation(api.adminAccess.setRoles, {
    ...f.request,
    roles: ["platform_admin"],
  });
  const results = await Promise.allSettled([
    f.owner.mutation(api.adminAccess.setRoles, {
      ...f.request,
      roles: [],
      requestId: "demote-target",
    }),
    f.target.mutation(api.adminAccess.setRoles, {
      email: "owner-admin@test.com",
      roles: [],
      reason: "Demote former owner",
      requestId: "demote-owner",
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const users = await f.t.run((ctx) => ctx.db.query("users").collect());
  expect(
    users.filter((user) => adminRoles(user).includes("platform_admin")),
  ).toHaveLength(1);
});
it("filters and paginates audit history without duplicate records", async () => {
  const f = await fixture();
  await f.owner.mutation(api.adminAccess.setRoles, f.request);
  await f.owner.mutation(api.adminAccess.setRoles, {
    ...f.request,
    roles: ["billing"],
    requestId: "second",
  });
  const args = {
    paginationOpts: { cursor: null as string | null, numItems: 1 },
    actorUserId: f.ownerId,
    targetId: f.targetId,
  };
  const first = await f.owner.query(api.adminAccess.listAudit, args);
  const second = await f.owner.query(api.adminAccess.listAudit, {
    ...args,
    paginationOpts: { cursor: first.continueCursor, numItems: 1 },
  });
  expect(first.page).toHaveLength(1);
  expect(second.page).toHaveLength(1);
  expect(first.page[0]!._id).not.toBe(second.page[0]!._id);
  expect(
    (
      await f.owner.query(api.adminAccess.listAudit, {
        ...args,
        from: Date.now() + 60_000,
      })
    ).page,
  ).toHaveLength(0);
  await expect(
    f.owner.query(api.adminAccess.listAudit, { ...args, from: 10, to: 1 }),
  ).rejects.toThrow("Invalid date range");
});
