import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { hasAdminPermission } from "@cinakey/shared";
import { mutation, query, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdminPermission } from "./lib/access";
import { appendAuditLog } from "./lib/audit";
import { assertRateLimit } from "./lib/rateLimit";
import { enqueueTask } from "./tasks";
const targetArgs = {
  targetType: v.union(v.literal("user"), v.literal("workspace")),
  targetId: v.string(),
};
const status = v.union(
  v.literal("open"),
  v.literal("investigating"),
  v.literal("waiting"),
  v.literal("resolved"),
);
const requestArgs = { reason: v.string(), requestId: v.string() };
async function target(
  ctx: QueryCtx | MutationCtx,
  args: { targetType: "user" | "workspace"; targetId: string },
) {
  const id = ctx.db.normalizeId(
    args.targetType === "user" ? "users" : "workspaces",
    args.targetId,
  );
  if (!id) throw new Error("Invalid support target");
  const row = await ctx.db.get(id);
  if (!row) throw new Error("Support target not found");
  return row;
}
async function once(
  ctx: MutationCtx,
  actorUserId: Id<"users">,
  args: { requestId: string; reason: string },
  fingerprint: string,
) {
  if (args.reason.trim().length < 10 || args.reason.length > 2000)
    throw new Error("Provide a reason of 10 to 2000 characters");
  if (!args.requestId.trim() || args.requestId.length > 128)
    throw new Error("Invalid request ID");
  const prior = await ctx.db
    .query("adminActionRequests")
    .withIndex("by_actor_request", (q) =>
      q.eq("actorUserId", actorUserId).eq("requestId", args.requestId),
    )
    .unique();
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      throw new Error("Administrative request mismatch");
    return false;
  }
  await assertRateLimit(ctx, `support:${actorUserId}`, 30, 60_000);
  await ctx.db.insert("adminActionRequests", {
    actorUserId,
    requestId: args.requestId,
    fingerprint,
    createdAt: Date.now(),
  });
  return true;
}
function pageSize(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw new Error("Page size must be 1 to 100");
}
export const detail = query({
  args: targetArgs,
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "support.read");
    const targetId = ctx.db.normalizeId(
      args.targetType === "user" ? "users" : "workspaces",
      args.targetId,
    );
    if (!targetId || !(await ctx.db.get(targetId))) return null;
    const row = await target(ctx, args);
    if ("email" in row || args.targetType === "user") {
      const userId = ctx.db.normalizeId("users", args.targetId)!;
      const user = await ctx.db.get(userId);
      if (!user) return null;
      const owned = await ctx.db
        .query("workspaces")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(26);
      const members = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(26);
      return {
        type: "user" as const,
        id: userId,
        name: user.name,
        email: user.email,
        isStaff: user.isStaff === true,
        supportRevision: user.supportRevision ?? 0,
        suspendedAt: user.suspendedAt,
        generationPausedAt: user.generationPausedAt,
        sessionsRevokedAt: user.sessionsRevokedAt,
        workspaces: owned
          .slice(0, 25)
          .map((w) => ({ id: w._id, name: w.name, role: "owner" })),
        memberships: members
          .slice(0, 25)
          .map((m) => ({ id: m.workspaceId, role: m.role })),
        truncated: owned.length > 25 || members.length > 25,
      };
    }
    const workspaceId = ctx.db.normalizeId("workspaces", args.targetId)!;
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) return null;
    const owner = await ctx.db.get(workspace.ownerUserId);
    const members = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(26);
    return {
      type: "workspace" as const,
      id: workspaceId,
      name: workspace.name,
      ownerUserId: workspace.ownerUserId,
      ownerEmail: owner?.email,
      supportRevision: workspace.supportRevision ?? 0,
      productionPausedAt: workspace.productionPausedAt,
      billingMode: workspace.billingMode ?? "paid",
      members: await Promise.all(
        members.slice(0, 25).map(async (m) => {
          const user = await ctx.db.get(m.userId);
          return { id: m.userId, email: user?.email, role: m.role };
        }),
      ),
      truncated: members.length > 25,
    };
  },
});
export const cases = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(status),
    targetType: v.optional(targetArgs.targetType),
    targetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "support.read");
    pageSize(args.paginationOpts.numItems);
    if (!!args.targetType !== !!args.targetId)
      throw new Error("Provide both target type and ID");
    const q =
      args.targetType && args.targetId
        ? ctx.db
            .query("supportCases")
            .withIndex("by_target_updated", (q) =>
              q
                .eq("targetType", args.targetType!)
                .eq("targetId", args.targetId!),
            )
        : ctx.db
            .query("supportCases")
            .withIndex("by_status_updated", (q) =>
              q.eq("status", args.status ?? "open"),
            );
    return q.order("desc").paginate({
      ...args.paginationOpts,
      maximumRowsRead: 200,
      maximumBytesRead: 1000000,
    });
  },
});
export const notes = query({
  args: { ...targetArgs, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdminPermission(ctx, "support.read");
    pageSize(args.paginationOpts.numItems);
    await target(ctx, args);
    const result = await ctx.db
      .query("supportNotes")
      .withIndex("by_target_created", (q) =>
        q.eq("targetType", args.targetType).eq("targetId", args.targetId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (n) => ({
          ...n,
          authorEmail: (await ctx.db.get(n.createdBy))?.email,
        })),
      ),
    };
  },
});
export const addNote = mutation({
  args: {
    ...targetArgs,
    ...requestArgs,
    caseId: v.optional(v.id("supportCases")),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "support.write");
    await target(ctx, args);
    if (args.caseId) {
      const c = await ctx.db.get(args.caseId);
      if (
        !c ||
        c.targetId !== args.targetId ||
        c.targetType !== args.targetType
      )
        throw new Error("Case target mismatch");
    }
    if (
      !(await once(
        ctx,
        actor._id,
        args,
        JSON.stringify({ action: "support.note", ...args }),
      ))
    )
      return;
    const id = await ctx.db.insert("supportNotes", {
      targetType: args.targetType,
      targetId: args.targetId,
      caseId: args.caseId,
      text: args.reason.trim(),
      createdBy: actor._id,
      createdAt: Date.now(),
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "support.note",
      targetType: args.targetType,
      targetId: args.targetId,
      requestId: args.requestId,
      meta: { noteId: id, caseId: args.caseId },
    });
  },
});
export const createCase = mutation({
  args: { ...targetArgs, ...requestArgs, subject: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "support.write");
    await target(ctx, args);
    if (args.subject.trim().length < 3 || args.subject.length > 160)
      throw new Error("Case subject must be 3 to 160 characters");
    if (
      !(await once(
        ctx,
        actor._id,
        args,
        JSON.stringify({ action: "support.case.create", ...args }),
      ))
    )
      return;
    const now = Date.now();
    const id = await ctx.db.insert("supportCases", {
      targetType: args.targetType,
      targetId: args.targetId,
      subject: args.subject.trim(),
      status: "open",
      createdBy: actor._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("supportNotes", {
      targetType: args.targetType,
      targetId: args.targetId,
      caseId: id,
      text: args.reason.trim(),
      createdBy: actor._id,
      createdAt: now,
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "support.case.create",
      targetType: args.targetType,
      targetId: args.targetId,
      requestId: args.requestId,
      meta: { caseId: id },
    });
  },
});
export const updateCase = mutation({
  args: {
    caseId: v.id("supportCases"),
    status,
    assignedTo: v.union(v.id("users"), v.null()),
    expectedUpdatedAt: v.number(),
    ...requestArgs,
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "support.write");
    if (
      !(await once(
        ctx,
        actor._id,
        args,
        JSON.stringify({ action: "support.case.update", ...args }),
      ))
    )
      return;
    const c = await ctx.db.get(args.caseId);
    if (!c) throw new Error("Case not found");
    if (c.updatedAt !== args.expectedUpdatedAt)
      throw new Error("Case changed; reload before updating");
    if (args.assignedTo) {
      const assignee = await ctx.db.get(args.assignedTo);
      if (
        !assignee ||
        assignee.suspendedAt !== undefined ||
        !hasAdminPermission(assignee, "support.write")
      )
        throw new Error("Assignee must be an active support administrator");
    }
    await ctx.db.patch(c._id, {
      status: args.status,
      assignedTo: args.assignedTo ?? undefined,
      updatedAt: Math.max(Date.now(), c.updatedAt + 1),
    });
    await ctx.db.insert("supportNotes", {
      targetType: c.targetType,
      targetId: c.targetId,
      caseId: c._id,
      text: args.reason.trim(),
      createdBy: actor._id,
      createdAt: Date.now(),
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "support.case.update",
      targetType: c.targetType,
      targetId: c.targetId,
      requestId: args.requestId,
      before: { status: c.status, assignedTo: c.assignedTo },
      after: { status: args.status, assignedTo: args.assignedTo },
      meta: { caseId: c._id },
    });
  },
});
export const restrict = mutation({
  args: {
    ...targetArgs,
    ...requestArgs,
    control: v.union(
      v.literal("suspend"),
      v.literal("generation"),
      v.literal("production"),
      v.literal("revoke_sessions"),
    ),
    enabled: v.boolean(),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPermission(ctx, "accounts.manage");
    const row = await target(ctx, args);
    if (
      (args.targetType === "workspace" && args.control !== "production") ||
      (args.targetType === "user" && args.control === "production")
    )
      throw new Error("Invalid restriction for target");
    if (
      args.targetType === "user" &&
      (("isStaff" in row && row.isStaff) || row._id === actor._id)
    )
      throw new Error(
        "Administrator accounts must be managed through Administration",
      );
    if (
      !(await once(
        ctx,
        actor._id,
        args,
        JSON.stringify({ action: "account.restrict", ...args }),
      ))
    )
      return;
    const revision = "supportRevision" in row ? (row.supportRevision ?? 0) : 0;
    if (revision !== args.expectedRevision)
      throw new Error("Account controls changed; reload before updating");
    const now = Date.now();
    if (args.targetType === "user") {
      const id = ctx.db.normalizeId("users", args.targetId)!;
      if (args.control === "revoke_sessions") {
        if (!args.enabled)
          throw new Error("Session revocation cannot be undone");
        await ctx.db.patch(id, {
          sessionsRevokedAt: now,
          supportRevision: revision + 1,
        });
        await enqueueTask(ctx, 0, "adminSupport:expireSessions", {
          userId: id,
          before: now,
        });
      } else
        await ctx.db.patch(id, {
          [args.control === "suspend" ? "suspendedAt" : "generationPausedAt"]:
            args.enabled ? now : undefined,
          supportRevision: revision + 1,
        });
    } else
      await ctx.db.patch(ctx.db.normalizeId("workspaces", args.targetId)!, {
        productionPausedAt: args.enabled ? now : undefined,
        supportRevision: revision + 1,
      });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: `account.${args.control}`,
      targetType: args.targetType,
      targetId: args.targetId,
      reason: args.reason,
      requestId: args.requestId,
      before: { revision },
      after: { enabled: args.enabled, revision: revision + 1 },
    });
  },
});
export const expireSessions = internalMutation({
  args: { userId: v.id("users"), before: v.number() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .filter((q) =>
        q.and(
          q.lt(q.field("_creationTime"), args.before + 1),
          q.gt(q.field("expirationTime"), Date.now()),
        ),
      )
      .take(100);
    for (const session of sessions)
      await ctx.db.patch(session._id, { expirationTime: Date.now() });
    if (sessions.length === 100)
      await enqueueTask(ctx, 0, "adminSupport:expireSessions", args);
  },
});
