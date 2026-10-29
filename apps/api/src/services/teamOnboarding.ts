import { v } from "convex/values";
import { action, internalAction } from "../runtime/operation";
import { api, internal } from "../operations";
import { smtpConfiguration } from "./smtp";
import { serverEnv } from "../config/env";

async function verificationHash(userId: string, email: string, code: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${userId}:${email}:${code}`),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export const startVerification = action({
  args: {},
  handler: async (ctx): Promise<{ sent: boolean; verified: boolean }> => {
    const user = await ctx.runQuery(api.users.viewer, {});
    if (!user?.email) throw new Error("Sign in with an email account first");
    if (user.emailVerificationTime !== undefined)
      return { sent: false, verified: true };
    if (!smtpConfiguration())
      throw new Error(
        "Email delivery is not configured. Contact the workspace owner.",
      );
    const email = user.email.trim().toLowerCase();
    const random = new Uint32Array(1);
    do {
      crypto.getRandomValues(random);
    } while (random[0]! >= 4_294_000_000);
    const code = String(random[0]! % 1_000_000).padStart(6, "0");
    await ctx.runMutation(internal.teamOnboarding.issueVerification, {
      email,
      codeHash: await verificationHash(user._id, email, code),
    });
    const result = await ctx.runAction(internal.email.sendNotificationEmail, {
      to: email,
      subject: "Verify your Dirrio email",
      text: `Your Dirrio verification code is ${code}.\n\nIt expires in 10 minutes. Enter it in Settings to verify your email and accept team invitations.\n\nIf you did not request this code, you can ignore this email.`,
    });
    if (!result.sent)
      throw new Error(
        "Email could not be sent. Please try again after delivery is configured.",
      );
    return { sent: true, verified: false };
  },
});
export const verifyEmail = action({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<{ verified: boolean }> => {
    const user = await ctx.runQuery(api.users.viewer, {});
    if (!user?.email) throw new Error("Sign in first");
    if (!/^\d{6}$/.test(code))
      throw new Error("Enter the six-digit verification code");
    const result = await ctx.runMutation(
      internal.teamOnboarding.consumeVerification,
      {
        codeHash: await verificationHash(
          user._id,
          user.email.trim().toLowerCase(),
          code,
        ),
      },
    );
    if (!result.verified)
      throw new Error(
        "Code is incorrect or expired. Request a new code if needed.",
      );
    return result;
  },
});
export const sendInvitation = internalAction({
  args: { invitationId: v.id("workspaceInvitations"), generation: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const invitation = await ctx.runQuery(
      internal.teamOnboarding.invitationDelivery,
      args,
    );
    if (!invitation) return;
    const site = new URL(serverEnv("SITE_URL") ?? "https://app.dirrio.com");
    const link = new URL("/settings", site).toString();
    try {
      const result = await ctx.runAction(internal.email.sendNotificationEmail, {
        to: invitation.email,
        subject: `Join ${invitation.workspaceName} on Dirrio`,
        text: `You have been invited to ${invitation.workspaceName} as ${invitation.role}.\n\nOpen ${link}\n\nSign in or create an account using this email address, verify your email in Settings, then accept the invitation. It expires at ${new Date(invitation.expiresAt).toUTCString()}.`,
        idempotencyKey: `team-invitation:${args.invitationId}:${args.generation}`,
      });
      await ctx.runMutation(internal.teamOnboarding.recordDelivery, {
        ...args,
        status: result.sent ? "sent" : "disabled",
      });
    } catch (error) {
      await ctx.runMutation(internal.teamOnboarding.recordDelivery, {
        ...args,
        status: "failed",
      });
      throw error;
    }
  },
});
