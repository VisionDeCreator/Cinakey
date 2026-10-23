/* eslint-disable @typescript-eslint/no-explicit-any -- Test dispatcher bridges heterogeneous validated service contracts. */
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { getFunctionName, makeFunctionReference } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import type { ActionCtx } from "../convex/_generated/server";
import schema from "../convex/schema";
import { registry } from "../../../apps/api/src/registry";
import { validateArgs } from "../../../apps/api/src/runtime/validation";

export const modules = import.meta.glob("../convex/**/*.*s");
/** Runs real service handlers against the real Convex test database, with a durable task drain. */
export function makeTest() {
  const raw = convexTest(schema, modules);
  const ref = (name: string) => makeFunctionReference<any>(name);
  function wrap(client: typeof raw, identity: any = null): typeof raw {
    const context = {
      auth: { getUserIdentity: async () => identity },
      runQuery: (reference: any, args: any) => client.query(reference, args),
      runMutation: (reference: any, args: any) =>
        client.mutation(reference, args),
      runAction: async (reference: any, args: any) => {
        const operation = registry.get(getFunctionName(reference));
        if (!operation) return client.action(reference, args);
        validateArgs(operation.args, args);
        return operation.handler(context as unknown as ActionCtx, args);
      },
      storage: {
        store: (blob: Blob) => raw.run((ctx) => ctx.storage.store(blob)),
        get: async (id: any) => {
          const data = await raw.run(async (ctx) => {
            const blob = await ctx.storage.get(id);
            return blob
              ? { buffer: await blob.arrayBuffer(), type: blob.type }
              : null;
          });
          return data ? new Blob([data.buffer], { type: data.type }) : null;
        },
        getUrl: (id: any) => raw.run((ctx) => ctx.storage.getUrl(id)),
        delete: (id: any) => raw.run((ctx) => ctx.storage.delete(id)),
      },
      scheduler: {
        runAfter: (delay: number, reference: any, args: any) =>
          raw.mutation(ref("tasks:enqueue"), {
            operation: getFunctionName(reference),
            args,
            delay,
            identity: identity ?? undefined,
          }),
      },
    };
    return {
      ...client,
      action: context.runAction as typeof raw.action,
      withIdentity: ((next: any) =>
        wrap(
          raw.withIdentity(next) as typeof raw,
          next,
        )) as typeof raw.withIdentity,
      finishAllScheduledFunctions: async (advance: () => void) => {
        await raw.finishAllScheduledFunctions(advance);
        for (let round = 0; round < 100; round++) {
          const pending = await raw.run((ctx) =>
            ctx.db.query("apiTasks").collect(),
          );
          if (!pending.length) return;
          for (const task of pending) {
            await raw.run((ctx) => ctx.db.delete(task._id));
            const taskClient = wrap(raw, task.identity ?? null);
            if (registry.has(task.operation))
              await taskClient.action(ref(task.operation), task.args);
            else await raw.mutation(ref(task.operation), task.args);
          }
          advance();
        }
        throw new Error("Worker task drain did not converge");
      },
    } as typeof raw;
  }
  return wrap(raw);
}
export function authIdentity(userId: Id<"users">) {
  return { subject: `${userId}|test-session` };
}
export async function createTestUser(
  t: ReturnType<typeof makeTest>,
  email: string,
  opts?: { isStaff?: boolean },
) {
  return t.run((ctx) =>
    ctx.db.insert("users", {
      email,
      emailVerificationTime: Date.now(),
      isStaff: opts?.isStaff,
    }),
  );
}
