/** Canonical customer-facing fields shared by Admin and repository content deployment. */
export type HelpArticleContent = {
  title: string;
  category: string;
  language: string;
  body: string;
  published: boolean;
};
export const HELP_CONTENT_LANGUAGES = [
  "en",
  "fr",
  "es",
  "ko",
  "ja",
  "zh",
] as const;
export const HELP_CONTENT_MAX_ARTICLES = 100;
export const HELP_CONTENT_MAX_BYTES = 512 * 1024;

export function normalizeHelpArticle(
  value: HelpArticleContent,
): HelpArticleContent {
  const result = {
    title: value.title.trim(),
    category: value.category.trim(),
    language: value.language,
    body: value.body.replace(/\r\n?/g, "\n").trim(),
    published: value.published,
  };
  if (
    !result.title ||
    result.title.length > 160 ||
    !result.category ||
    result.category.length > 80 ||
    !result.body ||
    result.body.length > 30000 ||
    !(HELP_CONTENT_LANGUAGES as readonly string[]).includes(result.language) ||
    typeof result.published !== "boolean"
  )
    throw new Error(
      "Invalid help article: provide a supported language, title, category and body of up to 30,000 characters",
    );
  return result;
}

/** Explicit field order keeps canonical hashing independent of object insertion order. */
export function helpArticleSnapshot(value: HelpArticleContent): string {
  return JSON.stringify(normalizeHelpArticle(value));
}
