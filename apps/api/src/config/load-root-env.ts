import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { providerKeyNames } from "./env";
/** Called by process entrypoints only. Tests never load real credentials. */
export function loadRootEnvironment(
  path = fileURLToPath(new URL("../../../../.env", import.meta.url)),
) {
  let values: Record<string, string | undefined>;
  try {
    values = parseEnv(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      "Cannot read root .env. Copy .env.example to .env and configure it locally.",
    );
  }
  for (const [name, value] of Object.entries(values))
    if (process.env[name] === undefined) process.env[name] = value;
  // Provider credentials have one local source of truth; inherited/nested files cannot override it.
  for (const name of Object.values(providerKeyNames))
    process.env[name] = values[name] ?? "";
}
