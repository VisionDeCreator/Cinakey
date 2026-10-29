import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
type Ctx = QueryCtx | MutationCtx;
export async function generationRestriction(
  ctx: Ctx,
  userId: Id<"users">,
  workspaceId: Id<"workspaces">,
) {
  const user = await ctx.db.get(userId),
    workspace = await ctx.db.get(workspaceId);
  if (!user || user.suspendedAt !== undefined)
    return "This account is suspended. Contact support.";
  if (user.generationPausedAt !== undefined)
    return "Generation is paused for this account. Contact support.";
  if (workspace?.productionPausedAt !== undefined)
    return "Production is paused for this workspace. Contact support.";
  return null;
}
export async function assertGenerationAllowed(
  ctx: Ctx,
  userId: Id<"users">,
  workspaceId: Id<"workspaces">,
) {
  const message = await generationRestriction(ctx, userId, workspaceId);
  if (message) throw new ConvexError({ code: "ACCOUNT_RESTRICTED", message });
}
export async function assertUploadAllowed(
  ctx: Ctx,
  upload: {
    createdBy: Id<"users">;
    workspaceId: Id<"workspaces">;
    _creationTime: number;
  },
) {
  const user = await ctx.db.get(upload.createdBy),
    workspace = await ctx.db.get(upload.workspaceId);
  if (
    !user ||
    user.suspendedAt !== undefined ||
    workspace?.productionPausedAt !== undefined ||
    (user.sessionsRevokedAt !== undefined &&
      Math.floor(upload._creationTime) <= user.sessionsRevokedAt)
  )
    throw new Error("Upload access was restricted. Contact support.");
}
