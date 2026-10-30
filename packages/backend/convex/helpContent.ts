import { v } from "convex/values";
import {
  HELP_CONTENT_MAX_ARTICLES,
  HELP_CONTENT_MAX_BYTES,
  helpArticleSnapshot,
  normalizeHelpArticle,
} from "@dirrio/shared";
import { internalQuery, internalMutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { helpContentValidator, writeHelpArticle } from "./lib/helpArticles";
import { appendAuditLog } from "./lib/audit";

const entryValidator = v.object({
  key: v.string(),
  hash: v.string(),
  content: helpContentValidator,
  resolution: v.optional(
    v.union(v.literal("repository"), v.literal("database")),
  ),
});
const args = { entries: v.array(entryValidator), sourceRevision: v.string() };
type Entry = typeof entryValidator.type;
type Action = "create" | "update" | "unchanged" | "conflict" | "keep";

async function plan(
  ctx: QueryCtx | MutationCtx,
  entries: Entry[],
  sourceRevision: string,
) {
  if (!/^[A-Za-z0-9._/@:+-]{1,160}$/.test(sourceRevision))
    throw new Error("Invalid repository revision");
  if (!entries.length || entries.length > HELP_CONTENT_MAX_ARTICLES)
    throw new Error("Deploy 1–100 help articles per release");
  if (
    new TextEncoder().encode(JSON.stringify(entries)).length >
    HELP_CONTENT_MAX_BYTES
  )
    throw new Error("Help content exceeds the 512 KiB deployment limit");
  const seen = new Set<string>();
  const rows = [];
  for (const entry of entries) {
    const content = normalizeHelpArticle(entry.content);
    if (
      !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(entry.key) ||
      entry.key.length > 100 ||
      !/^[a-f0-9]{64}$/.test(entry.hash)
    )
      throw new Error("Invalid article key or SHA-256 hash");
    const identity = `${entry.key}:${content.language}`;
    if (seen.has(identity)) throw new Error(`Duplicate article: ${identity}`);
    seen.add(identity);
    const current = await ctx.db
      .query("helpArticles")
      .withIndex("by_source", (q) =>
        q.eq("sourceKey", entry.key).eq("sourceLanguage", content.language),
      )
      .unique();
    let action: Action = "create",
      reason = "New repository article";
    if (current) {
      const currentText = helpArticleSnapshot(current),
        incomingText = helpArticleSnapshot(content);
      const baselineText = current.sourceBaseline
        ? helpArticleSnapshot(current.sourceBaseline)
        : null;
      const edited = currentText !== baselineText;
      const changedOverride =
        !!current.sourceOverride && current.sourceHash !== entry.hash;
      if (currentText === incomingText) {
        action =
          current.sourceHash === entry.hash &&
          !edited &&
          !current.sourceOverride
            ? "unchanged"
            : "update";
        reason =
          action === "unchanged"
            ? "Content is current"
            : "Align import provenance with matching content";
      } else if (entry.resolution === "database") {
        action =
          current.sourceHash === entry.hash && !edited && current.sourceOverride
            ? "unchanged"
            : "keep";
        reason = "Explicitly preserve the database version";
      } else if (entry.resolution === "repository") {
        action = "update";
        reason = "Explicitly restore the repository version";
      } else if (edited || changedOverride) {
        action = "conflict";
        reason = edited
          ? "Article was edited in Admin since its last content deployment"
          : "Repository changed while a database override is active";
      } else if (current.sourceHash === entry.hash) {
        action = "unchanged";
        reason = current.sourceOverride
          ? "Approved database override is current"
          : "Content is current";
      } else {
        action = "update";
        reason = "Repository content changed";
      }
    } else if (entry.resolution === "database")
      throw new Error(`No database article to keep: ${identity}`);
    rows.push({
      entry,
      current,
      content,
      summary: {
        key: entry.key,
        language: content.language,
        title: content.title,
        published: content.published,
        currentPublished: current?.published ?? null,
        id: current?._id ?? null,
        revision: current?.revision ?? null,
        generation: current?.sourceGeneration ?? 0,
        action,
        reason,
      },
    });
  }
  return rows;
}

/** Deployment-key-only endpoints. Never exposed through the public HTTP manifest. */
export const preview = internalQuery({
  args,
  handler: async (ctx, input) =>
    (await plan(ctx, input.entries, input.sourceRevision)).map(
      (row) => row.summary,
    ),
});
export const apply = internalMutation({
  args: {
    ...args,
    expected: v.array(
      v.object({
        key: v.string(),
        language: v.string(),
        id: v.union(v.id("helpArticles"), v.null()),
        revision: v.union(v.number(), v.null()),
        generation: v.number(),
        action: v.string(),
      }),
    ),
  },
  handler: async (ctx, input) => {
    const rows = await plan(ctx, input.entries, input.sourceRevision);
    if (rows.some((row) => row.summary.action === "conflict"))
      throw new Error(
        "Unresolved help content conflicts; no articles were changed",
      );
    if (input.expected.length !== rows.length)
      throw new Error("Content deployment preview mismatch");
    for (let i = 0; i < rows.length; i++) {
      const expected = input.expected[i]!,
        actual = rows[i]!.summary;
      if (
        expected.key !== actual.key ||
        expected.language !== actual.language ||
        expected.id !== actual.id ||
        expected.revision !== actual.revision ||
        expected.generation !== actual.generation ||
        expected.action !== actual.action
      )
        throw new Error(
          "Knowledge base changed after preview; rerun the deployment",
        );
    }
    const result = [];
    for (const row of rows) {
      if (row.summary.action === "unchanged") {
        result.push(row.summary);
        continue;
      }
      const keeping = row.summary.action === "keep";
      const written = keeping
        ? { id: row.current!._id, revision: row.current!.revision }
        : await writeHelpArticle(ctx, row.content, row.current, {
            updatedBy: undefined,
          });
      await ctx.db.patch(written.id, {
        sourceKey: row.entry.key,
        sourceLanguage: row.content.language,
        sourceHash: row.entry.hash,
        sourceRevision: input.sourceRevision,
        sourceImportedAt: Date.now(),
        sourceBaseline: keeping
          ? normalizeHelpArticle(row.current!)
          : row.content,
        sourceOverride: keeping,
        sourceGeneration: (row.current?.sourceGeneration ?? 0) + 1,
      });
      await appendAuditLog(ctx, {
        actorType: "operator",
        action: `knowledge.deploy.${row.summary.action}`,
        targetType: "helpArticle",
        targetId: written.id,
        before: row.current
          ? { revision: row.current.revision, published: row.current.published }
          : undefined,
        after: {
          revision: written.revision,
          published: keeping ? row.current!.published : row.content.published,
        },
        meta: {
          key: row.entry.key,
          language: row.content.language,
          hash: row.entry.hash,
          sourceRevision: input.sourceRevision,
          resolution: row.entry.resolution,
        },
      });
      result.push({
        ...row.summary,
        id: written.id,
        revision: written.revision,
      });
    }
    return result;
  },
});
