import { expect, it } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { makeTest, authIdentity } from "../test/helpers";
import { verifiedEmailUser, authDigest } from "./lib/authEmail";
import type { MutationCtx } from "./_generated/server";
async function fixture() {
  const t = makeTest();
  const id = await t.run((ctx) =>
    ctx.db.insert("users", { email: "staff@example.com", isStaff: true }),
  );
  return { t, admin: t.withIdentity(authIdentity(id)) };
}
it("defaults closed and requires platform configuration permission, a reason, a fresh revision, and a unique audited request", async () => {
  const { t, admin } = await fixture();
  expect(await t.query(internal.earlyAccess.publicPolicy, {})).toEqual({
    requireApproval: true,
  });
  await expect(t.query(api.earlyAccess.settings, {})).rejects.toThrow();
  const supportId = await t.run((ctx) =>
    ctx.db.insert("users", { isStaff: true, adminRoles: ["support"] }),
  );
  const args = {
    requireApproval: false,
    revision: 0,
    reason: "Open registration acceptance",
    requestId: "open",
  };
  await expect(
    t
      .withIdentity(authIdentity(supportId))
      .mutation(api.earlyAccess.configure, args),
  ).rejects.toThrow("permission");
  await expect(
    admin.mutation(api.earlyAccess.configure, { ...args, reason: "short" }),
  ).rejects.toThrow("reason");
  await admin.mutation(api.earlyAccess.configure, args);
  await admin.mutation(api.earlyAccess.configure, args);
  expect(await t.query(internal.earlyAccess.publicPolicy, {})).toEqual({
    requireApproval: false,
  });
  await expect(
    admin.mutation(api.earlyAccess.configure, {
      ...args,
      requireApproval: true,
    }),
  ).rejects.toThrow("mismatch");
  await expect(
    admin.mutation(api.earlyAccess.configure, { ...args, requestId: "stale" }),
  ).rejects.toThrow("changed");
  expect(
    await t.run((ctx) => ctx.db.query("auditLog").collect()),
  ).toMatchObject([{ action: "waitlist.configure", reason: args.reason }]);
});
it("opens signup for pending, rejected and new applicants, preserves decisions, and retains registered access after closing", async () => {
  const { t, admin } = await fixture();
  await admin.mutation(api.earlyAccess.configure, {
    requireApproval: false,
    revision: 0,
    reason: "Open registration acceptance",
    requestId: "open",
  });
  const ids = [];
  for (const status of ["pending", "rejected"] as const) {
    const email = `${status}@example.com`;
    const requestId = await t.run((ctx) =>
      ctx.db.insert("earlyAccessRequests", {
        email,
        name: "",
        idea: "",
        status,
        createdAt: Date.now(),
      }),
    );
    const id = await t.run((ctx) =>
      verifiedEmailUser(ctx as MutationCtx, email),
    );
    ids.push({ id, email });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
      status,
      registeredUserId: id,
    });
    expect((await t.run((ctx) => ctx.db.get(id)))?.isStaff).toBeUndefined();
  }
  const id = await t.run((ctx) =>
    verifiedEmailUser(ctx as MutationCtx, "fresh@example.com"),
  );
  ids.push({ id, email: "fresh@example.com" });
  await admin.mutation(api.earlyAccess.configure, {
    requireApproval: true,
    revision: 1,
    reason: "Restore approval for applicants",
    requestId: "close",
  });
  for (const user of ids)
    expect(
      await t.run((ctx) => verifiedEmailUser(ctx as MutationCtx, user.email)),
    ).toBe(user.id);
  await expect(
    t.run((ctx) =>
      verifiedEmailUser(ctx as MutationCtx, "blocked@example.com"),
    ),
  ).rejects.toThrow("Waitlist approval");
  await t.run((ctx) => ctx.db.patch(id, { suspendedAt: Date.now() }));
  await expect(
    t.run((ctx) => verifiedEmailUser(ctx as MutationCtx, "fresh@example.com")),
  ).rejects.toThrow("suspended");
  expect(await t.query(internal.earlyAccess.publicPolicy, {})).toEqual({
    requireApproval: true,
  });
});
it("checks the latest mode when consuming an OTP issued while registration was open", async () => {
  const { t, admin } = await fixture();
  const email = "otp@example.com";
  await admin.mutation(api.earlyAccess.configure, {
    requireApproval: false,
    revision: 0,
    reason: "Open registration acceptance",
    requestId: "open",
  });
  const challengeHash = await authDigest("challenge"),
    codeHash = await authDigest("code");
  const challenge = await t.mutation(internal.authOtp.issue, {
    email,
    challengeHash,
    codeHash,
    ipHash: "a".repeat(64),
  });
  await t.mutation(internal.authOtp.delivered, { id: challenge.id });
  await admin.mutation(api.earlyAccess.configure, {
    requireApproval: true,
    revision: 1,
    reason: "Restore approval for applicants",
    requestId: "close",
  });
  await expect(
    t.mutation(internal.authOtp.consume, { email, challengeHash, codeHash }),
  ).rejects.toThrow("Waitlist approval");
  await admin.mutation(api.earlyAccess.configure, {
    requireApproval: false,
    revision: 2,
    reason: "Reopen registration for testing",
    requestId: "reopen",
  });
  expect(
    (
      await t.mutation(internal.authOtp.consume, {
        email,
        challengeHash,
        codeHash,
      })
    ).userId,
  ).toBeTruthy();
});
it("applies the same mode to verified Google callbacks and never accepts unverified profiles", async () => {
  const { t, admin } = await fixture();
  const { internal: authInternal } = await import("./_generated/api");
  async function google(email: string, verified: boolean) {
    const signature = `google-${email}`;
    await t.run((ctx) => ctx.db.insert("authVerifiers", { signature }));
    return t.mutation(authInternal.auth.store, {
      args: {
        type: "userOAuth",
        provider: "google",
        providerAccountId: email,
        profile: { email, emailVerified: verified },
        signature,
      },
    });
  }
  await expect(google("closed@example.com", true)).rejects.toThrow(
    "Waitlist approval",
  );
  await admin.mutation(api.earlyAccess.configure, {
    requireApproval: false,
    revision: 0,
    reason: "Open registration acceptance",
    requestId: "open",
  });
  await google("open@example.com", true);
  await expect(google("unverified@example.com", false)).rejects.toThrow(
    "Verified",
  );
  const users = await t.run((ctx) => ctx.db.query("users").collect());
  expect(users.some((u) => u.email === "open@example.com")).toBe(true);
  expect(users.some((u) => u.email === "unverified@example.com")).toBe(false);
});
