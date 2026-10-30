import { HELP_CONTENT_MAX_BYTES } from "@dirrio/shared";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import type { internal } from "../operations";
import { readHelpArticles } from "./help-content-files";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const usage = `Usage: bun run help:deploy --environment <development|production> [options]

Default is a read-only preview. --apply explicitly writes the reviewed content.
  --env-file <path>      Target credential file (default: .env)
  --dir <path>           Article directory (default: content/help)
  --revision <label>     Release label (default: Git revision, or RELEASE_VERSION)
  --resolve <key:lang=repository|database>  Explicit per-article conflict resolution; repeatable
  --apply               Apply the preview atomically; unchanged imports are no-ops
  --help, -h            Show this help without loading credentials

Development requires a dev: deploy key; production requires prod:. The deploy key
and HTTPS CONVEX_URL must name the same hosted deployment. No title-based adoption,
manual-article deletion or deletion-by-absence is performed.`;

type PreviewArgs = FunctionArgs<typeof internal.helpContent.preview>;
export type HelpDeploymentPlan = FunctionReturnType<
  typeof internal.helpContent.preview
>;
function repositoryRevision(directory: string, provided?: string) {
  if (provided) return provided;
  const revision = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  if (revision.status === 0) {
    const dirty = spawnSync(
      "git",
      ["status", "--porcelain", "--", relative(root, directory)],
      { cwd: root, encoding: "utf8" },
    );
    if (dirty.status !== 0)
      throw new Error(
        "Cannot determine help content revision; pass --revision",
      );
    return `${revision.stdout.trim()}${dirty.stdout.trim() ? "-dirty" : ""}`;
  }
  if (process.env.RELEASE_VERSION) return process.env.RELEASE_VERSION;
  throw new Error(
    "No Git revision or RELEASE_VERSION available; pass --revision",
  );
}
function target(environment: string, file: string) {
  let values: Record<string, string | undefined>;
  try {
    values = parseEnv(readFileSync(file, "utf8"));
  } catch {
    throw new Error("Cannot read the selected environment file");
  }
  const key = values.CONVEX_DEPLOY_KEY;
  if (!key)
    throw new Error(
      "CONVEX_DEPLOY_KEY is required in the selected environment file",
    );
  const match = /^(dev|prod):([^|]+)\|.+$/.exec(key);
  if (!match || match[1] !== (environment === "development" ? "dev" : "prod"))
    throw new Error(
      "Deploy-key type does not match the explicitly selected environment",
    );
  let url: URL;
  try {
    url = new URL(values.CONVEX_URL!);
  } catch {
    throw new Error(
      "A valid CONVEX_URL is required in the selected environment file",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== `${match[2]}.convex.cloud` ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("CONVEX_URL does not match the deploy-key target");
  return { key, url: url.origin };
}
function printPlan(plan: HelpDeploymentPlan) {
  for (const row of plan) {
    const before =
      row.currentPublished === null
        ? "new"
        : row.currentPublished
          ? "published"
          : "draft";
    const published =
      row.action === "keep" || row.action === "unchanged"
        ? row.currentPublished
        : row.published;
    console.log(
      `${row.action.toUpperCase().padEnd(9)} ${row.key}:${row.language} · ${before} → ${published ? "published" : "draft"} · ${row.reason}`,
    );
  }
  const counts = new Map<string, number>();
  for (const row of plan)
    counts.set(row.action, (counts.get(row.action) ?? 0) + 1);
  console.log(
    `Summary: ${[...counts].map(([action, count]) => `${count} ${action}`).join(", ")}`,
  );
}
export async function runHelpContent(argv: string[]): Promise<number> {
  let input: PreviewArgs,
    destination: { key: string; url: string },
    environment: string,
    apply: boolean;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        apply: { type: "boolean" },
        environment: { type: "string" },
        "env-file": { type: "string", default: ".env" },
        dir: { type: "string", default: "content/help" },
        revision: { type: "string" },
        resolve: { type: "string", multiple: true },
      },
    });
    if (values.help) {
      console.log(usage);
      return 0;
    }
    if (
      positionals.length ||
      !["development", "production"].includes(values.environment ?? "")
    )
      throw new Error(
        "Explicit --environment development or production is required",
      );
    environment = values.environment!;
    apply = values.apply ?? false;
    const directory = resolve(root, values.dir!),
      entries = readHelpArticles(directory);
    const resolutions = new Set<string>();
    for (const resolution of values.resolve ?? []) {
      const match = /^(.+):(en|fr|es|ko|ja|zh)=(repository|database)$/.exec(
        resolution,
      );
      if (!match)
        throw new Error("Use --resolve key:language=repository or =database");
      const identity = `${match[1]}:${match[2]}`;
      const entry = entries.find(
        (row) => row.key === match[1] && row.content.language === match[2],
      );
      if (!entry || resolutions.has(identity))
        throw new Error(`Unknown or duplicate resolution: ${identity}`);
      resolutions.add(identity);
      entry.resolution = match[3] as "repository" | "database";
    }
    if (
      Buffer.byteLength(JSON.stringify(entries), "utf8") >
      HELP_CONTENT_MAX_BYTES
    )
      throw new Error(
        "Help content and resolutions exceed the 512 KiB deployment limit",
      );
    const sourceRevision = repositoryRevision(directory, values.revision);
    if (!/^[A-Za-z0-9._/@:+-]{1,160}$/.test(sourceRevision))
      throw new Error("Invalid source revision label");
    input = { entries, sourceRevision };
    destination = target(environment, resolve(root, values["env-file"]!));
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Invalid content deployment arguments",
    );
    console.error(usage);
    return 1;
  }
  console.log(`Help content target: ${environment} ${destination.url}`);
  console.log(`Source revision: ${input.sourceRevision}`);
  const client = new ConvexHttpClient(destination.url, {
    fetch: ((url, init) =>
      fetch(url, {
        ...init,
        signal: AbortSignal.timeout(90_000),
      })) as typeof fetch,
  });
  (client as unknown as { setAdminAuth(key: string): void }).setAdminAuth(
    destination.key,
  );
  let plan: HelpDeploymentPlan;
  try {
    plan = await client.query(
      makeFunctionReference<"query", PreviewArgs, HelpDeploymentPlan>(
        "helpContent:preview",
      ),
      input,
    );
  } catch {
    console.error(
      "Could not preview help content. Check deployment access, connectivity and that the latest backend functions are deployed. Credentials were not printed.",
    );
    return 1;
  }
  printPlan(plan);
  if (plan.some((row) => row.action === "conflict")) {
    console.error(
      "Unresolved conflicts. No articles changed. Review Admin edits, update the repository, or pass explicit --resolve choices.",
    );
    return 2;
  }
  if (!apply) {
    console.log("Preview only. Rerun with --apply to deploy this content.");
    return 0;
  }
  try {
    const result = await client.mutation(
      makeFunctionReference<
        "mutation",
        FunctionArgs<typeof internal.helpContent.apply>,
        FunctionReturnType<typeof internal.helpContent.apply>
      >("helpContent:apply"),
      {
        ...input,
        expected: plan.map(
          ({ key, language, id, revision, generation, action }) => ({
            key,
            language,
            id,
            revision,
            generation,
            action,
          }),
        ),
      },
    );
    console.log(
      `Content deployment complete: ${result.filter((row) => row.action !== "unchanged").length} changed, ${result.filter((row) => row.action === "unchanged").length} unchanged. Manual articles preserved.`,
    );
    return 0;
  } catch {
    console.error(
      "Content apply was not confirmed. The knowledge base may have changed after preview or the response may have been interrupted. Rerun preview before retrying; completed imports are idempotent.",
    );
    return 1;
  }
}
