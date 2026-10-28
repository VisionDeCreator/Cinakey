import { expect, it } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";
import { promoteAdmin } from "./staff";

it("grants admin access to the matching verified account and audits the operator atomically", async () => {
  const t = makeTest();
  const userId = await createTestUser(t, "owner@test.com");
  const otherId = await createTestUser(t, "other@test.com");
  const user = t.withIdentity(authIdentity(userId));
  await expect(user.query(api.staff.listAuditLog, {})).rejects.toThrow(
    "Staff access required",
  );
  const before = await t.run((ctx) => ctx.db.get(userId));

  expect(
    await t.mutation(internal.staff.promoteAdmin, {
      email: "  OWNER@Test.com ",
      reason: "  Initial administrator  ",
    }),
  ).toEqual({
    userId,
    email: "owner@test.com",
    isStaff: true,
    alreadyAdmin: false,
  });

  expect(await t.run((ctx) => ctx.db.get(userId))).toEqual({
    ...before,
    isStaff: true,
  });
  expect((await t.run((ctx) => ctx.db.get(otherId)))?.isStaff).not.toBe(true);
  const audit = await user.query(api.staff.listAuditLog, {});
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    actorType: "operator",
    action: "platform.admin.promote",
    targetType: "users",
    targetId: userId,
    reason: "Initial administrator",
  });
  expect(audit[0]!.actorUserId).toBeUndefined();
  expect(JSON.parse(audit[0]!.meta!)).toEqual({
    email: "owner@test.com",
    source: "admin:promote",
    authorization: "deployment-key",
  });
});

it("is an internal-only mutation and reruns without duplicating audit entries", async () => {
  expect(promoteAdmin).toHaveProperty("isInternal", true);
  const t = makeTest();
  await createTestUser(t, "owner@test.com");
  const args = { email: "owner@test.com", reason: "Operator setup" };
  await t.mutation(internal.staff.promoteAdmin, args);
  expect(await t.mutation(internal.staff.promoteAdmin, args)).toMatchObject({
    alreadyAdmin: true,
  });
  expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(
    1,
  );
});

it("rejects nonexistent, unverified, anonymous and ambiguous accounts without creating users or audits", async () => {
  const t = makeTest();
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { email: "unverified@test.com" });
    await ctx.db.insert("users", {
      email: "anonymous@test.com",
      isAnonymous: true,
      emailVerificationTime: 1,
    });
    await ctx.db.insert("users", {
      email: "duplicate@test.com",
      emailVerificationTime: 1,
    });
    await ctx.db.insert("users", {
      email: "duplicate@test.com",
      emailVerificationTime: 1,
    });
  });
  for (const [email, message] of [
    ["missing@test.com", "No existing account"],
    ["unverified@test.com", "must verify its email"],
    ["anonymous@test.com", "must verify its email"],
    ["duplicate@test.com", "Multiple accounts"],
  ] as const) {
    await expect(
      t.mutation(internal.staff.promoteAdmin, {
        email,
        reason: "Operator setup",
      }),
    ).rejects.toThrow(message);
  }
  const users = await t.run((ctx) => ctx.db.query("users").collect());
  expect(users).toHaveLength(4);
  expect(users.some((u) => u.isStaff)).toBe(false);
  expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(
    0,
  );
});

it("validates arguments on the backend even when the CLI is bypassed", async () => {
  const t = makeTest();
  const userId = await createTestUser(t, "owner@test.com");
  for (const args of [
    { email: "invalid", reason: "Operator setup" },
    { email: "owner@test.com", reason: " " },
    { email: "owner@test.com", reason: "x".repeat(501) },
  ])
    await expect(
      t.mutation(internal.staff.promoteAdmin, args),
    ).rejects.toThrow();
  expect((await t.run((ctx) => ctx.db.get(userId)))?.isStaff).not.toBe(true);
});
