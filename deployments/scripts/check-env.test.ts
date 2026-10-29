import { describe, expect, test } from "bun:test";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  root,
  validateEnvironment,
  validateRootEnvironment,
  services,
  type Service,
} from "./check-env";
function fixture(service: Service) {
  const env = parseEnv(
    readFileSync(resolve(root, `deployments/${service}/.env.example`), "utf8"),
  );
  for (const [key, value] of Object.entries(env)) {
    env[key] = value
      .replaceAll("your-deployment", "unit-fixture")
      .replaceAll("example.com", "unit.invalid");
    if (!env[key] && /KEY|SECRET|TOKEN|PASSWORD|ACCOUNT_ID|BUCKET/.test(key))
      env[key] = "fixture";
  }
  if (!["web", "admin"].includes(service))
    env.CONVEX_DEPLOY_KEY = ["prod:unit-fixture", "fixture"].join("|");
  if (service === "convex") {
    env.AUTH_GOOGLE_ID = "";
    env.AUTH_GOOGLE_SECRET = "";
  }
  if (service === "api" || service === "worker") {
    env.R2_ENDPOINT = "https://r2.unit.invalid";
    env.R2_ACCESS_KEY_ID = "fixture";
  }
  return env;
}
describe("deployment environment validation", () => {
  test("every untouched example fails placeholders or missing secrets", () => {
    for (const service of services)
      expect(
        validateEnvironment(
          service,
          parseEnv(
            readFileSync(
              resolve(root, `deployments/${service}/.env.example`),
              "utf8",
            ),
          ),
        ).length,
      ).toBeGreaterThan(0);
  });
  test("configured services accept disabled optional integrations", () => {
    for (const service of services)
      expect(validateEnvironment(service, fixture(service))).toEqual([]);
  });
  test("a credential for another Convex deployment is rejected", () => {
    const env = fixture("api");
    env.CONVEX_URL = "https://another-deployment.convex.cloud";
    expect(validateEnvironment("api", env).join()).toContain(
      "deploy key target",
    );
  });
  test("SMTP becomes required when email login is enabled", () => {
    const env = fixture("api");
    env.EMAIL_NOTIFICATIONS_ENABLED = "true";
    env.SMTP_HOST = "";
    expect(validateEnvironment("api", env).join()).toContain("SMTP_HOST");
  });
  test("missing enabled provider credentials fail without disclosing values", () => {
    const env = fixture("worker");
    env["SUME_" + "API_KEY"] = "";
    expect(validateEnvironment("worker", env).join()).toContain("SUME_API_KEY");
    expect(validateEnvironment("worker", env).join()).not.toContain(
      env.CONVEX_DEPLOY_KEY,
    );
  });
  test("frontend configuration rejects server credentials", () => {
    const env = fixture("web");
    env.CONVEX_DEPLOY_KEY = "";
    expect(validateEnvironment("web", env).join()).toContain(
      "server variables are forbidden",
    );
  });
  test("live providers cannot use sandbox payment balances", () => {
    const env = fixture("api");
    env.POLAR_PAYMENTS_ENABLED = "true";
    expect(validateEnvironment("api", env).join()).toContain(
      "sandbox balances",
    );
  });
  test("worker health detects stale polling, supports long jobs and fails after shutdown", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "dirrio-health-test-"));
    try {
      const file = resolve(dir, "health.json");
      const probe = (state: unknown) => {
        writeFileSync(file, JSON.stringify(state));
        return Bun.spawnSync(
          [
            process.execPath,
            "--no-env-file",
            resolve(root, "deployments/scripts/worker-health.ts"),
          ],
          { env: { ...process.env, WORKER_HEALTH_FILE: file } },
        ).exitCode;
      };
      expect(
        probe({ at: Date.now(), lastPollAt: Date.now(), activeTasks: 0 }),
      ).toBe(0);
      expect(probe({ at: Date.now(), lastPollAt: 0, activeTasks: 0 })).toBe(1);
      expect(probe({ at: 0, lastPollAt: Date.now(), activeTasks: 4 })).toBe(1);
      expect(probe({ at: Date.now(), lastPollAt: 0, activeTasks: 4 })).toBe(0);
      expect(
        probe({ at: Date.now(), lastPollAt: Date.now(), stopping: true }),
      ).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("root production configuration", () => {
  test("accepts one Dokploy environment and rejects mismatched browser deployment", () => {
    const env = {
      ...fixture("api"),
      VITE_API_URL: "https://api.unit.invalid",
      VITE_WEB_URL: "https://app.unit.invalid",
      VITE_ADMIN_URL: "https://admin.unit.invalid",
      SITE_URL: "https://app.unit.invalid",
      WEB_ORIGINS: "https://app.unit.invalid,https://admin.unit.invalid",
    };
    expect(validateRootEnvironment(env)).toEqual([]);
    expect(
      validateRootEnvironment({
        ...env,
        VITE_CONVEX_URL: "https://different.convex.cloud",
      }).join(),
    ).toContain("must match CONVEX_URL");
  });
});

describe("direct Compose configuration", () => {
  test("root and per-service files parse directly without generated variables or a wrapper", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "dirrio-direct-compose-"));
    const paths = [
      "docker-compose.yml",
      "deployments/docker-compose.yml",
      ...["api", "worker", "web", "admin"].map(
        (app) => `deployments/${app}/docker-compose.yml`,
      ),
    ];
    const fixture =
      "CONVEX_URL=https://fixture.convex.cloud\nVITE_API_URL=https://api.unit.invalid\nVITE_WEB_URL=https://web.unit.invalid\nVITE_ADMIN_URL=https://admin.unit.invalid\nVITE_APP_ENV=staging\n";
    try {
      for (const path of paths) {
        const target = resolve(dir, path);
        mkdirSync(resolve(target, ".."), { recursive: true });
        writeFileSync(target, readFileSync(resolve(root, path)));
        writeFileSync(resolve(target, "../.env"), fixture);
      }
      // Each parser sees only synthetic deployment files, never the developer's .env.
      for (const path of paths) {
        const result = Bun.spawnSync(
          [
            "docker",
            "compose",
            ...(path === "docker-compose.yml"
              ? []
              : ["--env-file", resolve(dir, ".env"), "-f", resolve(dir, path)]),
            "config",
            "--format",
            "json",
          ],
          { cwd: dir, env: { PATH: process.env.PATH } },
        );
        expect(result.exitCode).toBe(0);
        const config = JSON.parse(result.stdout.toString());
        for (const app of ["web", "admin"]) {
          if (!config.services[app]) continue;
          expect(realpathSync(config.services[app].build.context)).toBe(
            realpathSync(dir),
          );
          expect(config.services[app].build.args.VITE_CONVEX_URL).toBe(
            "https://fixture.convex.cloud",
          );
          expect(config.services[app].build.args.VITE_API_URL).toBe(
            "https://api.unit.invalid",
          );
        }
        for (const app of ["api", "worker"])
          if (config.services[app]) {
            expect(config.services[app].environment.CONVEX_URL).toBe(
              "https://fixture.convex.cloud",
            );
            expect(config.services[app].volumes[0].target).toBe("/app/.env");
          }
      }
      if (Bun.which("podman-compose")) {
        const result = Bun.spawnSync(["podman-compose", "config"], {
          cwd: dir,
          env: { PATH: process.env.PATH },
        });
        expect(result.exitCode).toBe(0);
        expect(
          result.stdout.toString().includes("https://api.unit.invalid"),
        ).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
