import { providerConfig, type ProviderName } from "../config/env";
import { currentProviderSignal } from "../runtime/provider-scope";
import { ProviderError, safeErrorMessage } from "./errors";
export type ProviderTransport = (
  url: string | URL,
  init: RequestInit,
) => Promise<Response>;
let testTransport: ProviderTransport | undefined;
/** Explicit test seam. A test process cannot use the real provider transport. */
export function setProviderTransportForTests(transport?: ProviderTransport) {
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST)
    throw new Error("Test transports are unavailable outside tests");
  testTransport = transport;
}
const wait = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Request cancelled"));
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new Error("Request cancelled"));
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
export function retryAfterMs(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value),
    ms = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(value) - Date.now();
  return Math.min(30_000, Math.max(0, Number.isFinite(ms) ? ms : 0));
}
/** Only safe reads retry automatically. Paid POSTs never retry here. */
export async function providerFetch(
  provider: ProviderName,
  url: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const config = providerConfig();
  const parentSignal = init.signal ?? currentProviderSignal();
  if (parentSignal?.aborted) throw new ProviderError(provider);
  if (config.mock)
    throw new Error("Real provider requests are disabled in mock mode");
  const parsed = new URL(url),
    expected =
      provider === "openai"
        ? "https://api.openai.com"
        : provider === "deepseek"
          ? "https://api.deepseek.com"
          : new URL(config.sumeBaseUrl).origin;
  if (parsed.origin !== expected)
    throw new Error(
      "Provider request origin does not match configured provider",
    );
  const testing =
    process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
  if (testing && !testTransport)
    throw new Error("Paid network calls are blocked in tests");
  const send = testing ? testTransport! : globalThis.fetch;
  const read = (init.method ?? "GET").toUpperCase() === "GET",
    maxAttempts = read ? config.readRetries + 1 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const signal = AbortSignal.any([
      AbortSignal.timeout(config.timeoutMs),
      ...(parentSignal ? [parentSignal] : []),
    ]);
    let response: Response;
    try {
      response = await send(url, { ...init, signal, redirect: "error" });
    } catch {
      if (read && attempt + 1 < maxAttempts && !parentSignal?.aborted) {
        await wait(250 * 2 ** attempt, parentSignal);
        continue;
      }
      throw new ProviderError(provider, undefined, read, !read);
    }
    if (response.ok) return response;
    const status = response.status,
      retryable = status === 429 || status >= 500;
    if (read && retryable && attempt + 1 < maxAttempts) {
      const delay = Math.max(
        retryAfterMs(response.headers.get("retry-after")),
        250 * 2 ** attempt + Math.floor(Math.random() * 100),
      );
      await response.body?.cancel();
      await wait(delay, parentSignal);
      continue;
    }
    // Only retain the bounded, redacted error message, never headers or raw bodies.
    let detail = "";
    if (status === 400 || status === 422) {
      try {
        const payload = (await response.json()) as {
          error?: { message?: unknown; code?: unknown };
        };
        const message = payload.error?.message;
        if (typeof message === "string")
          detail = safeErrorMessage(new Error(message)).slice(0, 240);
      } catch {
        /* Non-JSON provider errors use the HTTP status. */
      }
    }
    const retryDelay = retryAfterMs(response.headers.get("retry-after"));
    if (!response.bodyUsed) await response.body?.cancel();
    throw new ProviderError(
      provider,
      status,
      (read && retryable) || status === 429,
      !read && (status >= 500 || status === 408),
      retryDelay,
      detail,
    );
  }
  throw new ProviderError(provider);
}

/** Media downloads use no provider credentials and share timeout/cancellation/test controls. */
export async function fetchMedia(url: string): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error("Media URL must use HTTPS without credentials");
  const parent = currentProviderSignal();
  const signal = AbortSignal.any([
    AbortSignal.timeout(providerConfig().timeoutMs),
    ...(parent ? [parent] : []),
  ]);
  const testing =
    process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
  if (testing && !testTransport)
    throw new Error("Network calls are blocked in tests");
  try {
    const response = await (testing ? testTransport! : globalThis.fetch)(url, {
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Media download failed");
    }
    return response;
  } catch {
    throw new Error("Media download failed or was cancelled");
  }
}
