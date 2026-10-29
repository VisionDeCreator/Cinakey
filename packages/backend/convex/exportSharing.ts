import { mediaUnavailable } from "./lib/mediaControls";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireProjectAccess, requireUser } from "./lib/access";
import { assertRateLimit } from "./lib/rateLimit";
import { appendAuditLog } from "./lib/audit";

async function activeLink(
  ctx: QueryCtx | MutationCtx,
  linkId: Id<"exportShareLinks">,
) {
  const link = await ctx.db.get(linkId);
  if (
    !link ||
    link.revokedAt !== undefined ||
    (link.expiresAt !== undefined && link.expiresAt <= Date.now())
  )
    throw new Error("Share unavailable");
  const publication = await ctx.db.get(link.publicationId);
  const project = publication && (await ctx.db.get(publication.projectId));
  if (
    !publication ||
    publication.state !== "ready" ||
    !publication.storageId ||
    !project ||
    project.archivedAt !== undefined
  )
    throw new Error("Share unavailable");
  if (await mediaUnavailable(ctx, publication.storageId))
    throw new Error("Share unavailable");
  return { link, publication };
}
export const createHashed = internalMutation({
  args: {
    publicationId: v.id("publishedExports"),
    secretHash: v.string(),
    passwordHash: v.optional(v.string()),
    allowDownload: v.boolean(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const publication = await ctx.db.get(args.publicationId);
    if (!publication || publication.state !== "ready")
      throw new Error("Only stored, ready exports can be shared");
    await requireProjectAccess(ctx, publication.projectId);
    if (!/^[a-f0-9]{64}$/.test(args.secretHash))
      throw new Error("Invalid link secret");
    if (
      args.expiresAt !== undefined &&
      (!Number.isFinite(args.expiresAt) ||
        args.expiresAt <= Date.now() ||
        args.expiresAt > Date.now() + 365 * 86400_000)
    )
      throw new Error("Share expiry must be within one year");
    await assertRateLimit(ctx, `share-create:${user._id}`, 30, 3600_000);
    const id = await ctx.db.insert("exportShareLinks", {
      ...args,
      projectId: publication.projectId,
      createdBy: user._id,
      createdAt: Date.now(),
    });
    await appendAuditLog(ctx, {
      actorUserId: user._id,
      action: "export.share_created",
      targetType: "exportShareLink",
      targetId: id,
    });
    return id;
  },
});
export const list = query({
  args: { publicationId: v.id("publishedExports") },
  handler: async (ctx, { publicationId }) => {
    const publication = await ctx.db.get(publicationId);
    if (!publication) throw new Error("Publication not found");
    await requireProjectAccess(ctx, publication.projectId);
    const rows = await ctx.db
      .query("exportShareLinks")
      .withIndex("by_publication", (q) => q.eq("publicationId", publicationId))
      .order("desc")
      .take(100);
    return rows.map(({ secretHash: _secret, passwordHash, ...link }) => ({
      ...link,
      passwordProtected: !!passwordHash,
    }));
  },
});
export const revoke = mutation({
  args: { linkId: v.id("exportShareLinks") },
  handler: async (ctx, { linkId }) => {
    const user = await requireUser(ctx);
    const link = await ctx.db.get(linkId);
    if (!link) throw new Error("Share not found");
    await requireProjectAccess(ctx, link.projectId);
    if (link.revokedAt !== undefined) return;
    await ctx.db.patch(linkId, { revokedAt: Date.now() });
    await appendAuditLog(ctx, {
      actorUserId: user._id,
      action: "export.share_revoked",
      targetType: "exportShareLink",
      targetId: linkId,
    });
  },
});
export const checkExchange = internalMutation({
  args: {
    linkId: v.id("exportShareLinks"),
    secretHash: v.string(),
    clientHash: v.string(),
  },
  handler: async (ctx, args) => {
    // This mutation commits before password verification, so wrong guesses cannot roll back the limits.
    await assertRateLimit(ctx, `share-client:${args.clientHash}`, 30, 600_000);
    await assertRateLimit(ctx, `share-link:${args.linkId}`, 100, 600_000);
    try {
      const { link } = await activeLink(ctx, args.linkId);
      if (link.secretHash !== args.secretHash) return null;
      return { passwordHash: link.passwordHash };
    } catch {
      return null;
    }
  },
});
export const openSession = internalMutation({
  args: {
    linkId: v.id("exportShareLinks"),
    secretHash: v.string(),
    tokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const { link } = await activeLink(ctx, args.linkId);
    if (link.secretHash !== args.secretHash)
      throw new Error("Share unavailable");
    const expiresAt = Math.min(
      Date.now() + 3600_000,
      link.expiresAt ?? Infinity,
    );
    await ctx.db.insert("exportViewerSessions", {
      linkId: link._id,
      tokenHash: args.tokenHash,
      expiresAt,
    });
    return { expiresAt };
  },
});
export const authorizeViewer = internalQuery({
  args: {
    linkId: v.id("exportShareLinks"),
    tokenHash: v.string(),
    download: v.boolean(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("exportViewerSessions")
      .withIndex("by_token", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (
      !session ||
      session.linkId !== args.linkId ||
      session.expiresAt <= Date.now()
    )
      throw new Error("Share unavailable");
    const result = await activeLink(ctx, args.linkId);
    if (args.download && !result.link.allowDownload)
      throw new Error("Download access denied");
    return {
      storageId: result.publication.storageId!,
      sizeBytes: result.publication.sizeBytes!,
      title: result.publication.title,
      durationSec: result.publication.durationSec,
      allowDownload: result.link.allowDownload,
      projectId: result.publication.projectId,
      workspaceId: result.publication.workspaceId,
      createdBy: result.publication.createdBy,
    };
  },
});
export const recordDelivery = internalMutation({
  args: {
    linkId: v.id("exportShareLinks"),
    tokenHash: v.string(),
    bytes: v.number(),
    download: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Recheck at delivery admission, never trust caller-provided workspace attribution.
    const session = await ctx.db
      .query("exportViewerSessions")
      .withIndex("by_token", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    const { link, publication } = await activeLink(ctx, args.linkId);
    if (
      !session ||
      session.linkId !== link._id ||
      session.expiresAt <= Date.now() ||
      (args.download && !link.allowDownload)
    )
      throw new Error("Share unavailable");
    if (
      !Number.isSafeInteger(args.bytes) ||
      args.bytes < 0 ||
      args.bytes > publication.sizeBytes!
    )
      throw new Error("Invalid delivery size");
    await assertRateLimit(ctx, `share-media:${link._id}`, 600, 60_000);
    await ctx.db.insert("egressEvents", {
      userId: publication.createdBy,
      workspaceId: publication.workspaceId,
      projectId: publication.projectId,
      bytes: args.bytes,
      kind: "share",
      createdAt: Date.now(),
    });
  },
});
