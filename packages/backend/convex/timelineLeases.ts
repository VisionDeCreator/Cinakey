import { requireProjectWrite } from "./lib/access";
import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireProjectAccess, requireUser, workspaceRole } from "./lib/access";
import { appendAuditLog } from "./lib/audit";

const TTL = 90_000;
const credentials = { sessionId: v.string(), fence: v.number() };

export async function assertTimelineLease(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  userId: Id<"users">,
  sessionId: string,
  fence: number,
) {
  await requireProjectWrite(ctx, projectId);
  const lease = await ctx.db
    .query("timelineLeases")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
  if (
    !lease ||
    lease.userId !== userId ||
    lease.sessionId !== sessionId ||
    lease.fence !== fence ||
    lease.expiresAt <= Date.now()
  ) {
    throw new ConvexError({
      code: "TIMELINE_LEASE_LOST",
      message:
        "Editing access expired or moved to another session. Your local draft is preserved.",
    });
  }
  return lease;
}

export const claim = mutation({
  args: {
    projectId: v.id("projects"),
    sessionId: v.string(),
    takeover: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const project = await requireProjectWrite(ctx, args.projectId);
    if (!args.sessionId || args.sessionId.length > 128)
      throw new Error("Invalid editor session");
    const role = await workspaceRole(ctx, project.workspaceId, user._id);
    const canTakeover = role === "owner" || role === "admin";
    const lease = await ctx.db
      .query("timelineLeases")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    const occupied = lease && lease.expiresAt > Date.now();
    const own =
      occupied &&
      lease.userId === user._id &&
      lease.sessionId === args.sessionId;
    if (occupied && !own && !args.takeover) {
      const editor = await ctx.db.get(lease.userId);
      return {
        held: false as const,
        editor: editor?.name ?? editor?.email ?? "A teammate",
        canTakeover,
        expiresAt: lease.expiresAt,
      };
    }
    if (args.takeover && !canTakeover)
      throw new Error("Only workspace Owners and Admins can take over editing");
    const fence = own ? lease.fence : (lease?.fence ?? 0) + 1;
    const expiresAt = Date.now() + TTL;
    const value = {
      projectId: args.projectId,
      userId: user._id,
      sessionId: args.sessionId,
      fence,
      expiresAt,
    };
    if (lease) await ctx.db.replace(lease._id, value);
    else await ctx.db.insert("timelineLeases", value);
    if (occupied && !own && args.takeover)
      await appendAuditLog(ctx, {
        actorUserId: user._id,
        action: "timeline.editing_taken_over",
        targetType: "project",
        targetId: args.projectId,
        meta: { previousUserId: lease.userId },
      });
    return { held: true as const, fence, expiresAt, canTakeover };
  },
});

export const renew = mutation({
  args: { projectId: v.id("projects"), ...credentials },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await requireProjectAccess(ctx, args.projectId);
    const lease = await assertTimelineLease(
      ctx,
      args.projectId,
      user._id,
      args.sessionId,
      args.fence,
    );
    const expiresAt = Date.now() + TTL;
    await ctx.db.patch(lease._id, { expiresAt });
    return { expiresAt };
  },
});

export const release = mutation({
  args: { projectId: v.id("projects"), ...credentials },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const lease = await ctx.db
      .query("timelineLeases")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (
      lease?.userId === user._id &&
      lease.sessionId === args.sessionId &&
      lease.fence === args.fence
    )
      await ctx.db.patch(lease._id, { expiresAt: 0 });
  },
});
