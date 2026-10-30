import { writeHelpArticle, customerHelpArticle } from "./lib/helpArticles";
import { mediaUnavailable } from "./lib/mediaControls";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { hasAdminPermission } from "@dirrio/shared";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import {
  requireUser,
  requireAdminPermission,
  workspaceRole,
} from "./lib/access";
import { appendAuditLog } from "./lib/audit";
import { assertRateLimit } from "./lib/rateLimit";
import { paidWorkPause } from "./lib/providerControls";
import { DEEPSEEK_MODEL } from "@dirrio/shared";
import { enqueueTask } from "./tasks";
const conversationId = v.id("supportConversations");
const locale = (s: string) => {
  if (!["en", "fr", "es", "ko", "ja", "zh"].includes(s))
    throw new Error("Unsupported language");
  return s;
};
async function access(
  ctx: QueryCtx | MutationCtx,
  id: Id<"supportConversations">,
  staff = false,
) {
  const user = staff
    ? await requireAdminPermission(ctx, "support.read")
    : await requireUser(ctx, true);
  const row = await ctx.db.get(id);
  if (!row || (!staff && row.userId !== user._id))
    throw new Error("Conversation unavailable");
  return { user, row };
}
async function audit(
  ctx: MutationCtx,
  actor: Id<"users">,
  id: string,
  action: string,
) {
  await appendAuditLog(ctx, {
    actorUserId: actor,
    targetType: "supportConversation",
    targetId: id,
    action,
  });
}
export const conversations = query({
  args: { staff: v.boolean(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = args.staff
      ? await requireAdminPermission(ctx, "support.read")
      : await requireUser(ctx, true);
    const page = await (
      args.staff
        ? ctx.db.query("supportConversations").withIndex("by_updated")
        : ctx.db
            .query("supportConversations")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
    )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(50, args.paginationOpts.numItems),
      });
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (row) => ({
          ...row,
          customer: args.staff
            ? (await ctx.db.get(row.userId))?.email
            : undefined,
        })),
      ),
    };
  },
});
export const start = mutation({
  args: {
    language: v.string(),
    requestId: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    locale(args.language);
    if (!args.requestId || args.requestId.length > 128)
      throw new Error("Invalid request ID");
    const previous = await ctx.db
      .query("supportConversations")
      .withIndex("by_user_request", (q) =>
        q.eq("userId", user._id).eq("startRequestId", args.requestId),
      )
      .unique();
    if (previous) return previous._id;
    if (
      args.workspaceId &&
      !(await workspaceRole(ctx, args.workspaceId, user._id))
    )
      throw new Error("Workspace unavailable");
    // An empty conversation is reusable, making uncertain creation retries harmless.
    const last = await ctx.db
      .query("supportConversations")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    if (last && last.sequence === 0 && last.workspaceId === args.workspaceId)
      return last._id;
    await assertRateLimit(ctx, `support:start:${user._id}`, 10, 60_000);
    return ctx.db.insert("supportConversations", {
      userId: user._id,
      workspaceId: args.workspaceId,
      startRequestId: args.requestId,
      subject: "New conversation",
      language: args.language,
      mode: "ai",
      status: "customer",
      revision: 0,
      sequence: 0,
      publicSequence: 0,
      customerRead: 0,
      staffRead: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
export const detail = query({
  args: {
    conversationId,
    staff: v.boolean(),
    language: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { row } = await access(ctx, args.conversationId, args.staff);
    locale(args.language);
    const page = await ctx.db
      .query("supportMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", row._id))
      .order("desc")
      .filter((q) => (args.staff ? q.eq(1, 1) : q.neq(q.field("role"), "note")))
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(50, args.paginationOpts.numItems),
      });
    return {
      conversation: row,
      ...page,
      page: await Promise.all(
        page.page.map(async (m) => ({
          ...m,
          attachments: await Promise.all(
            m.attachments.map(async (id) => {
              const a = await ctx.db.get(id);
              return a
                ? { id, name: a.name, mime: a.mime, size: a.size }
                : null;
            }),
          ),
          translation: await ctx.db
            .query("supportTranslations")
            .withIndex("by_message_language", (q) =>
              q.eq("messageId", m._id).eq("language", args.language),
            )
            .unique(),
        })),
      ),
    };
  },
});
export const send = mutation({
  args: {
    conversationId,
    text: v.string(),
    language: v.string(),
    requestId: v.string(),
    staff: v.boolean(),
    note: v.optional(v.boolean()),
    attachments: v.array(v.id("supportAttachments")),
  },
  handler: async (ctx, args) => {
    const { user, row } = await access(ctx, args.conversationId, args.staff);
    locale(args.language);
    if (args.staff) await requireAdminPermission(ctx, "support.write");
    if (!args.requestId || args.requestId.length > 128)
      throw new Error("Invalid request ID");
    const prior = await ctx.db
      .query("supportMessages")
      .withIndex("by_request", (q) =>
        q.eq("conversationId", row._id).eq("requestId", args.requestId),
      )
      .unique();
    if (prior) {
      if (
        prior.authorId !== user._id ||
        prior.text !== args.text.trim() ||
        prior.language !== args.language ||
        JSON.stringify(prior.attachments) !==
          JSON.stringify(args.attachments) ||
        (prior.role === "note") !== !!(args.staff && args.note)
      )
        throw new Error("Message request mismatch");
      return prior._id;
    }
    if (row.status === "resolved")
      throw new Error("Reopen this conversation before replying");
    if (
      (!args.text.trim() && !args.attachments.length) ||
      args.text.length > 6000 ||
      args.attachments.length > 3 ||
      new Set(args.attachments).size !== args.attachments.length
    )
      throw new Error(
        "Message must contain text or up to three attachments (6,000 characters maximum)",
      );
    await assertRateLimit(ctx, `support:send:${user._id}`, 30, 60_000);
    for (const id of args.attachments) {
      const a = await ctx.db.get(id);
      if (
        !a ||
        a.userId !== user._id ||
        a.conversationId !== row._id ||
        a.messageId ||
        a.deleting
      )
        throw new Error("Attachment unavailable");
    }
    const note = args.staff && args.note;
    const requestedHuman =
      !args.staff &&
      /(?:speak|talk|chat|connect).{0,24}(?:human|person|agent)|(?:parler|contacter).{0,24}(?:humain|personne|conseiller)|(?:hablar|contactar).{0,24}(?:humano|persona|agente)|상담원|직원.{0,12}(?:대화|연결)|担当者|オペレーター|人工客服|转人工/i.test(
        args.text,
      );
    const id = await ctx.db.insert("supportMessages", {
      conversationId: row._id,
      sequence: row.sequence + 1,
      role: note ? "note" : args.staff ? "staff" : "customer",
      authorId: user._id,
      text: args.text.trim(),
      language: args.language,
      requestId: args.requestId,
      createdAt: Date.now(),
      attachments: args.attachments,
      sources: [],
      ...(!args.staff && row.mode === "ai" && !requestedHuman
        ? { aiState: "pending" as const }
        : {}),
    });
    for (const a of args.attachments) await ctx.db.patch(a, { messageId: id });
    await ctx.db.patch(row._id, {
      sequence: row.sequence + 1,
      updatedAt: Date.now(),
      ...(!note
        ? {
            publicSequence: row.sequence + 1,
            revision: row.revision + 1,
            status: args.staff ? ("customer" as const) : ("staff" as const),
            ...(!args.staff
              ? {
                  language: args.language,
                  ...(requestedHuman ? { mode: "queued" as const } : {}),
                }
              : { mode: "human" as const, assignedTo: user._id }),
          }
        : {}),
      ...(row.subject === "New conversation" && !note && !args.staff
        ? { subject: args.text.trim().slice(0, 100) || "Attachment" }
        : {}),
    });
    if (!args.staff && row.mode === "ai" && !requestedHuman)
      await enqueueTask(ctx, 0, "support:answer", {
        messageId: id,
        revision: row.revision + 1,
      });
    if (args.text.trim() && !note)
      await enqueueTask(ctx, 0, "support:detectLanguage", { messageId: id });
    if (args.staff)
      await audit(
        ctx,
        user._id,
        row._id,
        note ? "support.note" : "support.reply",
      );
    return id;
  },
});
export const update = mutation({
  args: {
    conversationId,
    staff: v.boolean(),
    revision: v.number(),
    action: v.union(
      v.literal("handoff"),
      v.literal("claim"),
      v.literal("unassign"),
      v.literal("resolve"),
      v.literal("reopen"),
      v.literal("resume"),
      v.literal("case"),
    ),
  },
  handler: async (ctx, args) => {
    const { user, row } = await access(ctx, args.conversationId, args.staff);
    if (args.staff) await requireAdminPermission(ctx, "support.write");
    else if (!["handoff", "reopen"].includes(args.action))
      throw new Error("Staff permission required");
    if (row.revision !== args.revision)
      throw new Error("Conversation changed. Refresh and try again.");
    let patch: Partial<Doc<"supportConversations">> = {};
    if (args.action === "handoff") patch = { mode: "queued", status: "staff" };
    if (args.action === "claim")
      patch = { mode: "human", assignedTo: user._id, status: "staff" };
    if (args.action === "unassign")
      patch = { mode: "queued", assignedTo: undefined, status: "staff" };
    if (args.action === "resolve") patch = { status: "resolved" };
    if (args.action === "reopen") patch = { status: "staff", mode: "queued" };
    if (args.action === "resume")
      patch = { mode: "ai", assignedTo: undefined, status: "customer" };
    if (args.action === "case" && !row.caseId)
      patch.caseId = await ctx.db.insert("supportCases", {
        targetType: "user",
        targetId: row.userId,
        subject: row.subject,
        conversationId: row._id,
        status: "open",
        createdBy: user._id,
        assignedTo: row.assignedTo,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    await ctx.db.patch(row._id, {
      ...patch,
      revision: row.revision + 1,
      updatedAt: Date.now(),
    });
    await audit(ctx, user._id, row._id, `support.${args.action}`);
  },
});
export const read = mutation({
  args: { conversationId, staff: v.boolean(), sequence: v.number() },
  handler: async (ctx, args) => {
    const { row } = await access(ctx, args.conversationId, args.staff);
    const key = args.staff ? "staffRead" : "customerRead";
    await ctx.db.patch(row._id, {
      [key]: Math.max(
        row[key],
        Math.min(
          args.staff ? row.sequence : (row.publicSequence ?? row.sequence),
          args.sequence,
        ),
      ),
    });
  },
});
export const articles = query({
  args: { staff: v.boolean(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    if (args.staff) await requireAdminPermission(ctx, "support.read");
    else await requireUser(ctx, true);
    const result = await (
      args.staff
        ? ctx.db.query("helpArticles")
        : ctx.db
            .query("helpArticles")
            .withIndex("by_published", (q) => q.eq("published", true))
    )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(50, args.paginationOpts.numItems),
      });
    return {
      ...result,
      page: args.staff ? result.page : result.page.map(customerHelpArticle),
    };
  },
});
export const article = query({
  args: { id: v.id("helpArticles") },
  handler: async (ctx, args) => {
    const u = await requireUser(ctx, true);
    const a = await ctx.db.get(args.id);
    if (!a || (!a.published && !hasAdminPermission(u, "support.read")))
      return null;
    return customerHelpArticle(a);
  },
});
export const saveArticle = mutation({
  args: {
    id: v.optional(v.id("helpArticles")),
    revision: v.number(),
    title: v.string(),
    category: v.string(),
    language: v.string(),
    body: v.string(),
    published: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireAdminPermission(ctx, "knowledge.publish");
    locale(args.language);
    if (
      !args.title.trim() ||
      args.title.length > 160 ||
      !args.category.trim() ||
      args.category.length > 80 ||
      !args.body.trim() ||
      args.body.length > 30000
    )
      throw new Error(
        "Provide a title, category and article (30,000 characters maximum)",
      );
    const prior = args.id ? await ctx.db.get(args.id) : null;
    if (args.id && (!prior || prior.revision !== args.revision))
      throw new Error("Article changed. Reload before saving.");
    const { id, revision } = await writeHelpArticle(ctx, args, prior, {
      updatedBy: user._id,
    });
    await appendAuditLog(ctx, {
      actorUserId: user._id,
      targetType: "helpArticle",
      targetId: id,
      action: args.published ? "knowledge.publish" : "knowledge.draft",
      after: { revision },
    });
    return id;
  },
});
export const uploadAccess = query({
  args: { conversationId, staff: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await access(ctx, args.conversationId, args.staff);
    if (args.staff) await requireAdminPermission(ctx, "support.write");
    return user._id;
  },
});
export const attach = internalMutation({
  args: {
    conversationId,
    userId: v.id("users"),
    storageId: v.union(v.id("_storage"), v.id("r2Files")),
    name: v.string(),
    mime: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.conversationId);
    if (!row || row.status === "resolved")
      throw new Error("Conversation unavailable");
    await assertRateLimit(ctx, `support:upload:${args.userId}`, 12, 60_000);
    const id = await ctx.db.insert("supportAttachments", {
      ...args,
      createdAt: Date.now(),
    });
    await enqueueTask(ctx, 3600_000, "support:cleanupAttachment", { id });
    return id;
  },
});
export const attachment = query({
  args: { id: v.id("supportAttachments"), staff: v.boolean() },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.id);
    if (!a || a.deleting || (await mediaUnavailable(ctx, a.storageId)))
      throw new Error("Attachment unavailable");
    const { user } = await access(ctx, a.conversationId, args.staff);
    if (!a.messageId && a.userId !== user._id)
      throw new Error("Attachment unavailable");
    if (a.messageId) {
      const m = await ctx.db.get(a.messageId);
      if (m?.role === "note" && !args.staff)
        throw new Error("Attachment unavailable");
    }
    return a;
  },
});
export const abandoned = internalMutation({
  args: { id: v.id("supportAttachments") },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.id);
    if (!a || a.messageId || a.createdAt >= Date.now() - 3500_000) return null;
    await ctx.db.patch(a._id, { deleting: true });
    return a;
  },
});
export const removeAbandoned = internalMutation({
  args: { id: v.id("supportAttachments") },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.id);
    if (a && !a.messageId) await ctx.db.delete(a._id);
  },
});
export const answerContext = internalQuery({
  args: {
    messageId: v.id("supportMessages"),
    revision: v.number(),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const m = await ctx.db.get(args.messageId);
    if (!m || m.aiState === "done") return null;
    const c = await ctx.db.get(m.conversationId);
    if (
      !c ||
      c.mode !== "ai" ||
      c.status === "resolved" ||
      c.revision !== args.revision
    )
      return null;
    const history = await ctx.db
      .query("supportMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
      .order("desc")
      .filter((q) => q.neq(q.field("role"), "note"))
      .take(12);
    const chunks = await ctx.db
      .query("helpChunks")
      .withSearchIndex("search_content", (q) =>
        q.search("content", (args.search ?? m.text).slice(0, 500)),
      )
      .take(6);
    return { message: m, conversation: c, history: history.reverse(), chunks };
  },
});
export const finishAnswer = internalMutation({
  args: {
    messageId: v.id("supportMessages"),
    revision: v.number(),
    text: v.string(),
    failed: v.boolean(),
    sources: v.array(
      v.object({
        id: v.id("helpArticles"),
        title: v.string(),
        revision: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const m = await ctx.db.get(args.messageId);
    if (!m || m.aiState === "done") return;
    const c = await ctx.db.get(m.conversationId);
    if (
      !c ||
      c.mode !== "ai" ||
      c.status === "resolved" ||
      c.revision !== args.revision
    ) {
      await ctx.db.patch(m._id, { aiState: "done" });
      return;
    }
    // Do not commit answers grounded in articles that changed during generation.
    for (const source of args.sources) {
      const a = await ctx.db.get(source.id);
      if (!a || !a.published || a.revision !== source.revision)
        throw new Error("Knowledge changed during generation");
    }
    await ctx.db.insert("supportMessages", {
      conversationId: c._id,
      sequence: c.sequence + 1,
      role: "assistant",
      text: args.text.slice(0, 12000),
      language: c.language,
      requestId: `ai:${m._id}`,
      createdAt: Date.now(),
      attachments: [],
      sources: args.sources,
    });
    await ctx.db.patch(c._id, {
      sequence: c.sequence + 1,
      publicSequence: c.sequence + 1,
      updatedAt: Date.now(),
      status: args.failed ? "staff" : "customer",
      ...(args.failed ? { mode: "queued" as const } : {}),
    });
    await ctx.db.patch(m._id, { aiState: "done" });
  },
});
export const reserveCall = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    if (await paidWorkPause(ctx, DEEPSEEK_MODEL))
      throw new Error("Support AI is paused");
    const key = new Date().toISOString().slice(0, 10);
    const row = await ctx.db
      .query("supportUsage")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (
      !Number.isFinite(args.limit) ||
      (row?.calls ?? 0) >= Math.max(0, Math.min(10000, args.limit))
    )
      throw new Error("Support AI daily limit reached");
    if (row) await ctx.db.patch(row._id, { calls: row.calls + 1 });
    else await ctx.db.insert("supportUsage", { key, calls: 1 });
  },
});
export const requestTranslation = mutation({
  args: {
    messageId: v.id("supportMessages"),
    language: v.string(),
    staff: v.boolean(),
  },
  handler: async (ctx, args) => {
    locale(args.language);
    const m = await ctx.db.get(args.messageId);
    if (!m) throw new Error("Message unavailable");
    const { user } = await access(ctx, m.conversationId, args.staff);
    if (m.role === "note" && !args.staff)
      throw new Error("Message unavailable");
    if (m.language === args.language || !m.text) return;
    const existing = await ctx.db
      .query("supportTranslations")
      .withIndex("by_message_language", (q) =>
        q.eq("messageId", m._id).eq("language", args.language),
      )
      .unique();
    if (existing && existing.state !== "failed") return;
    await assertRateLimit(ctx, `support:translate:${user._id}`, 60, 60_000);
    const id =
      existing?._id ??
      (await ctx.db.insert("supportTranslations", {
        messageId: m._id,
        language: args.language,
        state: "pending",
      }));
    if (existing) await ctx.db.patch(id, { state: "pending" });
    await enqueueTask(ctx, 0, "support:translate", { id });
  },
});
export const translationContext = internalQuery({
  args: { id: v.id("supportTranslations") },
  handler: async (ctx, args) => {
    const t = await ctx.db.get(args.id);
    if (!t || t.state === "done") return null;
    const m = await ctx.db.get(t.messageId);
    return m ? { translation: t, message: m } : null;
  },
});
export const finishTranslation = internalMutation({
  args: { id: v.id("supportTranslations"), text: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.id))
      await ctx.db.patch(args.id, {
        text: args.text?.slice(0, 16000),
        state: args.text ? "done" : "failed",
      });
  },
});

/** Bounded account-erasure work. Worker jobs cannot resurrect deleted transcripts. */
export const purgeCustomer = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const c = await ctx.db
      .query("supportConversations")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (!c) return;
    await ctx.db.patch(c._id, {
      mode: "queued",
      status: "resolved",
      revision: c.revision + 1,
    });
    const messages = await ctx.db
      .query("supportMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
      .take(40);
    for (const m of messages) {
      for (const tr of await ctx.db
        .query("supportTranslations")
        .withIndex("by_message_language", (q) => q.eq("messageId", m._id))
        .collect())
        await ctx.db.delete(tr._id);
      await ctx.db.delete(m._id);
    }
    if (!messages.length) {
      const attachments = await ctx.db
        .query("supportAttachments")
        .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
        .take(40);
      for (const a of attachments) {
        await ctx.db.patch(a._id, {
          messageId: undefined,
          deleting: true,
          createdAt: 0,
        });
        await enqueueTask(ctx, 0, "support:cleanupAttachment", { id: a._id });
      }
      if (!attachments.length) await ctx.db.delete(c._id);
    }
    await enqueueTask(ctx, 1000, "support:purgeCustomer", args);
  },
});

export const languageContext = internalQuery({
  args: { messageId: v.id("supportMessages") },
  handler: (ctx, args) => ctx.db.get(args.messageId),
});
export const setMessageLanguage = internalMutation({
  args: { messageId: v.id("supportMessages"), language: v.string() },
  handler: async (ctx, args) => {
    locale(args.language);
    if (await ctx.db.get(args.messageId))
      await ctx.db.patch(args.messageId, { language: args.language });
  },
});
