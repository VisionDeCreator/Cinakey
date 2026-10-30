import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HELP_CONTENT_LANGUAGES,
  HELP_CONTENT_MAX_ARTICLES,
  HELP_CONTENT_MAX_BYTES,
  helpArticleSnapshot,
  normalizeHelpArticle,
  type HelpArticleContent,
} from "@dirrio/shared";

export type RepositoryHelpArticle = {
  key: string;
  hash: string;
  content: HelpArticleContent;
  resolution?: "repository" | "database";
};
const required = ["key", "title", "category", "language", "published"];
function parseArticle(
  text: string,
  filename: string,
  language: string,
): RepositoryHelpArticle {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(
    text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"),
  );
  if (!match)
    throw new Error(
      `${filename}: expected YAML-style metadata between --- lines`,
    );
  const metadata: Record<string, string | boolean> = {};
  for (const line of match[1]!.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const field = /^([a-z]+):\s*(.*?)\s*$/.exec(line);
    if (!field || !required.includes(field[1]!))
      throw new Error(`${filename}: unknown or unsupported metadata field`);
    const key = field[1]!,
      raw = field[2]!;
    if (key in metadata)
      throw new Error(`${filename}: duplicate ${key} metadata`);
    if (key === "published") {
      if (raw !== "true" && raw !== "false")
        throw new Error(`${filename}: published must be true or false`);
      metadata[key] = raw === "true";
    } else {
      let value: unknown = raw;
      if (raw.startsWith('"')) {
        try {
          value = JSON.parse(raw);
        } catch {
          throw new Error(`${filename}: invalid quoted ${key}`);
        }
      } else if (raw.startsWith("'")) {
        if (!raw.endsWith("'"))
          throw new Error(`${filename}: invalid quoted ${key}`);
        value = raw.slice(1, -1).replace(/''/g, "'");
      }
      if (typeof value !== "string" || !value.trim() || /[\r\n\t]/.test(value))
        throw new Error(`${filename}: invalid ${key}`);
      metadata[key] = value;
    }
  }
  if (required.some((key) => !(key in metadata)))
    throw new Error(`${filename}: missing required metadata`);
  const key = String(metadata.key);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(key) || key.length > 100)
    throw new Error(`${filename}: invalid stable article key`);
  if (metadata.language !== language)
    throw new Error(`${filename}: metadata language must match its directory`);
  const content = normalizeHelpArticle({
    title: String(metadata.title),
    category: String(metadata.category),
    language,
    published: metadata.published as boolean,
    body: match[2]!,
  });
  return {
    key,
    content,
    hash: createHash("sha256")
      .update(helpArticleSnapshot(content))
      .digest("hex"),
  };
}

/** Deliberately small metadata format: no YAML execution, aliases, nested data or dependencies. */
export function readHelpArticles(directory: string): RepositoryHelpArticle[] {
  const entries: RepositoryHelpArticle[] = [],
    seen = new Set<string>();
  if (
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).isSymbolicLink()
  )
    throw new Error("Help content must be a real directory");
  for (const name of readdirSync(directory).sort()) {
    if (name === "README.md" || name === ".DS_Store") continue;
    const folder = join(directory, name),
      stat = lstatSync(folder);
    if (
      !(HELP_CONTENT_LANGUAGES as readonly string[]).includes(name) ||
      !stat.isDirectory() ||
      stat.isSymbolicLink()
    )
      throw new Error(`Unexpected help content path: ${name}`);
    for (const file of readdirSync(folder).sort()) {
      if (file === ".DS_Store") continue;
      const path = join(folder, file),
        info = lstatSync(path);
      if (
        !file.endsWith(".md") ||
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 128 * 1024
      )
        throw new Error(`Invalid article file: ${name}/${file}`);
      const article = parseArticle(
        readFileSync(path, "utf8"),
        `${name}/${file}`,
        name,
      );
      const identity = `${article.key}:${article.content.language}`;
      if (seen.has(identity))
        throw new Error(`Duplicate article identity: ${identity}`);
      seen.add(identity);
      entries.push(article);
    }
  }
  if (!entries.length || entries.length > HELP_CONTENT_MAX_ARTICLES)
    throw new Error("A content release must contain 1–100 articles");
  if (
    Buffer.byteLength(JSON.stringify(entries), "utf8") > HELP_CONTENT_MAX_BYTES
  )
    throw new Error("Help content exceeds the 512 KiB deployment limit");
  return entries;
}
