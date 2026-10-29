import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function appendAuditLog(
  ctx: MutationCtx,
  args: {
    action: string;
    requestId?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    targetType?: string;
    targetId?: string;
    reason?: string;
    meta?: Record<string, unknown>;
  } & (
    | { actorUserId: Id<"users">; actorType?: "user" }
    | { actorType: "operator"; actorUserId?: never }
  ),
): Promise<Id<"auditLog">> {
  return await ctx.db.insert("auditLog", {
    actorUserId: args.actorUserId,
    actorType: args.actorType,
    action: args.action,
    requestId: args.requestId,
    outcome: "succeeded",
    before: args.before ? JSON.stringify(args.before) : undefined,
    after: args.after ? JSON.stringify(args.after) : undefined,
    targetType: args.targetType,
    targetId: args.targetId,
    reason: args.reason,
    meta: args.meta !== undefined ? JSON.stringify(args.meta) : undefined,
    createdAt: Date.now(),
  });
}
