import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { checkServices, readEnvironment, root } from "./check-env";
const [operation, ...flags] = process.argv.slice(2);
if (
  !["deploy", "sync", "auth"].includes(operation) ||
  flags.some((f) => f !== "--rotate" || operation !== "auth")
) {
  console.error("Usage: convex.ts <deploy|sync|auth> [--rotate (auth only)]");
  process.exit(1);
}
const errors = checkServices(["convex"]);
if (errors.length) {
  errors.forEach((e) => console.error(e));
  process.exit(1);
}
const values = readEnvironment("convex");
// Deploy keys select their own deployment. Reject dev/preview keys in these production tools.
if (!values.CONVEX_DEPLOY_KEY.startsWith("prod:")) {
  console.error(
    "A production Convex deploy key is required; development and preview keys are rejected.",
  );
  process.exit(1);
}
const env: Record<string, string | undefined> = {
  ...process.env,
  CONVEX_DEPLOY_KEY: values.CONVEX_DEPLOY_KEY,
};
for (const key of [
  "CONVEX_DEPLOYMENT",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
])
  delete env[key];
const cwd = resolve(root, "packages/backend");
function cli(args: string[]) {
  // Capture output so secret values cannot leak from CLI diagnostics.
  const result = spawnSync("bun", ["run", "convex", ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(
      `Convex ${args[0]} failed; inspect the deployment in the dashboard. CLI output suppressed to protect secrets.`,
    );
  return result.stdout.trim();
}
function setVariables(entries: Record<string, string>) {
  const dir = mkdtempSync(resolve(tmpdir(), "cinakey-convex-"));
  try {
    const file = resolve(dir, "runtime.env");
    writeFileSync(
      file,
      Object.entries(entries)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
    cli(["env", "set", "--from-file", file, "--force"]);
    console.log(`Updated Convex variables: ${Object.keys(entries).join(", ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
try {
  console.log(
    `Target: ${values.CONVEX_URL} (production deploy-key target must match this URL)`,
  );
  // The deploy key prefix encodes the deployment name; verify before any mutation.
  const keyDeployment = values.CONVEX_DEPLOY_KEY.slice(5).split("|")[0];
  if (new URL(values.CONVEX_URL).hostname !== `${keyDeployment}.convex.cloud`)
    throw new Error(
      "CONVEX_URL does not match the production deploy key target",
    );
  if (operation === "auth") {
    const existing = cli(["env", "list", "--names-only"]);
    const hasPrivate = /\bJWT_PRIVATE_KEY\b/.test(existing);
    const hasPublic = /\bJWKS\b/.test(existing);
    if ((hasPrivate || hasPublic) && !flags.includes("--rotate")) {
      if (hasPrivate !== hasPublic)
        throw new Error(
          "Incomplete auth key pair; inspect the deployment before explicitly rotating",
        );
      console.log(
        "Existing auth keys preserved. Use --rotate explicitly to invalidate sessions and rotate keys.",
      );
      setVariables({ SITE_URL: values.SITE_URL });
    } else {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      setVariables({
        JWT_PRIVATE_KEY: privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString()
          .trimEnd()
          .replace(/\n/g, " "),
        JWKS: JSON.stringify({
          keys: [
            {
              use: "sig",
              alg: "RS256",
              ...publicKey.export({ format: "jwk" }),
            },
          ],
        }),
        SITE_URL: values.SITE_URL,
      });
    }
  } else {
    const entries: Record<string, string> = {};
    for (const key of [
      "SITE_URL",
      "STAGING_LLM_ENABLED",
      "POLAR_ENVIRONMENT",
      "SUBSCRIPTION_PAYWALL_ENABLED",
      "AUTH_GOOGLE_ID",
      "AUTH_GOOGLE_SECRET",
    ]) {
      if (values[key]) entries[key] = values[key];
    }
    // Configure required flags before uploading functions; never sync server credentials.
    setVariables(entries);
    if (operation === "deploy") {
      cli([
        "deploy",
        "--typecheck",
        "enable",
        "--env-file",
        resolve(root, "deployments/convex/.env"),
      ]);
      console.log("Convex deployment complete.");
    }
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Convex operation failed",
  );
  process.exitCode = 1;
}
