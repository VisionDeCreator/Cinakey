import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { makeTest } from "../test/helpers";
import { authDigest, verifiedEmailUser } from "./lib/authEmail";
import type { MutationCtx } from "./_generated/server";
const email = "creator@example.com";
const token = "a".repeat(64);
const code = "004921";
async function challenge(t: ReturnType<typeof makeTest>, suffix = "") {
  const challengeHash = await authDigest(token + suffix);
  const codeHash = await authDigest(`${token + suffix}:${email}:${code}`);
  const result = await t.mutation(internal.authOtp.issue, {
    email,
    challengeHash,
    codeHash,
    ipHash: await authDigest("127.0.0.1"),
  });
  return { ...result, challengeHash, codeHash };
}
afterEach(() => vi.useRealTimers());
it("creates an account only after delivered, verified code; consumes it once", async () => {
  const t = makeTest();
  const c = await challenge(t);
  const args = { email, challengeHash: c.challengeHash, codeHash: c.codeHash };
  expect(await t.mutation(internal.authOtp.consume, args)).toEqual({
    userId: null,
  });
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(0);
  await t.mutation(internal.authOtp.delivered, { id: c.id });
  const result = await t.mutation(internal.authOtp.consume, args);
  expect(result.userId).toBeTruthy();
  expect(await t.mutation(internal.authOtp.consume, args)).toEqual({
    userId: null,
  });
  const user = await t.run((ctx) => ctx.db.get(result.userId!));
  expect(user?.emailVerificationTime).toBeTypeOf("number");
  expect(user?.personalWorkspaceId).toBeTruthy();
  expect(
    await t.run((ctx) => ctx.db.query("workspaces").collect()),
  ).toHaveLength(1);
});
it("preserves existing password-user identity, workspace and balance across repeated OTP logins", async () => {
  vi.useFakeTimers();
  const t = makeTest();
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      email,
      name: "Original Creator",
      isStaff: true,
    });
    await verifiedEmailUser(ctx as MutationCtx, email);
    return id;
  });
  const before = await t.run(async (ctx) => ({
    user: await ctx.db.get(userId),
    workspaces: await ctx.db.query("workspaces").collect(),
    ledger: await ctx.db.query("usageLedger").collect(),
  }));
  for (let i = 0; i < 2; i++) {
    vi.advanceTimersByTime(60_001);
    const c = await challenge(t, String(i));
    await t.mutation(internal.authOtp.delivered, { id: c.id });
    expect(
      (
        await t.mutation(internal.authOtp.consume, {
          email,
          challengeHash: c.challengeHash,
          codeHash: c.codeHash,
        })
      ).userId,
    ).toBe(userId);
  }
  const after = await t.run(async (ctx) => ({
    user: await ctx.db.get(userId),
    workspaces: await ctx.db.query("workspaces").collect(),
    ledger: await ctx.db.query("usageLedger").collect(),
  }));
  expect(after.user).toMatchObject({
    _id: userId,
    name: "Original Creator",
    isStaff: true,
    personalWorkspaceId: before.user!.personalWorkspaceId,
  });
  expect(after.workspaces).toEqual(before.workspaces);
  expect(after.ledger).toEqual(before.ledger);
});
it("commits failed guesses and locks after five attempts, including a correct sixth guess", async () => {
  const t = makeTest();
  const c = await challenge(t);
  await t.mutation(internal.authOtp.delivered, { id: c.id });
  for (let i = 0; i < 5; i++)
    expect(
      await t.mutation(internal.authOtp.consume, {
        email,
        challengeHash: c.challengeHash,
        codeHash: "b".repeat(64),
      }),
    ).toEqual({ userId: null });
  expect((await t.run((ctx) => ctx.db.get(c.id)))?.attempts).toBe(5);
  expect(
    await t.mutation(internal.authOtp.consume, {
      email,
      challengeHash: c.challengeHash,
      codeHash: c.codeHash,
    }),
  ).toEqual({ userId: null });
});
it("rejects a different email, token, expired code and superseded challenge", async () => {
  vi.useFakeTimers();
  const t = makeTest();
  const c = await challenge(t);
  await t.mutation(internal.authOtp.delivered, { id: c.id });
  expect(
    await t.mutation(internal.authOtp.consume, {
      email: "other@example.com",
      challengeHash: c.challengeHash,
      codeHash: c.codeHash,
    }),
  ).toEqual({ userId: null });
  expect(
    await t.mutation(internal.authOtp.consume, {
      email,
      challengeHash: "b".repeat(64),
      codeHash: c.codeHash,
    }),
  ).toEqual({ userId: null });
  vi.advanceTimersByTime(60_001);
  const newer = await challenge(t, "new");
  expect(
    await t.mutation(internal.authOtp.consume, {
      email,
      challengeHash: c.challengeHash,
      codeHash: c.codeHash,
    }),
  ).toEqual({ userId: null });
  await t.mutation(internal.authOtp.delivered, { id: newer.id });
  vi.advanceTimersByTime(600_001);
  expect(
    await t.mutation(internal.authOtp.consume, {
      email,
      challengeHash: newer.challengeHash,
      codeHash: newer.codeHash,
    }),
  ).toEqual({ userId: null });
  expect(await t.mutation(internal.authOtp.cleanup, {})).toBe(2);
});
it("enforces cooldown and hourly email limits", async () => {
  vi.useFakeTimers();
  const t = makeTest();
  await challenge(t);
  await expect(challenge(t, "immediate")).rejects.toThrow();
  for (let i = 1; i < 5; i++) {
    vi.advanceTimersByTime(60_001);
    await challenge(t, String(i));
  }
  vi.advanceTimersByTime(60_001);
  await expect(challenge(t, "sixth")).rejects.toThrow(/Rate limit/);
});
it("normalizes legacy email keys without replacing users; retires only password credentials", async () => {
  const t = makeTest();
  const id = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      email: " Creator@Example.com ",
      name: "Keep me",
    });
    await ctx.db.insert("authAccounts", {
      userId: id,
      provider: "password",
      providerAccountId: email,
      secret: "retired-password-hash",
    });
    await ctx.db.insert("authAccounts", {
      userId: id,
      provider: "google",
      providerAccountId: "google-id",
    });
    return id;
  });
  expect(
    (
      await t.mutation(internal.authOtp.normalizeExistingEmails, {
        cursor: null,
      })
    ).normalized,
  ).toBe(1);
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    _id: id,
    email,
    name: "Keep me",
  });
  expect(await t.mutation(internal.authOtp.retirePasswords, {})).toEqual({
    removed: 1,
    isDone: true,
  });
  const accounts = await t.run((ctx) => ctx.db.query("authAccounts").collect());
  expect(accounts).toHaveLength(1);
  expect(accounts[0]?.provider).toBe("google");
});
it("verified Google resolution reuses OTP identity; ambiguous matches fail closed", async () => {
  const t = makeTest();
  const id = await t.run((ctx) => verifiedEmailUser(ctx as MutationCtx, email));
  expect(
    await t.run((ctx) =>
      verifiedEmailUser(ctx as MutationCtx, email, id, { name: "Google Name" }),
    ),
  ).toBe(id);
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  await t.run((ctx) => ctx.db.insert("users", { email }));
  await expect(
    t.run((ctx) => verifiedEmailUser(ctx as MutationCtx, email)),
  ).rejects.toThrow(/account assistance/);
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(2);
});
it("issues real Convex Auth sessions via OTP and rejects the removed password provider", async () => {
  const { api } = await import("./_generated/api");
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keys.privateKey),
  );
  const pem = btoa(String.fromCharCode(...bytes))
    .match(/.{1,64}/g)!
    .join("\n");
  vi.stubEnv(
    "JWT_PRIVATE_KEY",
    `-----${"BEGIN"} PRIVATE KEY-----\n${pem}\n-----${"END"} PRIVATE KEY-----`,
  );
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  const t = makeTest();
  const c = await challenge(t);
  await t.mutation(internal.authOtp.delivered, { id: c.id });
  const result = await t.action(api.auth.signIn, {
    provider: "email-otp",
    params: { email, challenge: token, code },
  });
  expect(result.tokens?.token).toBeTypeOf("string");
  expect(result.tokens?.refreshToken).toBeTypeOf("string");
  await expect(
    t.action(api.auth.signIn, {
      provider: "email-otp",
      params: { email, challenge: token, code },
    }),
  ).rejects.toThrow(/incorrect|expired/);
  await expect(
    t.action(api.auth.signIn, {
      provider: "password",
      params: { email, password: "retired", flow: "signIn" },
    }),
  ).rejects.toThrow();
});
it("links a verified Google callback to the existing OTP user and rejects unverified profiles", async () => {
  const t = makeTest();
  const id = await t.run((ctx) => verifiedEmailUser(ctx as MutationCtx, email));
  await t.run((ctx) =>
    ctx.db.insert("authVerifiers", { signature: "google-callback-fixture" }),
  );
  await t.mutation(internal.auth.store, {
    args: {
      type: "userOAuth",
      provider: "google",
      providerAccountId: "google-fixture-id",
      profile: { email, emailVerified: true, name: "Google Creator" },
      signature: "google-callback-fixture",
    },
  });
  const account = await t.run((ctx) => ctx.db.query("authAccounts").first());
  expect(account).toMatchObject({ userId: id, provider: "google" });
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  await t.run((ctx) =>
    ctx.db.insert("authVerifiers", { signature: "unverified-fixture" }),
  );
  await expect(
    t.mutation(internal.auth.store, {
      args: {
        type: "userOAuth",
        provider: "google",
        providerAccountId: "unverified-google-id",
        profile: { email: "other@example.com", emailVerified: false },
        signature: "unverified-fixture",
      },
    }),
  ).rejects.toThrow(/Verified Google/);
});
