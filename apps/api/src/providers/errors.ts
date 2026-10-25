import { providerKeyNames } from "../config/env";
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status?: number,
    readonly retryable = false,
    readonly uncertain = false,
    readonly retryAfterMs = 0,
    readonly detail = "",
  ) {
    super(
      `${provider} request ${uncertain ? "outcome is uncertain; review before resubmitting" : status ? `failed (HTTP ${status})${detail ? `: ${detail}` : ""}` : "failed"}`,
    );
    this.name = "ProviderError";
  }
}
export class SubmissionUncertainError extends Error {
  constructor() {
    super(
      "Provider submission outcome is uncertain. Review the provider job before resubmitting; credits remain reserved.",
    );
    this.name = "SubmissionUncertainError";
  }
}
export function safeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : "Request failed";
  const names = [
    ...Object.values(providerKeyNames),
    "CONVEX_DEPLOY_KEY",
    "GENERATION_WEBHOOK_SECRET",
    "RESEND_API_KEY",
  ];
  for (const name of names) {
    const secret = process.env[name];
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return message
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/https?:\/\/[^\s"']+/g, "[URL redacted]")
    .slice(0, 500);
}

export function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === "string") return safeErrorMessage(new Error(value));
  if (Array.isArray(value)) return value.map(redactSensitiveValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /authorization|api[_-]?key|secret|password/i.test(key)
          ? "[redacted]"
          : redactSensitiveValue(item),
      ]),
    );
  return value;
}

/** Preserve the original cause while remaining compatible with Convex's ES2021 library. */
export function workerCancellationError(cause: unknown): Error {
  const error = new Error("Worker request cancelled");
  Object.defineProperty(error, "cause", {
    value: cause,
    configurable: true,
    writable: true,
  });
  return error;
}
