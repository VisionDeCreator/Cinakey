import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireUser, workspaceRole } from "./lib/access";
import { assertRateLimit } from "./lib/rateLimit";

export const issueVerification = internalMutation({
  args: { email: v.string(), codeHash: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (
      !user.email ||
      user.email.trim().toLowerCase() !== args.email ||
      user.emailVerificationTime !== undefined
    )
      throw new Error("Email verification is not available");
    if (!/^[a-f0-9]{64}$/.test(args.codeHash))
      throw new Error("Invalid verification hash");
    await assertRateLimit(
      ctx,
      `email-verification-minute:${user._id}`,
      1,
      60_000,
    );
    await assertRateLimit(
      ctx,
      `email-verification-hour:${user._id}`,
      5,
      3600_000,
    );
    const existing = await ctx.db
      .query("emailVerifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    const value = {
      userId: user._id,
      email: args.email,
      codeHash: args.codeHash,
      expiresAt: Date.now() + 600_000,
      attempts: 0,
      createdAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert("emailVerifications", value);
  },
});
export const consumeVerification = internalMutation({
  args: { codeHash: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (user.emailVerificationTime !== undefined) return { verified: true };
    const challenge = await ctx.db
      .query("emailVerifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (
      !challenge ||
      challenge.expiresAt <= Date.now() ||
      challenge.email !== user.email?.trim().toLowerCase() ||
      challenge.attempts >= 5
    )
      return { verified: false };
    // Return rejection rather than throwing so failed-attempt counters commit.
    await ctx.db.patch(challenge._id, { attempts: challenge.attempts + 1 });
    if (challenge.codeHash !== args.codeHash) return { verified: false };
    await ctx.db.patch(user._id, { emailVerificationTime: Date.now() });
    await ctx.db.delete(challenge._id);
    return { verified: true };
  },
});
export const invitationDelivery = internalQuery({
  args: { invitationId: v.id("workspaceInvitations"), generation: v.number() },
  handler: async (ctx, { invitationId, generation }) => {
    const invitation = await ctx.db.get(invitationId);
    if (
      !invitation ||
      invitation.acceptedBy ||
      invitation.revokedAt ||
      invitation.expiresAt <= Date.now() ||
      invitation.deliveryGeneration !== generation ||
      invitation.emailDelivery === "sent"
    )
      return null;
    const role = await workspaceRole(
      ctx,
      invitation.workspaceId,
      invitation.invitedBy,
    );
    if (role !== "owner" && role !== "admin") return null;
    const workspace = await ctx.db.get(invitation.workspaceId);
    return workspace
      ? {
          email: invitation.email,
          workspaceName: workspace.name,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        }
      : null;
  },
});
export const recordDelivery = internalMutation({
  args: {
    invitationId: v.id("workspaceInvitations"),
    generation: v.number(),
    status: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("disabled"),
    ),
  },
  handler: async (ctx, { invitationId, generation, status }) => {
    const invitation = await ctx.db.get(invitationId);
    if (
      invitation?.deliveryGeneration === generation &&
      invitation.emailDelivery !== "sent"
    )
      await ctx.db.patch(invitationId, { emailDelivery: status });
  },
});
