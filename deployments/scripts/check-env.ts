import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const services = ["api", "worker", "web", "admin", "convex"] as const;
export type Service = (typeof services)[number];
export function readEnvironment(service: Service, path?: string) {
  return parseEnv(
    readFileSync(path ?? resolve(root, `deployments/${service}/.env`), "utf8"),
  );
}
export function validateEnvironment(
  service: Service,
  env: Record<string, string>,
) {
  const errors: string[] = [];
  const requireKeys = (...keys: string[]) => {
    for (const key of keys) {
      if (
        !env[key]?.trim() ||
        /your-deployment|example\.com|change[-_]?me/i.test(env[key])
      )
        errors.push(`${key}: required; replace placeholders`);
    }
  };
  const url = (key: string) => {
    requireKeys(key);
    try {
      const parsed = new URL(env[key]);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parsed.pathname !== "/"
      )
        throw new Error();
    } catch {
      errors.push(`${key}: must be an HTTPS origin without credentials`);
    }
  };
  const boolean = (key: string) => {
    if (!["true", "false"].includes(env[key] ?? ""))
      errors.push(`${key}: must be true or false`);
  };
  if (service === "web" || service === "admin") {
    for (const key of [
      "VITE_CONVEX_URL",
      "VITE_API_URL",
      service === "web" ? "VITE_ADMIN_URL" : "VITE_WEB_URL",
    ])
      url(key);
    if (service === "admin") requireKeys("VITE_APP_ENV");
    for (const key of Object.keys(env))
      if (!key.startsWith("VITE_"))
        errors.push(
          `${key}: server variables are forbidden in frontend configuration`,
        );
  } else {
    url("CONVEX_URL");
    requireKeys("CONVEX_DEPLOY_KEY");
    const keyTarget = /^prod:([^|]+)\|.+$/.exec(env.CONVEX_DEPLOY_KEY ?? "");
    if (!keyTarget)
      errors.push("CONVEX_DEPLOY_KEY: use a production deployment key");
    else {
      try {
        if (new URL(env.CONVEX_URL).hostname !== `${keyTarget[1]}.convex.cloud`)
          errors.push("CONVEX_URL must match the production deploy key target");
      } catch {
        /* URL validation below reports malformed origins. */
      }
    }

    url("SITE_URL");
    if (!["sandbox", "production"].includes(env.POLAR_ENVIRONMENT))
      errors.push("POLAR_ENVIRONMENT: use sandbox or production");
    boolean("SUBSCRIPTION_PAYWALL_ENABLED");
    if (service === "convex") {
      boolean("STAGING_LLM_ENABLED");
      if (Boolean(env.AUTH_GOOGLE_ID) !== Boolean(env.AUTH_GOOGLE_SECRET))
        errors.push("Google OAuth requires both credentials");
    } else {
      requireKeys(
        "R2_ACCOUNT_ID",
        "R2_BUCKET",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "GENERATION_WEBHOOK_SECRET",
      );
      url("R2_ENDPOINT");
      if (env.PORT !== "3001")
        errors.push("PORT: deployment uses fixed internal port 3001");
      requireKeys("WEB_ORIGINS");
      for (const origin of (env.WEB_ORIGINS ?? "").split(",")) {
        try {
          const u = new URL(origin.trim());
          if (u.protocol !== "https:" || u.origin !== origin.trim())
            throw new Error();
        } catch {
          errors.push("WEB_ORIGINS: use exact HTTPS origins");
        }
      }
      const providers = (env.ENABLED_PROVIDERS ?? "deepseek,sume")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      for (const provider of providers) {
        if (!["deepseek", "sume"].includes(provider))
          errors.push(
            "ENABLED_PROVIDERS: supported production providers are deepseek,sume",
          );
        else requireKeys(`${provider.toUpperCase()}_API_KEY`);
      }
      boolean("EMAIL_NOTIFICATIONS_ENABLED");
      boolean("POLAR_PAYMENTS_ENABLED");
      if (env.EMAIL_NOTIFICATIONS_ENABLED === "true") {
        requireKeys(
          "SMTP_HOST",
          "SMTP_USER",
          "SMTP_PASSWORD",
          "SMTP_FROM_EMAIL",
        );
        boolean("SMTP_SECURE");
        const port = Number(
          env.SMTP_PORT || (env.SMTP_SECURE === "true" ? 465 : 587),
        );
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          errors.push("SMTP_PORT: invalid port");
      }
      if (env.POLAR_PAYMENTS_ENABLED === "true") {
        const products = [
          "POLAR_WORKSPACE_PRODUCT_ID",
          "POLAR_TOPUP_10_PRODUCT_ID",
          "POLAR_TOPUP_25_PRODUCT_ID",
          "POLAR_TOPUP_50_PRODUCT_ID",
        ];
        requireKeys("POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET", ...products);
        if (new Set(products.map((k) => env[k])).size !== products.length)
          errors.push("Polar product IDs must be distinct");
        if (env.POLAR_ENVIRONMENT === "sandbox" && providers.length)
          errors.push(
            "Polar sandbox balances cannot fund live providers; disable providers for sandbox testing",
          );
      }
    }
  }
  return [...new Set(errors)];
}
export function checkServices(selected: readonly Service[]) {
  const all: Partial<Record<Service, Record<string, string>>> = {};
  const errors: string[] = [];
  for (const service of selected) {
    try {
      const env = readEnvironment(service);
      all[service] = env;
      errors.push(
        ...validateEnvironment(service, env).map((e) => `${service}: ${e}`),
      );
    } catch {
      errors.push(
        `${service}: cannot read deployments/${service}/.env; copy its .env.example`,
      );
    }
  }
  const match = (a: Service, ak: string, b: Service, bk: string) => {
    if (all[a] && all[b] && all[a]![ak] !== all[b]![bk])
      errors.push(`${a}.${ak} must match ${b}.${bk}`);
  };
  for (const s of ["worker", "convex"] as const) {
    for (const key of [
      "CONVEX_URL",
      "SITE_URL",
      "POLAR_ENVIRONMENT",
      "SUBSCRIPTION_PAYWALL_ENABLED",
    ])
      match("api", key, s, key);
  }
  if (all.api && all.worker)
    for (const key of Object.keys(all.api)) {
      if (key !== "AUTH_TRUSTED_PROXY_IPS" && all.api[key] !== all.worker[key])
        errors.push(
          `api/worker: ${key} differs; keep shared runtime configuration aligned`,
        );
    }
  for (const s of ["web", "admin"] as const)
    match("api", "CONVEX_URL", s, "VITE_CONVEX_URL");
  match("web", "VITE_API_URL", "admin", "VITE_API_URL");
  match("api", "SITE_URL", "admin", "VITE_WEB_URL");
  if (all.api && all.web && all.admin) {
    const origins = (all.api.WEB_ORIGINS ?? "").split(",").map((x) => x.trim());
    if (
      ![all.admin.VITE_WEB_URL, all.web.VITE_ADMIN_URL].every((x) =>
        origins.includes(x),
      )
    )
      errors.push("WEB_ORIGINS must include web and admin origins");
  }
  return errors;
}
export function validateRootEnvironment(env: Record<string, string>) {
  const errors = validateEnvironment("api", env);
  const frontend = {
    VITE_CONVEX_URL: env.VITE_CONVEX_URL || env.CONVEX_URL,
    VITE_API_URL: env.VITE_API_URL || "http://localhost:8082",
  };
  const web = {
    ...frontend,
    VITE_ADMIN_URL: env.VITE_ADMIN_URL || "http://localhost:8081",
  };
  const admin = {
    ...frontend,
    VITE_WEB_URL: env.VITE_WEB_URL || "http://localhost:8080",
    VITE_APP_ENV: env.VITE_APP_ENV || "production",
  };
  errors.push(
    ...validateEnvironment("web", web),
    ...validateEnvironment("admin", admin),
  );
  if (frontend.VITE_CONVEX_URL !== env.CONVEX_URL)
    errors.push("VITE_CONVEX_URL must match CONVEX_URL");
  if (admin.VITE_WEB_URL !== env.SITE_URL)
    errors.push("VITE_WEB_URL must match SITE_URL");
  const origins = (env.WEB_ORIGINS || "").split(",").map((s) => s.trim());
  if (
    ![web.VITE_ADMIN_URL, admin.VITE_WEB_URL].every((origin) =>
      origins.includes(origin),
    )
  )
    errors.push("WEB_ORIGINS must include web and admin origins");
  return [...new Set(errors)];
}

if (import.meta.main) {
  const service = process.argv[2];
  if (service === "root") {
    try {
      const env = parseEnv(readFileSync(resolve(root, ".env"), "utf8"));
      const errors = validateRootEnvironment(env);
      errors.forEach((e) => console.error(e));
      if (!errors.length)
        console.log(
          "Root Compose environment checks passed (values redacted).",
        );
      process.exitCode = errors.length ? 1 : 0;
    } catch {
      console.error("Cannot read root .env");
      process.exitCode = 1;
    }
  } else if (process.argv[3] && services.includes(service as Service)) {
    try {
      const errors = validateEnvironment(
        service as Service,
        readEnvironment(service as Service, process.argv[3]),
      );
      errors.forEach((e) => console.error(`${service}: ${e}`));
      process.exitCode = errors.length ? 1 : 0;
    } catch {
      console.error("Cannot read environment file");
      process.exitCode = 1;
    }
  } else if (service === "all" || services.includes(service as Service)) {
    const errors = checkServices(
      service === "all" ? services : [service as Service],
    );
    errors.forEach((e) => console.error(e));
    if (!errors.length)
      console.log("Deployment environment checks passed (values redacted).");
    process.exitCode = errors.length ? 1 : 0;
  } else {
    console.error(
      "Usage: check-env.ts <root|all|api|worker|web|admin|convex> [env-file]",
    );
    process.exitCode = 1;
  }
}
