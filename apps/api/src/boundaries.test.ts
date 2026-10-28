import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { registry } from "./registry";
import manifest from "./manifest.json";
function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(resolve(root, entry.name))
      : [resolve(root, entry.name)],
  );
}
describe("migration boundaries", () => {
  it("routes every service through an explicit visibility contract", () => {
    const contracts = manifest as Record<
      string,
      { kind: string; public: boolean }
    >;
    for (const [name, operation] of registry)
      expect(contracts[name], name).toEqual({
        kind: "action",
        public: operation.visibility === "public",
      });
  });
  it("keeps product hooks on HTTP and provider execution outside Convex", () => {
    const frontends = ["../../web/src", "../../admin/src"].flatMap((path) =>
      files(fileURLToPath(new URL(path, import.meta.url))),
    );
    for (const file of frontends.filter(
      (file) => /\.tsx?$/.test(file) && !file.endsWith(".test.tsx"),
    )) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(
        /import\s*\{[^}]*\b(?:useQuery|useMutation|useAction)\b[^}]*\}\s*from\s*["']convex\/react["']/s,
      );
    }
    const convex = fileURLToPath(
      new URL("../../../packages/backend/convex", import.meta.url),
    );
    for (const file of files(convex).filter(
      (file) =>
        /\.ts$/.test(file) &&
        !file.endsWith(".test.ts") &&
        !file.includes("_generated"),
    )) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(
        /\b(?:internalAction|httpAction|action)\(/,
      );
      expect(text, file).not.toMatch(/\bfetch\(/);
    }
  });
});

it("keeps developer routes and funding hooks out of the product web app", () => {
  const root = fileURLToPath(new URL("../../web/src", import.meta.url));
  for (const file of files(root).filter(
    (file) => /\.tsx?$/.test(file) && !file.includes(".test."),
  )) {
    const source = readFileSync(file, "utf8");
    expect(source, file).not.toMatch(
      /(?:\/dev(?:["/])|billing\.(?:grantDev|grantToEmail|lookupByEmail)|ALLOW_DEV_USD|USE_MOCK_ADAPTERS)/,
    );
  }
});
