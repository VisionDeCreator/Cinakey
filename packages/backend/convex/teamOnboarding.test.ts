import { smtpTransport as nodemailer } from "../../../apps/api/src/services/smtp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../../apps/api/src/operations";
import { authIdentity, createTestUser, makeTest } from "../test/helpers";
async function fixture() {
  const t = makeTest();
  const userId = await createTestUser(t, "person@onboarding.test");
  await t.run((ctx) =>
    ctx.db.patch(userId, { emailVerificationTime: undefined }),
  );
  const user = t.withIdentity(authIdentity(userId));
  return { t, user, userId };
}
afterEach(() => vi.useRealTimers());
describe("team onboarding", () => {
  it("commits rejected attempts and locks the challenge after five failures", async () => {
    const f = await fixture();
    await f.user.mutation(internal.teamOnboarding.issueVerification, {
      email: "person@onboarding.test",
      codeHash: "a".repeat(64),
    });
    for (let i = 0; i < 5; i++)
      expect(
        await f.user.mutation(internal.teamOnboarding.consumeVerification, {
          codeHash: "b".repeat(64),
        }),
      ).toEqual({ verified: false });
    expect(
      await f.user.mutation(internal.teamOnboarding.consumeVerification, {
        codeHash: "a".repeat(64),
      }),
    ).toEqual({ verified: false });
    expect(
      (await f.t.run((ctx) => ctx.db.query("emailVerifications").unique()))
        ?.attempts,
    ).toBe(5);
    expect(
      (await f.user.query(api.users.viewer, {}))?.emailVerificationTime,
    ).toBeUndefined();
  });
  it("expires codes, throttles issuance and invalidates a superseded code", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const issue = (codeHash: string) =>
      f.user.mutation(internal.teamOnboarding.issueVerification, {
        email: "person@onboarding.test",
        codeHash,
      });
    await issue("a".repeat(64));
    await expect(issue("b".repeat(64))).rejects.toThrow("Rate limit");
    vi.advanceTimersByTime(60_001);
    await issue("b".repeat(64));
    expect(
      await f.user.mutation(internal.teamOnboarding.consumeVerification, {
        codeHash: "a".repeat(64),
      }),
    ).toEqual({ verified: false });
    vi.advanceTimersByTime(600_001);
    expect(
      await f.user.mutation(internal.teamOnboarding.consumeVerification, {
        codeHash: "b".repeat(64),
      }),
    ).toEqual({ verified: false });
  });
  it("never verifies another account or an email changed after issuance", async () => {
    const f = await fixture();
    await f.user.mutation(internal.teamOnboarding.issueVerification, {
      email: "person@onboarding.test",
      codeHash: "a".repeat(64),
    });
    const otherId = await createTestUser(f.t, "other@onboarding.test");
    await f.t.run((ctx) =>
      ctx.db.patch(otherId, { emailVerificationTime: undefined }),
    );
    expect(
      await f.t
        .withIdentity(authIdentity(otherId))
        .mutation(internal.teamOnboarding.consumeVerification, {
          codeHash: "a".repeat(64),
        }),
    ).toEqual({ verified: false });
    await f.t.run((ctx) =>
      ctx.db.patch(f.userId, { email: "changed@onboarding.test" }),
    );
    expect(
      await f.user.mutation(internal.teamOnboarding.consumeVerification, {
        codeHash: "a".repeat(64),
      }),
    ).toEqual({ verified: false });
  });
  it("sends a mocked email, stores only a hash and enables invitation acceptance", async () => {
    const f = await fixture();
    const ownerId = await createTestUser(f.t, "owner@onboarding.test");
    const owner = f.t.withIdentity(authIdentity(ownerId));
    const workspaceId = await owner.mutation(
      api.users.ensurePersonalWorkspace,
      {},
    );
    const invitationId = await owner.mutation(api.teams.invite, {
      workspaceId,
      email: "person@onboarding.test",
      role: "creator",
    });
    await expect(
      f.user.mutation(api.teams.accept, { invitationId }),
    ).rejects.toThrow("verify");
    vi.stubEnv("EMAIL_NOTIFICATIONS_ENABLED", "true");
    for (const [key, value] of Object.entries({
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "fixture",
      SMTP_PASSWORD: "fixture",
      SMTP_FROM_EMAIL: "cinakey@example.com",
    }))
      vi.stubEnv(key, value);
    const send = vi
      .fn()
      .mockResolvedValue({
        accepted: ["person@onboarding.test"],
        rejected: [],
      });
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail: send,
      close: vi.fn(),
    } as never);
    expect(
      await f.user.action(api.teamOnboarding.startVerification, {}),
    ).toEqual({ sent: true, verified: false });
    const payload = send.mock.calls[0]![0] as {
      text: string;
    };
    const code = payload.text.match(/code is (\d{6})/)![1]!;
    const challenge = await f.t.run((ctx) =>
      ctx.db.query("emailVerifications").unique(),
    );
    expect(challenge?.codeHash).toHaveLength(64);
    expect(challenge).not.toHaveProperty("code");
    expect(
      await f.user.action(api.teamOnboarding.verifyEmail, { code }),
    ).toEqual({ verified: true });
    expect(await f.user.mutation(api.teams.accept, { invitationId })).toBe(
      workspaceId,
    );
    expect(
      await f.t.run((ctx) => ctx.db.query("emailVerifications").collect()),
    ).toHaveLength(0);
  });
  it("does not pretend verification email was sent when delivery is disabled", async () => {
    const f = await fixture();
    await expect(
      f.user.action(api.teamOnboarding.startVerification, {}),
    ).rejects.toThrow("not configured");
    expect(
      await f.t.run((ctx) => ctx.db.query("emailVerifications").collect()),
    ).toHaveLength(0);
  });
  it("queues one invitation and reports disabled delivery; revoked invites cannot be sent", async () => {
    const f = await fixture();
    const workspaceId = await f.user.mutation(
      api.users.ensurePersonalWorkspace,
      {},
    );
    const args = {
      workspaceId,
      email: "friend@onboarding.test",
      role: "creator" as const,
    };
    const invitationId = await f.user.mutation(api.teams.invite, args);
    await f.user.mutation(api.teams.invite, args);
    expect(
      await f.t.run((ctx) => ctx.db.query("apiTasks").collect()),
    ).toHaveLength(1);
    await f.t.action(internal.teamOnboarding.sendInvitation, {
      invitationId,
      generation: 1,
    });
    expect(
      (await f.user.query(api.teams.pending, { workspaceId }))[0]
        ?.emailDelivery,
    ).toBe("disabled");
    await f.user.mutation(api.teams.revoke, { invitationId });
    expect(
      await f.t.query(internal.teamOnboarding.invitationDelivery, {
        invitationId,
        generation: 1,
      }),
    ).toBeNull();
  });
  it("resends with a new generation, ignores stale completions and deduplicates provider retries", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const workspaceId = await f.user.mutation(
      api.users.ensurePersonalWorkspace,
      {},
    );
    const invitationId = await f.user.mutation(api.teams.invite, {
      workspaceId,
      email: "friend@onboarding.test",
      role: "creator",
    });
    await expect(
      f.user.mutation(api.teams.resendInvitation, { invitationId }),
    ).rejects.toThrow("Rate limit");
    vi.advanceTimersByTime(60_001);
    await f.user.mutation(api.teams.resendInvitation, { invitationId });
    await f.t.mutation(internal.teamOnboarding.recordDelivery, {
      invitationId,
      generation: 1,
      status: "sent",
    });
    expect(
      (await f.t.run((ctx) => ctx.db.get(invitationId)))?.emailDelivery,
    ).toBe("pending");
    vi.stubEnv("EMAIL_NOTIFICATIONS_ENABLED", "true");
    for (const [key, value] of Object.entries({
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "fixture",
      SMTP_PASSWORD: "fixture",
      SMTP_FROM_EMAIL: "cinakey@example.com",
    }))
      vi.stubEnv(key, value);
    const send = vi
      .fn()
      .mockResolvedValue({
        accepted: ["person@onboarding.test"],
        rejected: [],
      });
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail: send,
      close: vi.fn(),
    } as never);
    await f.t.action(internal.teamOnboarding.sendInvitation, {
      invitationId,
      generation: 2,
    });
    await f.t.action(internal.teamOnboarding.sendInvitation, {
      invitationId,
      generation: 2,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0].messageId).toMatch(
      /^<[a-f0-9]{64}@example.com>$/,
    );
    expect(
      (await f.t.run((ctx) => ctx.db.get(invitationId)))?.emailDelivery,
    ).toBe("sent");
  });
});
