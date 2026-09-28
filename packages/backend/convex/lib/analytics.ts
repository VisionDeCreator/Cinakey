import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function trackEvent(
  ctx: MutationCtx,
  args: {
    name: string;
    userId?: Id<"users">;
    workspaceId?: Id<"workspaces">;
    projectId?: Id<"projects">;
    value?: number;
  },
): Promise<void> {
  await ctx.db.insert("analyticsEvents", {
    name: args.name,
    userId: args.userId,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    value: args.value,
    createdAt: Date.now(),
  });
}
