import { registrationPolicy } from "./registrationPolicy";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { ensurePersonalWorkspaceForUser } from "./workspaces";

export function normalizeAuthEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a valid email address");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
    throw new Error("Enter a valid email address");
  return email;
}
export async function authDigest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Called only after email possession has been proved by OTP or verified Google profile. */
export async function verifiedEmailUser(
  ctx: MutationCtx,
  email: string,
  existingUserId: Id<"users"> | null = null,
  profile: { name?: string; image?: string } = {},
): Promise<Id<"users">> {
  const matches = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .take(2);
  if (
    matches.length > 1 ||
    (existingUserId && matches.some((u) => u._id !== existingUserId))
  )
    throw new Error(
      "This email needs account assistance. Contact Cinakey support.",
    );
  const existing = existingUserId
    ? await ctx.db.get(existingUserId)
    : matches[0];
  if (existingUserId && !existing) throw new Error("Account is unavailable");
  // Existing accounts (including staff) retain access at cutover. Every new
  // account follows the current registration policy; verification never grants roles.
  if (existing) {
    if (existing.suspendedAt !== undefined)
      throw new Error("This account is suspended. Contact support.");
    // Never replace the user record or touch roles, ownership, balances or preferences.
    await ctx.db.patch(existing._id, {
      email,
      emailVerificationTime: Date.now(),
    });
    if (!existing.personalWorkspaceId)
      await ensurePersonalWorkspaceForUser(ctx, existing._id);
    return existing._id;
  }
  const approval = await ctx.db
    .query("earlyAccessRequests")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (
    (await registrationPolicy(ctx)).requireApproval &&
    approval?.status !== "approved"
  )
    throw new Error(
      "Waitlist approval is required. Join the waitlist or wait for your approval email.",
    );
  const userId = await ctx.db.insert("users", {
    email,
    emailVerificationTime: Date.now(),
    ...profile,
  });
  if (approval)
    await ctx.db.patch(approval._id, {
      registeredUserId: userId,
      registeredAt: Date.now(),
    });
  await ensurePersonalWorkspaceForUser(ctx, userId);
  return userId;
}
