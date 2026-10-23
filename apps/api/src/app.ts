import { withProviderSignal } from "./runtime/provider-scope";
import { safeErrorMessage, redactSensitiveValue } from "./providers/errors";
import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { makeFunctionReference } from "convex/server";
import { ConvexError, convexToJson, jsonToConvex } from "convex/values";
import manifest from "./manifest.json";
import { registry } from "./registry";
import { createContext, userClient } from "./runtime/context";
import { validateArgs } from "./runtime/validation";
import { generationWebhook } from "./services/generation";

const operations = manifest as Record<
  string,
  { kind: string; public: boolean }
>;
const ref = (name: string) => makeFunctionReference<any>(name);
function errorPayload(error: unknown) {
  const data = error instanceof ConvexError ? error.data : undefined;
  const message = safeErrorMessage(error);
  return {
    message,
    ...(data === undefined
      ? {}
      : { data: redactSensitiveValue(convexToJson(data)) }),
  };
}
export function createApp() {
  const origins = (process.env.WEB_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim());
  return new Elysia({ serve: { maxRequestBodySize: 6 * 1024 * 1024 } })
    .use(
      cors({
        origin: origins,
        allowedHeaders: ["authorization", "content-type"],
        methods: ["POST", "GET", "OPTIONS"],
      }),
    )
    .get("/health", () => ({ ok: true, service: "cinakey-api" }))
    .post("/webhooks/generation", async ({ request }) => {
      const operation = generationWebhook as unknown as {
        handler: (ctx: unknown, request: Request) => Promise<Response>;
      };
      return operation.handler(createContext(registry), request);
    })
    .post(
      "/v1/:module/:operation",
      async ({ params, body, request, set }) => {
        const name = `${params.module}:${params.operation}`;
        const contract = operations[name];
        if (!contract?.public) {
          set.status = 404;
          return { message: "Unknown operation" };
        }
        const token = request.headers
          .get("authorization")
          ?.match(/^Bearer\s+(.+)$/i)?.[1];
        if (!token) {
          set.status = 401;
          return { message: "Authentication required" };
        }
        const client = userClient(token);
        let identity;
        try {
          identity = (await client.query(ref("apiIdentity:current"), {}))
            .identity;
        } catch {
          set.status = 401;
          return { message: "Invalid or expired session" };
        }
        if (!identity) {
          set.status = 401;
          return { message: "Authentication required" };
        }
        const args = jsonToConvex(body.args);
        const service = registry.get(name);
        try {
          if (!service) {
            const value =
              contract.kind === "query"
                ? await client.query(ref(name), args as any)
                : await client.mutation(ref(name), args as any);
            return { value: convexToJson(value ?? null) };
          }
          validateArgs(service.args, args);
          return {
            value: convexToJson(
              (await withProviderSignal(request.signal, () =>
                service.handler(createContext(registry, identity), args),
              )) ?? null,
            ),
          };
        } catch (error) {
          const payload = errorPayload(error);
          set.status =
            /access denied|Staff access|not found in this project/i.test(
              payload.message,
            )
              ? 403
              : /Invalid args|Unexpected args/.test(payload.message)
                ? 400
                : 422;
          return payload;
        }
      },
      { body: t.Object({ args: t.Any(), stream: t.Optional(t.Boolean()) }) },
    );
}
