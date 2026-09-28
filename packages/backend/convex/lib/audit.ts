import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function appendAuditLog(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"users">;
    action: string;
    targetType?: string;
    targetId?: string;
    reason?: string;
    meta?: Record<string, unknown>;
  },
): Promise<Id<"auditLog">> {
  return await ctx.db.insert("auditLog", {
    actorUserId: args.actorUserId,
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    reason: args.reason,
    meta: args.meta !== undefined ? JSON.stringify(args.meta) : undefined,
    createdAt: Date.now(),
  });
}
