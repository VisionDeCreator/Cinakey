import {
  objectKey,
  putObject,
  resolveMediaUrls,
  r2Config,
} from "../services/r2";
import { ConvexHttpClient } from "convex/browser";
import {
  getFunctionName,
  makeFunctionReference,
  type UserIdentity,
} from "convex/server";
import type { ActionCtx } from "../../../../packages/backend/convex/_generated/server";
import { validateArgs } from "./validation";

export type ServiceOperation = {
  visibility: "public" | "internal";
  args: Record<string, unknown>;
  handler: (ctx: ActionCtx, args: any) => Promise<any>;
};
export type Registry = Map<string, ServiceOperation>;
export function adminClient(
  identity?: UserIdentity | null,
  timeoutMs?: number,
) {
  const url = process.env.CONVEX_URL;
  const key = process.env.CONVEX_DEPLOY_KEY;
  if (!url || !key)
    throw new Error("CONVEX_URL and CONVEX_DEPLOY_KEY are required");
  const client = new ConvexHttpClient(
    url,
    timeoutMs
      ? {
          fetch: ((...[input, init]: Parameters<typeof globalThis.fetch>) =>
            globalThis.fetch(input, {
              ...init,
              signal: AbortSignal.timeout(timeoutMs),
            })) as typeof globalThis.fetch,
        }
      : undefined,
  );
  (
    client as unknown as {
      setAdminAuth: (key: string, identity?: UserIdentity) => void;
    }
  ).setAdminAuth(key, identity ?? undefined);
  return client;
}
export function userClient(token: string) {
  if (!process.env.CONVEX_URL) throw new Error("CONVEX_URL is required");
  const client = new ConvexHttpClient(process.env.CONVEX_URL);
  client.setAuth(token);
  return client;
}

export function createContext(
  registry: Registry,
  identity: UserIdentity | null = null,
  worker = false,
): ActionCtx {
  const client = adminClient(identity);
  const reference = (name: string) => makeFunctionReference<any>(name);
  const nameOf = (ref: any) =>
    typeof ref === "string" ? ref : getFunctionName(ref);
  const queryCache = new Map<string, Promise<any>>();
  const fileCache = new Map<string, Promise<Blob | null>>();
  const ctx = {
    auth: { getUserIdentity: async () => identity },
    runQuery: (ref: any, args: any = {}) => {
      const name = nameOf(ref),
        key = name + JSON.stringify(args);
      if (!queryCache.has(key))
        queryCache.set(key, client.query(reference(name), args));
      return queryCache.get(key)!;
    },
    runMutation: async (ref: any, args: any = {}) => {
      const name = nameOf(ref);
      queryCache.clear();
      const result = await client.mutation(reference(name), args);
      return result;
    },
    runAction: async (ref: any, args: any = {}) => {
      const name = nameOf(ref),
        operation = registry.get(name);
      if (!operation) throw new Error(`Unknown service operation: ${name}`);
      validateArgs(operation.args, args);
      return operation.handler(ctx as unknown as ActionCtx, args);
    },
    scheduler: {
      runAfter: async (delay: number, ref: any, args: any = {}) => {
        const name = nameOf(ref);
        if (worker && /^generation:(pollJob|submitAndTrack)$/.test(name)) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          await ctx.runAction(ref, args);
          return null;
        }
        return client.mutation(reference("tasks:enqueue"), {
          operation: name,
          args,
          delay,
          identity: identity ?? undefined,
        });
      },
    },
    storage: {
      generateUploadUrl: () =>
        client.mutation(reference("storageIO:uploadUrl"), {}),
      getUrl: async (id: any) =>
        resolveMediaUrls(
          await client.query(reference("storageIO:url"), { id }),
          (id) => client.query(reference("storageIO:lookupR2File"), { id }),
        ),
      delete: (id: any) =>
        client.mutation(reference("storageIO:remove"), { id }),
      store: async (blob: Blob) => {
        if (/^(image|video|audio)\//.test(blob.type)) {
          const key = objectKey();
          const { bucket } = r2Config();
          // Record the intent first: uncertain writes must remain recoverable, not lose bytes.
          const id = await client.mutation(
            reference("storageIO:registerR2File"),
            {
              key,
              bucket,
              size: blob.size,
              contentType: blob.type,
            },
          );
          await putObject(key, blob);
          return id;
        }
        const url = await client.mutation(reference("storageIO:uploadUrl"), {});
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": blob.type || "application/octet-stream" },
          body: blob,
        });
        if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
        return ((await res.json()) as { storageId: string }).storageId;
      },
      get: (id: any) => {
        if (!fileCache.has(id))
          fileCache.set(
            id,
            (async () => {
              const url = await ctx.storage.getUrl(id);
              if (!url) return null;
              const response = await fetch(url);
              if (!response.ok)
                throw new Error(`Storage read failed (${response.status})`);
              return response.blob();
            })(),
          );
        return fileCache.get(id)!;
      },
    },
  };
  return ctx as unknown as ActionCtx;
}
