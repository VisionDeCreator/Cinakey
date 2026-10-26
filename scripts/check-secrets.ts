import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function credentialFindings(path: string, text: string): string[] {
  const findings: string[] = [];
  if (text.includes("\0")) return findings;
  if (
    basename(path) === ".env.example" &&
    /^(?:OPENAI_API_KEY|DEEPSEEK_API_KEY|SEEDANCE_API_KEY|SUME_API_KEY|CONVEX_DEPLOY_KEY|RESEND_API_KEY|GENERATION_WEBHOOK_SECRET)[ \t]*=[ \t]*[^\s#]+/m.test(
      text,
    )
  )
    findings.push("secret placeholders must be empty");
  const checks: [string, RegExp][] = [
    ["possible provider credential", /\bsk-[A-Za-z0-9_-]{20,}/],
    ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    [
      "hardcoded provider credential",
      /(?:OPENAI_API_KEY|DEEPSEEK_API_KEY|SEEDANCE_API_KEY|SUME_API_KEY)["']?[ \t]*[:=][ \t]*["'][^"'\s]{12,}["']/,
    ],
    [
      "hardcoded bearer credential",
      /Authorization["']?[ \t]*:[ \t]*["']Bearer [A-Za-z0-9_-]{16,}/i,
    ],
  ];
  for (const [label, pattern] of checks)
    if (pattern.test(text)) findings.push(label);
  return findings;
}
export function checkSecrets(staged = false) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
  const files = staged
    ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
        .split("\0")
        .filter(Boolean)
    : [
        ...new Set([
          ...tracked,
          ...git("ls-files", "--others", "--exclude-standard", "-z")
            .split("\0")
            .filter(Boolean),
        ]),
      ];
  const problems: string[] = [];
  for (const path of tracked)
    if (basename(path).startsWith(".env") && basename(path) !== ".env.example")
      problems.push(`${path}: real environment files must never be tracked`);
  for (const path of files) {
    if (/\.(?:png|jpg|jpeg|webp|gif|mp4|mp3|woff2?|pdf|zip)$/.test(path))
      continue;
    let text: string;
    try {
      text = staged
        ? git("show", `:${path}`)
        : readFileSync(resolve(root, path), "utf8");
    } catch {
      continue;
    }
    for (const label of credentialFindings(path, text))
      problems.push(`${path}: ${label}`);
  }
  return problems;
}
if (import.meta.main) {
  const problems = checkSecrets(process.argv.includes("--staged"));
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      "Credential checks passed; no tracked environment files or detected credentials.",
    );
}
