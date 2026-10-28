import { authClientAddress, requestEmailOtp } from "./services/authOtp";
import type { Id } from "../../../packages/backend/convex/_generated/dataModel";
import { polarWebhook } from "./services/payments";
import { internal } from "./operations";
import { MAX_EXPORT_BYTES } from "../../../packages/backend/convex/publishedExports";
import { uploadPublication } from "./services/publishedExports";
import {
  exchangeShare,
  serveSharedMedia,
  viewerToken,
} from "./services/exportSharing";
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
  const safe = safeErrorMessage(error);
  // Convex wraps server errors with request IDs and stack frames. Keep actionable text only.
  const wrapped = /Uncaught (?:Error|ConvexError): ([^\n]+)/.exec(safe);
  const detail =
    typeof data === "object" &&
    data !== null &&
    "message" in data &&
    typeof data.message === "string"
      ? data.message
      : undefined;
  const message = detail
    ? safeErrorMessage(new Error(detail))
    : (wrapped?.[1] ?? safe.split(/\n\s*at /)[0]!);
  return {
    message,
    ...(data === undefined
      ? {}
      : { data: redactSensitiveValue(convexToJson(data)) }),
  };
}
async function boundedBody(request: Request, maxBytes = 6 * 1024 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error("JSON request too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function parseBoundedJson({ request }: { request: Request }) {
  const bytes = await boundedBody(request);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Invalid JSON request");
  }
}

export function createApp() {
  const origins = (
    process.env.WEB_ORIGINS ?? "http://localhost:5173,http://localhost:5174"
  )
    .split(",")
    .map((s) => s.trim());
  return new Elysia({ serve: { maxRequestBodySize: MAX_EXPORT_BYTES + 1024 } })
    .use(
      cors({
        origin: origins,
        allowedHeaders: ["authorization", "content-type"],
        methods: ["POST", "GET", "HEAD", "OPTIONS"],
        credentials: true,
      }),
    )
    .post(
      "/auth/email/request",
      async ({ request, server }) => {
        const origin = request.headers.get("origin");
        if (origin && !origins.includes(origin))
          return Response.json(
            { message: "Origin not allowed" },
            { status: 403 },
          );
        let email: unknown;
        try {
          const body = JSON.parse(
            new TextDecoder().decode(await boundedBody(request, 1024)),
          );
          if (
            !body ||
            typeof body !== "object" ||
            Object.keys(body).some((k) => k !== "email")
          )
            throw new Error("Invalid request");
          email = body.email;
        } catch {
          return Response.json(
            { message: "Enter a valid email address." },
            { status: 400 },
          );
        }
        return requestEmailOtp(
          createContext(registry),
          email,
          authClientAddress(
            request,
            server?.requestIP(request)?.address ?? "unknown",
          ),
        );
      },
      { parse: "none" },
    )
    .post(
      "/webhooks/polar",
      async ({ request }) => {
        try {
          return await polarWebhook(
            createContext(registry),
            request,
            await boundedBody(request),
          );
        } catch {
          return new Response("Payment webhook could not be accepted", {
            status: 503,
          });
        }
      },
      { parse: "none" },
    )
    .post(
      "/exports/:publicationId/upload",
      async ({ request, params }) => {
        try {
          const token = request.headers
            .get("authorization")
            ?.match(/^Bearer\s+(.+)$/i)?.[1];
          if (!token)
            return new Response("Authentication required", { status: 401 });
          let identity;
          try {
            identity = (
              await userClient(token).query(ref("apiIdentity:current"), {})
            ).identity;
          } catch {
            return new Response("Authentication required", { status: 401 });
          }
          if (!identity)
            return new Response("Authentication required", { status: 401 });
          return await uploadPublication(
            createContext(registry, identity),
            params.publicationId as Id<"publishedExports">,
            request,
          );
        } catch (error) {
          return Response.json(errorPayload(error), { status: 422 });
        }
      },
      { parse: "none" },
    )
    .get("/exports/:publicationId/file", async ({ request, params }) => {
      try {
        const token = request.headers
          .get("authorization")
          ?.match(/^Bearer\s+(.+)$/i)?.[1];
        if (!token)
          return new Response("Authentication required", { status: 401 });
        const identity = (
          await userClient(token).query(ref("apiIdentity:current"), {})
        ).identity;
        if (!identity)
          return new Response("Authentication required", { status: 401 });
        const ctx = createContext(registry, identity);
        const publicationId = params.publicationId as Id<"publishedExports">;
        const row = await ctx.runQuery(
          internal.publishedExports.getForDelivery,
          { publicationId },
        );
        const url = await ctx.storage.getUrl(row.storageId!);
        if (!url) throw new Error("Stored export not found");
        const source = await fetch(url, { signal: request.signal });
        if (!source.ok) throw new Error("Stored export unavailable");
        try {
          await ctx.runMutation(internal.publishedExports.recordDownload, {
            publicationId,
          });
        } catch (error) {
          await source.body?.cancel();
          throw error;
        }
        return new Response(source.body, {
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(row.sizeBytes),
            "Content-Disposition": "attachment; filename=video.mp4",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch {
        return new Response("Stored export unavailable", {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        });
      }
    })
    .post(
      "/public/shares/:linkId/session",
      async ({ request, params, body, server }) => {
        try {
          const value = body as { secret?: unknown; password?: unknown };
          if (
            typeof value?.secret !== "string" ||
            (value.password !== undefined && typeof value.password !== "string")
          )
            throw new Error("Invalid share request");
          const result = await exchangeShare(
            createContext(registry),
            params.linkId as Id<"exportShareLinks">,
            value.secret,
            (value.password as string) ?? "",
            server?.requestIP(request)?.address ?? "unknown",
          );
          const secure = (process.env.SITE_URL ?? "").startsWith("https:");
          return Response.json(
            { expiresAt: result.expiresAt },
            {
              headers: {
                "Set-Cookie": `cinakey_share=${result.token}; Path=/public/shares/${params.linkId}/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((result.expiresAt - Date.now()) / 1000))}${secure ? "; Secure" : ""}`,
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
              },
            },
          );
        } catch {
          return Response.json(
            { message: "Link or password is invalid, expired or revoked." },
            { status: 403, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
      { parse: parseBoundedJson },
    )
    .get("/public/shares/:linkId/info", async ({ request, params }) => {
      try {
        const data = await createContext(registry).runQuery(
          internal.exportSharing.authorizeViewer,
          {
            linkId: params.linkId as Id<"exportShareLinks">,
            tokenHash: viewerToken(request),
            download: false,
          },
        );
        return Response.json(
          {
            title: data.title,
            durationSec: data.durationSec,
            allowDownload: data.allowDownload,
          },
          {
            headers: {
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
            },
          },
        );
      } catch {
        return new Response("Share unavailable", {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        });
      }
    })
    .get("/public/shares/:linkId/media", async ({ request, params }) => {
      try {
        return await serveSharedMedia(
          createContext(registry),
          request,
          params.linkId as Id<"exportShareLinks">,
        );
      } catch {
        return new Response("Share unavailable", {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        });
      }
    })
    .head("/public/shares/:linkId/media", async ({ request, params }) => {
      try {
        return await serveSharedMedia(
          createContext(registry),
          request,
          params.linkId as Id<"exportShareLinks">,
        );
      } catch {
        return new Response(null, {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        });
      }
    })
    .get("/health", () => ({ ok: true, service: "cinakey-api" }))
    .post("/webhooks/generation", async ({ request }) => {
      const operation = generationWebhook as unknown as {
        handler: (ctx: unknown, request: Request) => Promise<Response>;
      };
      return operation.handler(
        createContext(registry),
        new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: await boundedBody(request),
        }),
      );
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
      {
        parse: parseBoundedJson,
        body: t.Object({ args: t.Any(), stream: t.Optional(t.Boolean()) }),
      },
    );
}
