import { paymentState, assertSeatAvailable } from "./lib/paymentAccess";
import { enqueueTask } from "./tasks";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  canAccessProject,
  accessibleWorkspaceIds,
  requireUser,
  requireWorkspaceAccess,
  workspaceRole,
} from "./lib/access";
import { appendAuditLog } from "./lib/audit";
import { assertRateLimit } from "./lib/rateLimit";

const role = v.union(
  v.literal("admin"),
  v.literal("creator"),
  v.literal("reviewer"),
);
const workspaceArgs = { workspaceId: v.id("workspaces") };

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await Promise.all(
      (await accessibleWorkspaceIds(ctx, user)).map(async (id) => {
        const workspace = await ctx.db.get(id);
        return workspace
          ? { workspace, role: await workspaceRole(ctx, id, user._id) }
          : null;
      }),
    );
    return rows.filter((r) => r !== null);
  },
});

export const members = query({
  args: workspaceArgs,
  handler: async (ctx, args) => {
    const workspace = await requireWorkspaceAccess(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const people = await Promise.all(
      rows.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return {
          userId: m.userId,
          role: m.role as string,
          email: user?.email ?? "Deleted account",
          name: user?.name,
        };
      }),
    );
    const owner = await ctx.db.get(workspace.ownerUserId);
    return [
      {
        userId: workspace.ownerUserId,
        role: "owner",
        email: owner?.email ?? "",
        name: owner?.name,
      },
      ...people,
    ];
  },
});

export const invitations = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!user.email || user.emailVerificationTime === undefined) return [];
    const rows = await ctx.db
      .query("workspaceInvitations")
      .withIndex("by_email", (q) =>
        q.eq("email", user.email!.trim().toLowerCase()),
      )
      .collect();
    return await Promise.all(
      rows
        .filter(
          (i) => !i.acceptedBy && !i.revokedAt && i.expiresAt > Date.now(),
        )
        .map(async (i) => ({
          ...i,
          workspaceName:
            (await ctx.db.get(i.workspaceId))?.name ?? "Unavailable workspace",
        })),
    );
  },
});

export const pending = query({
  args: workspaceArgs,
  handler: async (ctx, args) => {
    await requireWorkspaceAccess(ctx, args.workspaceId);
    return (
      await ctx.db
        .query("workspaceInvitations")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect()
    ).filter((i) => !i.acceptedBy && !i.revokedAt && i.expiresAt > Date.now());
  },
});

export const invite = mutation({
  args: { ...workspaceArgs, email: v.string(), role },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspaceAccess(ctx, args.workspaceId);
    const actor = await requireUser(ctx);
    const actorRole = await workspaceRole(ctx, args.workspaceId, actor._id);
    if (actorRole !== "owner" && actorRole !== "admin")
      throw new Error("Workspace administration required");
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      throw new Error("Enter a valid email address");
    const owner = await ctx.db.get(workspace.ownerUserId);
    if (owner?.email?.toLowerCase() === email)
      throw new Error("The owner already belongs to this workspace");
    await assertRateLimit(ctx, `invite:${actor._id}`, 30, 60_000);
    const existing = (
      await ctx.db
        .query("workspaceInvitations")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect()
    ).find(
      (i) =>
        i.email === email &&
        !i.acceptedBy &&
        !i.revokedAt &&
        i.expiresAt > Date.now(),
    );
    if (existing) return existing._id;
    const id = await ctx.db.insert("workspaceInvitations", {
      ...args,
      email,
      emailDelivery: "pending",
      deliveryGeneration: 1,
      invitedBy: actor._id,
      expiresAt: Date.now() + 7 * 86400_000,
      createdAt: Date.now(),
    });
    await assertRateLimit(ctx, `invitation-email:${id}`, 1, 60_000);
    await enqueueTask(ctx, 0, "teamOnboarding:sendInvitation", {
      invitationId: id,
      generation: 1,
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "team.invited",
      targetType: "workspaceInvitations",
      targetId: id,
    });
    return id;
  },
});

export const resendInvitation = mutation({
  args: { invitationId: v.id("workspaceInvitations") },
  handler: async (ctx, { invitationId }) => {
    const actor = await requireUser(ctx);
    const invitation = await ctx.db.get(invitationId);
    if (!invitation) throw new Error("Invitation not found");
    const actorRole = await workspaceRole(
      ctx,
      invitation.workspaceId,
      actor._id,
    );
    if (actorRole !== "owner" && actorRole !== "admin")
      throw new Error("Workspace administration required");
    if (
      invitation.revokedAt ||
      invitation.acceptedBy ||
      invitation.expiresAt <= Date.now()
    )
      throw new Error("Invitation is no longer available");
    await assertRateLimit(ctx, `invitation-email:${invitationId}`, 1, 60_000);
    await assertRateLimit(ctx, `invitation-resend:${actor._id}`, 10, 3600_000);
    const generation = (invitation.deliveryGeneration ?? 0) + 1;
    await ctx.db.patch(invitationId, {
      emailDelivery: "pending",
      deliveryGeneration: generation,
      invitedBy: actor._id,
    });
    await enqueueTask(ctx, 0, "teamOnboarding:sendInvitation", {
      invitationId,
      generation,
    });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "team.invitation_resent",
      targetId: invitationId,
    });
  },
});

export const accept = mutation({
  args: { invitationId: v.id("workspaceInvitations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const invitation = await ctx.db.get(args.invitationId);
    if (
      !invitation ||
      !user.email ||
      user.emailVerificationTime === undefined ||
      invitation.email !== user.email.trim().toLowerCase()
    )
      throw new Error(
        "Invitation access denied; verify the invited email first",
      );
    if (invitation.acceptedBy === user._id) return invitation.workspaceId;
    if (
      invitation.acceptedBy ||
      invitation.revokedAt ||
      invitation.expiresAt <= Date.now()
    )
      throw new Error("Invitation is no longer available");
    const workspace = await ctx.db.get(invitation.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    // Revoking the inviter's administration also invalidates unaccepted invitations.
    const inviterRole = await workspaceRole(
      ctx,
      invitation.workspaceId,
      invitation.invitedBy,
    );
    if (inviterRole !== "owner" && inviterRole !== "admin")
      throw new Error("Invitation is no longer available");
    const current = await workspaceRole(ctx, invitation.workspaceId, user._id);
    if (!current && invitation.role !== "reviewer")
      await assertSeatAvailable(ctx, invitation.workspaceId);
    if (!current)
      await ctx.db.insert("workspaceMembers", {
        workspaceId: invitation.workspaceId,
        userId: user._id,
        role: invitation.role,
        createdAt: Date.now(),
      });
    await ctx.db.patch(invitation._id, { acceptedBy: user._id });
    await appendAuditLog(ctx, {
      actorUserId: user._id,
      action: "team.joined",
      targetType: "workspaces",
      targetId: invitation.workspaceId,
    });
    return invitation.workspaceId;
  },
});

export const revoke = mutation({
  args: { invitationId: v.id("workspaceInvitations") },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new Error("Invitation not found");
    await requireWorkspaceAccess(ctx, invitation.workspaceId);
    const actor = await requireUser(ctx);
    await ctx.db.patch(invitation._id, { revokedAt: Date.now() });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "team.invitation_revoked",
      targetId: invitation._id,
    });
  },
});

export const changeMember = mutation({
  args: {
    ...workspaceArgs,
    userId: v.id("users"),
    role: v.union(role, v.literal("remove")),
  },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspaceAccess(ctx, args.workspaceId);
    const actor = await requireUser(ctx);
    if (args.userId === workspace.ownerUserId)
      throw new Error("The workspace owner cannot be changed here");
    const member = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.userId),
      )
      .unique();
    if (!member) throw new Error("Member not found");
    if (
      member.role === "reviewer" &&
      args.role !== "remove" &&
      args.role !== "reviewer"
    )
      await assertSeatAvailable(ctx, args.workspaceId);
    if (args.role === "remove") await ctx.db.delete(member._id);
    else await ctx.db.patch(member._id, { role: args.role });
    // Assignments must not survive removal or downgrade into review-only access.
    if (args.role === "remove" || args.role === "reviewer") {
      const assignments = await ctx.db
        .query("productionAssignments")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("userId", args.userId),
        )
        .collect();
      for (const assignment of assignments) await ctx.db.delete(assignment._id);
    }
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "team.member_changed",
      targetId: args.userId,
      meta: { workspaceId: args.workspaceId, role: args.role },
    });
  },
});

export const assign = mutation({
  args: {
    ...workspaceArgs,
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    seriesId: v.optional(v.id("series")),
    enabled: v.boolean(),
    manageReviews: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceAccess(ctx, args.workspaceId);
    const actor = await requireUser(ctx);
    if (!!args.projectId === !!args.seriesId)
      throw new Error("Choose one project or series");
    if ((await workspaceRole(ctx, args.workspaceId, args.userId)) !== "creator")
      throw new Error("Assignments require an active Creator member");
    const resource = args.projectId
      ? await ctx.db.get(args.projectId)
      : await ctx.db.get(args.seriesId!);
    if (!resource || resource.workspaceId !== args.workspaceId)
      throw new Error("Production/workspace mismatch");
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (project?.purpose === "genjutsu")
        throw new Error(
          "Assign production projects or series, not transformation sessions",
        );
    }
    const rows = await ctx.db
      .query("productionAssignments")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.userId),
      )
      .collect();
    const existing = rows.find(
      (a) => a.projectId === args.projectId && a.seriesId === args.seriesId,
    );
    if (!args.enabled) {
      if (existing) await ctx.db.delete(existing._id);
    } else if (existing)
      await ctx.db.patch(existing._id, {
        manageReviews: args.manageReviews ?? false,
      });
    else
      await ctx.db.insert("productionAssignments", {
        workspaceId: args.workspaceId,
        userId: args.userId,
        projectId: args.projectId,
        seriesId: args.seriesId,
        manageReviews: args.manageReviews ?? false,
      });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "team.assignment_changed",
      targetId: args.projectId ?? args.seriesId,
      meta: { userId: args.userId, enabled: args.enabled },
    });
  },
});

export const assignments = query({
  args: { ...workspaceArgs, userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireWorkspaceAccess(ctx, args.workspaceId);
    return ctx.db
      .query("productionAssignments")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.userId),
      )
      .collect();
  },
});

/** Administration-only production picker; never returns another workspace's records. */
export const productions = query({
  args: workspaceArgs,
  handler: async (ctx, args) => {
    await requireWorkspaceAccess(ctx, args.workspaceId);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const series = await ctx.db
      .query("series")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    return {
      projects: projects.filter(
        (p) => !p.archivedAt && p.purpose !== "genjutsu",
      ),
      series: series.filter((s) => !s.archivedAt),
    };
  },
});

/** Used only to align workspace chrome with an explicitly opened production URL. */
export const routeWorkspace = query({
  args: {
    projectId: v.optional(v.id("projects")),
    seriesId: v.optional(v.id("series")),
    sessionId: v.optional(v.id("genjutsuSessions")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (
      [args.projectId, args.seriesId, args.sessionId].filter(Boolean).length !==
      1
    )
      throw new Error("Choose one production");
    if (args.seriesId) {
      const series = await ctx.db.get(args.seriesId);
      if (!series) return null;
      const role = await workspaceRole(ctx, series.workspaceId, user._id);
      return role === "owner" || role === "admin" ? series.workspaceId : null;
    }
    const projectId =
      args.projectId ??
      (args.sessionId
        ? (await ctx.db.get(args.sessionId))?.storageScopeId
        : undefined);
    const project = projectId ? await ctx.db.get(projectId) : null;
    return project && (await canAccessProject(ctx, project, user))
      ? project.workspaceId
      : null;
  },
});

export const rename = mutation({
  args: { ...workspaceArgs, name: v.string() },
  handler: async (ctx, args) => {
    await requireWorkspaceAccess(ctx, args.workspaceId);
    const name = args.name.trim();
    if (!name || name.length > 120)
      throw new Error("Workspace name must be 1–120 characters");
    await ctx.db.patch(args.workspaceId, { name, updatedAt: Date.now() });
    const actor = await requireUser(ctx);
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "team.renamed",
      targetId: args.workspaceId,
    });
  },
});

export const transferOwnership = mutation({
  args: { ...workspaceArgs, newOwnerId: v.id("users") },
  handler: async (ctx, args) => {
    const actor = await requireUser(ctx);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace || workspace.ownerUserId !== actor._id)
      throw new Error("Only the workspace owner can transfer ownership");
    const billingSetup = await ctx.db
      .query("paymentCheckouts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .first();
    if (billingSetup || (await paymentState(ctx, args.workspaceId))?.customerId)
      throw new Error(
        "Payment-linked workspace ownership transfers require billing support so the previous owner cannot retain portal access",
      );
    if (args.newOwnerId === actor._id)
      throw new Error("Choose another active member");
    const next = await ctx.db.get(args.newOwnerId);
    const nextRole = await workspaceRole(
      ctx,
      args.workspaceId,
      args.newOwnerId,
    );
    if (
      !next ||
      next.emailVerificationTime === undefined ||
      (nextRole !== "admin" && nextRole !== "creator")
    )
      throw new Error("Choose a verified active Admin or Creator");
    const nextMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.newOwnerId),
      )
      .unique();
    if (!nextMembership) throw new Error("Member not found");
    await ctx.db.delete(nextMembership._id);
    await ctx.db.insert("workspaceMembers", {
      workspaceId: args.workspaceId,
      userId: actor._id,
      role: "admin",
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.workspaceId, {
      ownerUserId: args.newOwnerId,
      updatedAt: Date.now(),
    });
    if (actor.personalWorkspaceId === args.workspaceId)
      await ctx.db.patch(actor._id, { personalWorkspaceId: undefined });
    await appendAuditLog(ctx, {
      actorUserId: actor._id,
      action: "team.ownership_transferred",
      targetId: args.workspaceId,
      meta: { newOwnerId: args.newOwnerId },
    });
  },
});
