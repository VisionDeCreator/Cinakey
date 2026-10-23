import { describe, expect, it, vi } from "vitest";
import {
  providerConfig,
  validateProviderConfiguration,
  requireProviderKey,
} from "./env";
import { credentialFindings } from "../../../../scripts/check-secrets";
import { loadRootEnvironment } from "./load-root-env";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
describe("server configuration and credential boundaries", () => {
  it("normalizes BytePlus task URLs without duplicating the task path", () => {
    vi.stubEnv(
      "SEEDANCE_API_BASE_URL",
      "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/",
    );
    vi.stubEnv("SEEDANCE_MODEL", "dreamina-seedance-2-5-260628");
    expect(providerConfig().seedanceBaseUrl).toBe(
      "https://ark.ap-southeast.bytepluses.com/api/v3",
    );
    expect(providerConfig().seedanceModel).toBe("dreamina-seedance-2-5-260628");
    vi.stubEnv(
      "SEEDANCE_API_BASE_URL",
      "https://ark.ap-southeast.bytepluses.com/api/v3",
    );
    expect(providerConfig().seedanceBaseUrl).toBe(
      "https://ark.ap-southeast.bytepluses.com/api/v3",
    );
  });
  it("loads provider keys from the root file rather than inherited values", () => {
    const directory = mkdtempSync(join(tmpdir(), "cinakey-env-test-"));
    try {
      const path = join(directory, ".env");
      writeFileSync(
        path,
        "OPENAI_API_KEY=root-test-key\nUSE_MOCK_ADAPTERS=true\n",
      );
      vi.stubEnv("OPENAI_API_KEY", "inherited-test-key");
      vi.stubEnv("DEEPSEEK_API_KEY", "inherited-test-key");
      loadRootEnvironment(path);
      expect(process.env.OPENAI_API_KEY).toBe("root-test-key");
      expect(process.env.DEEPSEEK_API_KEY).toBe("");
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("requires live keys and accepts explicit mock mode without keys", () => {
    expect(() => validateProviderConfiguration()).not.toThrow();
    vi.stubEnv("USE_MOCK_ADAPTERS", "false");
    vi.stubEnv("ENABLED_PROVIDERS", "deepseek");
    expect(() => validateProviderConfiguration()).toThrow(
      "DEEPSEEK_API_KEY is required",
    );
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    expect(() => validateProviderConfiguration()).not.toThrow();
    expect(() => requireProviderKey("openai")).toThrow("disabled");
  });
  it("does not require the retired image provider for legacy environment settings", () => {
    vi.stubEnv("USE_MOCK_ADAPTERS", "false");
    vi.stubEnv("ENABLED_PROVIDERS", "deepseek,seedance,openai");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("SEEDANCE_API_KEY", "test-key");
    expect(providerConfig().enabled).toEqual(["deepseek", "seedance"]);
    expect(() => validateProviderConfiguration()).not.toThrow();
    expect(() => requireProviderKey("openai")).toThrow("disabled");
  });
  it("validates flags, limits and provider endpoints without echoing invalid values", () => {
    vi.stubEnv("PROVIDER_TIMEOUT_MS", "invalid-private-value");
    expect(() => providerConfig()).toThrow("PROVIDER_TIMEOUT_MS");
    try {
      providerConfig();
    } catch (error) {
      expect(String(error)).not.toContain("invalid-private-value");
    }
    vi.stubEnv("PROVIDER_TIMEOUT_MS", "1000");
    vi.stubEnv("SEEDANCE_API_BASE_URL", "http://example.com");
    expect(() => providerConfig()).toThrow("HTTPS");
  });
  it("detects credentials and rejects nonempty example secret fields", () => {
    const synthetic = ["sk", "-", "x".repeat(24)].join("");
    expect(
      credentialFindings("code.ts", `const value = '${synthetic}'`),
    ).toContain("possible provider credential");
    expect(
      credentialFindings(
        ".env.example",
        "OPENAI_API_KEY=\nDEEPSEEK_API_KEY=\n",
      ),
    ).toEqual([]);
    expect(
      credentialFindings(".env.example", "OPENAI_API_KEY=placeholder"),
    ).toContain("secret placeholders must be empty");
    expect(
      credentialFindings(
        "code.ts",
        "const config = " +
          JSON.stringify({ ["OPENAI" + "_API_KEY"]: "hardcoded-value" }),
      ),
    ).toContain("hardcoded provider credential");
  });
  it("ignores every nested environment variant except exact example files", () => {
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const ignored = [
      ".env",
      ".env.local",
      "apps/api/.env",
      "apps/worker/.env.local",
      "arbitrary/nested/.env.production",
      "arbitrary/.env.example.local",
    ];
    const output = execFileSync("git", ["check-ignore", "--stdin"], {
      cwd: root,
      input: ignored.join("\n"),
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    expect(output).toEqual(ignored);
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
    }).split("\0");
    expect(
      tracked.filter(
        (path) =>
          /(?:^|\/)\.env[^/]*$/.test(path) && !path.endsWith(".env.example"),
      ),
    ).toEqual([]);
  });
});
