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
  const userId = await ctx.db.insert("users", {
    email,
    emailVerificationTime: Date.now(),
    ...profile,
  });
  await ensurePersonalWorkspaceForUser(ctx, userId);
  return userId;
}
