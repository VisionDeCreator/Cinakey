import { convexEnv } from "./env";
import { appendLedgerEntry } from "./ledger";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { STARTER_USD_MICROS } from "./limits";

/**
 * Create a personal workspace for a user and link it on the user doc.
 * No-ops if the user already has a personalWorkspaceId.
 * Grants one-time starter usdMicros on first create.
 */
export async function ensurePersonalWorkspaceForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Id<"workspaces">> {
  const user = await ctx.db.get(userId);
  if (user === null) {
    throw new Error("User not found");
  }
  if (user.personalWorkspaceId !== undefined) {
    const existing = await ctx.db.get(user.personalWorkspaceId);
    if (existing !== null && existing.ownerUserId === userId) {
      await maybeGrantStarterBalance(ctx, existing._id, userId);
      return existing._id;
    }
  }

  const now = Date.now();
  const name =
    user.name !== undefined && user.name.length > 0
      ? `${user.name}'s Workspace`
      : user.email !== undefined
        ? `${user.email}'s Workspace`
        : "Personal Workspace";

  const workspaceId = await ctx.db.insert("workspaces", {
    name,
    ownerUserId: userId,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.patch(userId, { personalWorkspaceId: workspaceId });
  await maybeGrantStarterBalance(ctx, workspaceId, userId);
  return workspaceId;
}

async function maybeGrantStarterBalance(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
): Promise<void> {
  if (
    convexEnv("ALLOW_DEV_USD") !== "true" &&
    convexEnv("USE_MOCK_ADAPTERS") !== "true"
  )
    return;
  const workspace = await ctx.db.get(workspaceId);
  if (workspace === null) return;
  if (workspace.starterBalanceGrantedAt !== undefined) return;

  // Development funding fixture, not a paid subscription allowance.
  const now = Date.now();
  await appendLedgerEntry(ctx, {
    workspaceId,
    userId,
    delta: STARTER_USD_MICROS,
    reason: "grant",
    requestId: "development-starter",
  });
  await ctx.db.patch(workspaceId, {
    starterBalanceGrantedAt: now,
    updatedAt: now,
  });
}
