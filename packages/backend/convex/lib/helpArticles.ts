import { v } from "convex/values";
import { normalizeHelpArticle, type HelpArticleContent } from "@dirrio/shared";
import type { MutationCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";

export const helpContentValidator = v.object({
  title: v.string(),
  category: v.string(),
  language: v.string(),
  body: v.string(),
  published: v.boolean(),
});

/** Both authoring paths replace publication/search state in the same transaction. */
export async function writeHelpArticle(
  ctx: MutationCtx,
  content: HelpArticleContent,
  prior: Doc<"helpArticles"> | null,
  metadata: { updatedBy?: Id<"users"> } = {},
) {
  const value = {
    ...normalizeHelpArticle(content),
    ...metadata,
    revision: (prior?.revision ?? 0) + 1,
    updatedAt: Date.now(),
  };
  const id = prior?._id ?? (await ctx.db.insert("helpArticles", value));
  if (prior) await ctx.db.patch(id, value);
  for (const chunk of await ctx.db
    .query("helpChunks")
    .withIndex("by_article", (q) => q.eq("articleId", id))
    .collect())
    await ctx.db.delete(chunk._id);
  if (value.published)
    for (let i = 0; i < value.body.length; i += 1200)
      await ctx.db.insert("helpChunks", {
        articleId: id,
        revision: value.revision,
        title: value.title,
        language: value.language,
        content: `${value.title}\n${value.body.slice(i, i + 1500)}`,
      });
  return { id, revision: value.revision };
}

/** Import baselines can contain earlier draft text, so they are staff-only metadata. */
export function customerHelpArticle(row: Doc<"helpArticles">) {
  return {
    ...row,
    sourceKey: undefined,
    sourceLanguage: undefined,
    sourceHash: undefined,
    sourceRevision: undefined,
    sourceImportedAt: undefined,
    sourceBaseline: undefined,
    sourceOverride: undefined,
    sourceGeneration: undefined,
  };
}
